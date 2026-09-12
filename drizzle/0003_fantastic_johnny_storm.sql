CREATE TABLE "delivery_zone" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"comuna" text NOT NULL,
	"costo_despacho" numeric(12, 4),
	"activa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"producto" text NOT NULL,
	"masa" text NOT NULL,
	"formato" text NOT NULL,
	"unidades_por_bolsa" integer NOT NULL,
	"precio_unitario_neto" numeric(12, 4) NOT NULL,
	"precio_bolsa_neto" numeric(12, 4) NOT NULL,
	"precio_bolsa_con_iva" numeric(12, 4) NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"notas" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_cost" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"costo" numeric(12, 4),
	"margen" numeric(12, 4),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "empresa" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "rubro" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "comuna" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "rut" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "razon_social" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "giro" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "direccion_facturacion" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "frecuencia_despacho" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "volumen_semanal" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "producto_interes" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "formato" text;--> statement-breakpoint
ALTER TABLE "delivery_zone" ADD CONSTRAINT "delivery_zone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_cost" ADD CONSTRAINT "product_cost_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_cost" ADD CONSTRAINT "product_cost_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_zone_org_comuna_uq" ON "delivery_zone" USING btree ("organization_id","comuna");--> statement-breakpoint
CREATE INDEX "delivery_zone_org_idx" ON "delivery_zone" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_org_sku_uq" ON "product" USING btree ("organization_id","producto","masa","formato");--> statement-breakpoint
CREATE INDEX "product_org_idx" ON "product" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_cost_product_uq" ON "product_cost" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_cost_org_idx" ON "product_cost" USING btree ("organization_id");