ALTER TABLE "agent_test_case" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_test_case" ADD COLUMN "turn_count" integer;--> statement-breakpoint
ALTER TABLE "agent_test_case" ADD COLUMN "judge_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_test_run" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "agent_test_run" ADD COLUMN "judge_model" text;