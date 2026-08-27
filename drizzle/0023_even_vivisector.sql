CREATE TYPE "public"."plan_status" AS ENUM('draft', 'generated');--> statement-breakpoint
CREATE TABLE "plan_requirements" (
	"company_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"requirement_id" text NOT NULL,
	CONSTRAINT "plan_requirements_plan_id_requirement_id_pk" PRIMARY KEY("plan_id","requirement_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"key" text NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"template_md" text,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"author_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_requirements" ADD CONSTRAINT "plan_requirements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_requirements" ADD CONSTRAINT "plan_requirements_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_requirements" ADD CONSTRAINT "plan_requirements_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_key_uidx" ON "plans" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX "plans_project_idx" ON "plans" USING btree ("project_id");