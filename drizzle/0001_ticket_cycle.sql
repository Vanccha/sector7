ALTER TYPE "public"."ticket_request_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."ticket_status" ADD VALUE 'offered' BEFORE 'taken';--> statement-breakpoint
ALTER TABLE "ticket_requests" ADD COLUMN "awaiting_requester_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "offered_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluations_ticket_evaluator_uq" ON "evaluations" USING btree ("ticket_id","evaluator_id");