ALTER TABLE "role_permissions" ADD COLUMN IF NOT EXISTS "company_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_role_module_pk";--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_company_id_role_module_pk" PRIMARY KEY("company_id","role","module");
