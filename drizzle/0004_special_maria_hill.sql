ALTER TABLE "mcp_api_keys" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD CONSTRAINT "mcp_api_keys_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "mcp_api_keys" SET "owner_id" = "created_by";