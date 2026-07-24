CREATE TABLE "notion_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"workspace_id" text,
	"workspace_name" text,
	"bot_id" text,
	"access_token" text NOT NULL,
	"database_id" text,
	"database_name" text,
	"project_id" text,
	"last_synced_at" timestamp with time zone,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notion_issue_links" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"notion_page_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"notion_last_edited_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notion_connections" ADD CONSTRAINT "notion_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_connections" ADD CONSTRAINT "notion_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_connections" ADD CONSTRAINT "notion_connections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_issue_links" ADD CONSTRAINT "notion_issue_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_issue_links" ADD CONSTRAINT "notion_issue_links_connection_id_notion_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."notion_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_issue_links" ADD CONSTRAINT "notion_issue_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notion_connections_company_uidx" ON "notion_connections" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notion_issue_links_conn_page_uidx" ON "notion_issue_links" USING btree ("connection_id","notion_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notion_issue_links_issue_uidx" ON "notion_issue_links" USING btree ("issue_id");