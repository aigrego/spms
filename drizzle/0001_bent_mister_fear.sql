-- Multi-company sandbox migration.
-- Hand-adjusted from the drizzle-kit generated version: the generated SQL added
-- `company_id` as NOT NULL on non-empty tables, which would fail on the live
-- demo data. This version: adds columns nullable → backfills the default
-- company → sets NOT NULL. Backfill order: default company → all business rows
-- → counters → admin memberships → role_permissions matrix.

CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "company_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"name" text NOT NULL,
	"company_id" text,
	"created_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role" text NOT NULL,
	"module" text NOT NULL,
	"level" text NOT NULL,
	CONSTRAINT "role_permissions_role_module_pk" PRIMARY KEY("role","module")
);
--> statement-breakpoint
-- 1. Default company: every existing row is backfilled into it. Fixed id so
--    backfill statements and downstream tooling can reference it directly.
INSERT INTO "companies" ("id", "key", "name", "color", "description") VALUES
	('00000000-0000-0000-0000-000000000001', 'DEFAULT', '默认公司', '#0063D3', '系统默认公司：单公司时代的历史数据归属');
--> statement-breakpoint
-- 2. Add company_id as NULLABLE (existing rows cannot satisfy NOT NULL yet).
ALTER TABLE "activities" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "counters" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "issue_labels" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "labels" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "product_lines" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "resource_assignments" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "sprint_snapshots" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "sprints" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "sub_issues" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "company_id" text;--> statement-breakpoint
-- 3. Backfill every existing business row into the default company.
UPDATE "activities" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "counters" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "issue_labels" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "issues" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "labels" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "members" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "product_lines" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "products" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "projects" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "releases" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "requirements" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "resource_assignments" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "sprint_snapshots" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "sprints" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "sub_issues" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "teams" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "test_cases" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
-- 4. Now enforce NOT NULL.
ALTER TABLE "activities" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "counters" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_labels" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "labels" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "product_lines" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "releases" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "requirements" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_assignments" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sprint_snapshots" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sprints" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sub_issues" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "test_cases" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
-- 5. Swap single-column key uniques for per-company composites.
DROP INDEX "issues_key_uidx";--> statement-breakpoint
DROP INDEX "labels_key_uidx";--> statement-breakpoint
DROP INDEX "members_user_uidx";--> statement-breakpoint
DROP INDEX "members_agent_uidx";--> statement-breakpoint
DROP INDEX "members_email_uidx";--> statement-breakpoint
DROP INDEX "product_lines_key_uidx";--> statement-breakpoint
DROP INDEX "products_key_uidx";--> statement-breakpoint
DROP INDEX "releases_key_uidx";--> statement-breakpoint
DROP INDEX "requirements_key_uidx";--> statement-breakpoint
DROP INDEX "teams_key_uidx";--> statement-breakpoint
DROP INDEX "test_cases_key_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "issues_key_uidx" ON "issues" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_key_uidx" ON "labels" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "members_user_uidx" ON "members" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_agent_uidx" ON "members" USING btree ("company_id","agent_key");--> statement-breakpoint
CREATE UNIQUE INDEX "members_email_uidx" ON "members" USING btree ("company_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "product_lines_key_uidx" ON "product_lines" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "products_key_uidx" ON "products" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_key_uidx" ON "releases" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "requirements_key_uidx" ON "requirements" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_key_uidx" ON "teams" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "test_cases_key_uidx" ON "test_cases" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "company_memberships_user_company_uidx" ON "company_memberships" USING btree ("user_id","company_id");--> statement-breakpoint
-- 6. counters: PK name → (company_id, name).
ALTER TABLE "counters" DROP CONSTRAINT "counters_pkey";--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_company_id_name_pk" PRIMARY KEY("company_id","name");--> statement-breakpoint
-- 7. Foreign keys.
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD CONSTRAINT "mcp_api_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD CONSTRAINT "mcp_api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_lines" ADD CONSTRAINT "product_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_assignments" ADD CONSTRAINT "resource_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_snapshots" ADD CONSTRAINT "sprint_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_issues" ADD CONSTRAINT "sub_issues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 8. Existing platform admins become company_admin of the default company.
INSERT INTO "company_memberships" ("id", "user_id", "company_id", "role")
SELECT 'cm-' || u."id", u."id", '00000000-0000-0000-0000-000000000001', 'company_admin'
FROM "users" u WHERE u."role" = 'admin'
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- 9. Default role-permission matrix (company_admin is implicit full access and
--    intentionally not seeded here).
INSERT INTO "role_permissions" ("role", "module", "level") VALUES
	('product_manager', 'issues', 'write'),
	('product_manager', 'products', 'write'),
	('product_manager', 'requirements', 'write'),
	('product_manager', 'projects', 'write'),
	('product_manager', 'resources', 'write'),
	('product_manager', 'roadmap', 'write'),
	('product_manager', 'backlog', 'write'),
	('product_manager', 'testcases', 'read'),
	('product_manager', 'sprints', 'read'),
	('product_manager', 'agents', 'read'),
	('developer', 'issues', 'write'),
	('developer', 'backlog', 'write'),
	('developer', 'sprints', 'write'),
	('developer', 'products', 'read'),
	('developer', 'requirements', 'read'),
	('developer', 'testcases', 'read'),
	('developer', 'projects', 'read'),
	('developer', 'resources', 'read'),
	('developer', 'roadmap', 'read'),
	('developer', 'agents', 'read'),
	('tester', 'issues', 'write'),
	('tester', 'testcases', 'write'),
	('tester', 'products', 'read'),
	('tester', 'requirements', 'read'),
	('tester', 'projects', 'read'),
	('tester', 'resources', 'read'),
	('tester', 'roadmap', 'read'),
	('tester', 'backlog', 'read'),
	('tester', 'sprints', 'read'),
	('tester', 'agents', 'none'),
	('viewer', 'issues', 'read'),
	('viewer', 'products', 'read'),
	('viewer', 'requirements', 'read'),
	('viewer', 'projects', 'read'),
	('viewer', 'resources', 'read'),
	('viewer', 'roadmap', 'read'),
	('viewer', 'backlog', 'read'),
	('viewer', 'testcases', 'read'),
	('viewer', 'sprints', 'read'),
	('viewer', 'agents', 'read')
ON CONFLICT DO NOTHING;
