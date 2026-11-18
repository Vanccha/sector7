ALTER TABLE "applications" ADD COLUMN "github_username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "github_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "github_login" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "github_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_github_id_unique" UNIQUE("github_id");