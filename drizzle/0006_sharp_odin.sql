ALTER TABLE "agent_test_case" ADD COLUMN "initial_stage" text;--> statement-breakpoint
ALTER TABLE "agent_test_case" ADD COLUMN "final_stage" text;--> statement-breakpoint
ALTER TABLE "agent_test_case" ADD COLUMN "expect_advance" boolean;--> statement-breakpoint
ALTER TABLE "agent_test_case" ADD COLUMN "advanced" boolean;