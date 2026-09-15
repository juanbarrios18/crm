CREATE TABLE "product_cost_movement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"costo_unitario" numeric(12, 4) NOT NULL,
	"vigente_desde" timestamp DEFAULT now() NOT NULL,
	"origen" text DEFAULT 'manual' NOT NULL,
	"referencia" text,
	"nota" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Red de seguridad: hoy `product_cost` está vacía en todos los entornos porque
-- ningún camino de código la escribió (era código muerto). Si algún entorno
-- tuviera filas, se migran como el PRIMER movimiento del ledger para no perder
-- el dato; `updated_at` es lo más cercano a "desde cuándo rige" que había.
INSERT INTO "product_cost_movement" ("id", "organization_id", "product_id", "costo_unitario", "vigente_desde", "origen", "nota", "created_at")
SELECT 'pcm_' || substr(md5(random()::text), 1, 20), "organization_id", "product_id", "costo", COALESCE("updated_at", now()), 'importacion', 'Migrado desde product_cost', COALESCE("updated_at", now())
FROM "product_cost" WHERE "costo" IS NOT NULL;--> statement-breakpoint
DROP TABLE "product_cost" CASCADE;--> statement-breakpoint
ALTER TABLE "product_cost_movement" ADD CONSTRAINT "product_cost_movement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_cost_movement" ADD CONSTRAINT "product_cost_movement_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_cost_movement_org_product_vigente_idx" ON "product_cost_movement" USING btree ("organization_id","product_id","vigente_desde");--> statement-breakpoint
CREATE UNIQUE INDEX "product_cost_movement_org_referencia_uq" ON "product_cost_movement" USING btree ("organization_id","referencia") WHERE "product_cost_movement"."referencia" is not null;