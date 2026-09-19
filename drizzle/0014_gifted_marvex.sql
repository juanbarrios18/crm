CREATE TABLE "agent_test_judgment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"run_id" text NOT NULL,
	"source_case_id" text NOT NULL,
	"pass" integer NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"veredicto" text,
	"hallazgos" jsonb,
	"judge_latency_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_test_run" ADD COLUMN "kind" text DEFAULT 'run' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_test_run" ADD COLUMN "source_run_id" text;--> statement-breakpoint
ALTER TABLE "agent_test_run" ADD COLUMN "config_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "agent_test_run" ADD COLUMN "config_hash" text;--> statement-breakpoint
ALTER TABLE "agent_test_judgment" ADD CONSTRAINT "agent_test_judgment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_judgment" ADD CONSTRAINT "agent_test_judgment_run_id_agent_test_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_test_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_judgment" ADD CONSTRAINT "agent_test_judgment_source_case_id_agent_test_case_id_fk" FOREIGN KEY ("source_case_id") REFERENCES "public"."agent_test_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_judgment_run_idx" ON "agent_test_judgment" USING btree ("run_id","pass");--> statement-breakpoint
CREATE INDEX "test_judgment_case_idx" ON "agent_test_judgment" USING btree ("source_case_id");