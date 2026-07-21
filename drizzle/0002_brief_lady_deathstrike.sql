ALTER TABLE "mcp_api_keys" ADD COLUMN "capabilities" text DEFAULT 'read,write' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD COLUMN "last_used_at" timestamp with time zone;