CREATE TABLE "daily_report_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"content" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"member_id" text NOT NULL,
	"date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_report_entries" ADD CONSTRAINT "daily_report_entries_report_id_daily_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."daily_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_entries" ADD CONSTRAINT "daily_report_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_entries" ADD CONSTRAINT "daily_report_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_report_entries_report_project_uidx" ON "daily_report_entries" USING btree ("report_id","project_id");--> statement-breakpoint
CREATE INDEX "daily_report_entries_company_project_idx" ON "daily_report_entries" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reports_member_day_uidx" ON "daily_reports" USING btree ("company_id","member_id","date");--> statement-breakpoint
CREATE INDEX "daily_reports_company_date_idx" ON "daily_reports" USING btree ("company_id","date");