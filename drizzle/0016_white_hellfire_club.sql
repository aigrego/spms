CREATE TABLE "sprint_projects" (
	"company_id" text NOT NULL,
	"sprint_id" text NOT NULL,
	"project_id" text NOT NULL,
	CONSTRAINT "sprint_projects_sprint_id_project_id_pk" PRIMARY KEY("sprint_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "sprint_projects" ADD CONSTRAINT "sprint_projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_projects" ADD CONSTRAINT "sprint_projects_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_projects" ADD CONSTRAINT "sprint_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 迭代改为多项目(sprints.project_id → sprint_projects 多对多):先回填存量单项目关联,再删旧列
INSERT INTO "sprint_projects" ("company_id", "sprint_id", "project_id")
SELECT "company_id", "id", "project_id" FROM "sprints" WHERE "project_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "sprints" DROP CONSTRAINT "sprints_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "sprints" DROP COLUMN "project_id";
