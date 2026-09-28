CREATE TABLE "platform_storage_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"backend" text NOT NULL,
	"endpoint" text,
	"port" integer,
	"use_ssl" boolean DEFAULT true NOT NULL,
	"access_key_enc" text,
	"secret_key_enc" text,
	"bucket" text,
	"public_base_url" text,
	"token_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_storage_configs" ADD COLUMN "provisioned" text;