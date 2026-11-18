CREATE TABLE "github_milestones" (
	"repo" text NOT NULL,
	"sprint_id" uuid NOT NULL,
	"number" integer NOT NULL,
	CONSTRAINT "github_milestones_repo_sprint_id_pk" PRIMARY KEY("repo","sprint_id")
);
--> statement-breakpoint
CREATE TABLE "github_outbox" (
	"ticket_id" uuid PRIMARY KEY NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "github_webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"merged" boolean DEFAULT false NOT NULL,
	"author_login" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "github_repo" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "pull_request_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "github_issue_number" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "github_issue_url" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "github_branch" text;--> statement-breakpoint
ALTER TABLE "github_milestones" ADD CONSTRAINT "github_milestones_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_outbox" ADD CONSTRAINT "github_outbox_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_pull_requests" ADD CONSTRAINT "ticket_pull_requests_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_outbox_next_idx" ON "github_outbox" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_prs_repo_number_uq" ON "ticket_pull_requests" USING btree ("repo","number");--> statement-breakpoint
CREATE INDEX "ticket_prs_ticket_idx" ON "ticket_pull_requests" USING btree ("ticket_id");--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_pull_request_id_ticket_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."ticket_pull_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Aşama 7.5: GitHub senkron kuyruğu. Ticket ya da ön koşulları değişince ticket kuyruğa girer (birleşir).
-- Uygulama kodu kuyruğa yazmaz; her yazma yolu bu tetikleyicilerle kapsanır. İşleyici entegrasyon kapalıysa satırları atar.
CREATE OR REPLACE FUNCTION github_outbox_enqueue(tid uuid) RETURNS void AS $$
BEGIN
  INSERT INTO github_outbox (ticket_id, enqueued_at, next_attempt_at, attempts, last_error)
  VALUES (tid, clock_timestamp(), clock_timestamp(), 0, NULL)
  ON CONFLICT (ticket_id) DO UPDATE
    SET enqueued_at = EXCLUDED.enqueued_at, next_attempt_at = EXCLUDED.next_attempt_at, attempts = 0, last_error = NULL;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION tickets_github_enqueue() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
     OR NEW.sprint_id IS DISTINCT FROM OLD.sprint_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description THEN
    PERFORM github_outbox_enqueue(NEW.id);
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tickets_github_enqueue ON tickets;
--> statement-breakpoint
CREATE TRIGGER tickets_github_enqueue AFTER INSERT OR UPDATE OF status, assignee_id, sprint_id, title, description ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_github_enqueue();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ticket_deps_github_enqueue() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM github_outbox_enqueue(OLD.ticket_id);
  ELSE
    PERFORM github_outbox_enqueue(NEW.ticket_id);
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS ticket_deps_github_enqueue ON ticket_dependencies;
--> statement-breakpoint
CREATE TRIGGER ticket_deps_github_enqueue AFTER INSERT OR DELETE ON ticket_dependencies
  FOR EACH ROW EXECUTE FUNCTION ticket_deps_github_enqueue();
