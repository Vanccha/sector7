ALTER TABLE "remembered_devices" ADD COLUMN "previous_token_hash" text;--> statement-breakpoint
ALTER TABLE "remembered_devices" ADD COLUMN "rotated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "remembered_devices_prev_idx" ON "remembered_devices" USING btree ("previous_token_hash");--> statement-breakpoint
CREATE INDEX "remembered_devices_expires_idx" ON "remembered_devices" USING btree ("expires_at");