CREATE TYPE "public"."test_case_category" AS ENUM('smoke', 'functional', 'integration', 'regression');--> statement-breakpoint
CREATE TABLE "test_run_items" (
	"run_id" text NOT NULL,
	"test_case_id" text NOT NULL,
	"result" "test_result" NOT NULL,
	"note" text,
	CONSTRAINT "test_run_items_run_id_test_case_id_pk" PRIMARY KEY("run_id","test_case_id")
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text,
	"release_id" text,
	"category" "test_case_category" NOT NULL,
	"executor_id" text,
	"total" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"blocked" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "issue_id" text;--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "category" "test_case_category" DEFAULT 'functional' NOT NULL;--> statement-breakpoint
ALTER TABLE "test_run_items" ADD CONSTRAINT "test_run_items_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run_items" ADD CONSTRAINT "test_run_items_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_executor_id_members_id_fk" FOREIGN KEY ("executor_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_runs_company_time_idx" ON "test_runs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "test_runs_project_idx" ON "test_runs" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_cases_issue_idx" ON "test_cases" USING btree ("issue_id");