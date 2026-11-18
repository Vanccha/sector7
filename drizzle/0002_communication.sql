CREATE TABLE "channel_reads" (
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "channel_reads_user_id_channel_id_pk" PRIMARY KEY("user_id","channel_id")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channels_announcement_uq" ON "channels" USING btree ("kind") WHERE "channels"."kind" = 'announcement';--> statement-breakpoint
CREATE INDEX "notifications_push_queue_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."pushed_at" is null;--> statement-breakpoint
-- Veri: ortak duyuru kanalı ve kanalı olmayan alanların kanalları.
INSERT INTO "channels" ("kind", "name") SELECT 'announcement', 'Duyurular' WHERE NOT EXISTS (SELECT 1 FROM "channels" WHERE "kind" = 'announcement');--> statement-breakpoint
INSERT INTO "channels" ("kind", "area_id", "name") SELECT 'area', a."id", a."name" FROM "areas" a WHERE NOT EXISTS (SELECT 1 FROM "channels" c WHERE c."kind" = 'area' AND c."area_id" = a."id");
