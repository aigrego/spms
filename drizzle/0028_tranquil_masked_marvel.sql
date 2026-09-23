CREATE TABLE "company_storage_configs" (
	"company_id" text PRIMARY KEY NOT NULL,
	"backend" text NOT NULL,
	"endpoint" text,
	"port" integer,
	"use_ssl" boolean DEFAULT true NOT NULL,
	"access_key_enc" text,
	"secret_key_enc" text,
	"bucket" text,
	"token_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_provider_configs" (
	"provider" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"app_secret_enc" text NOT NULL,
	"redirect_uri" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_attachments" ADD COLUMN "object_key" text;--> statement-breakpoint
ALTER TABLE "company_storage_configs" ADD CONSTRAINT "company_storage_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;