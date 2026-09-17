ALTER TABLE "conversation" ADD COLUMN "attribution_source_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "attribution_ctwa_clid" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "attribution_headline" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "attribution_source_url" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "attribution_captured_at" timestamp;