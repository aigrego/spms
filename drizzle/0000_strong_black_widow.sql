CREATE TYPE "public"."activity_kind" AS ENUM('created', 'status', 'assign', 'comment', 'ai');--> statement-breakpoint
CREATE TYPE "public"."assignment_node" AS ENUM('product', 'release', 'project', 'sprint');--> statement-breakpoint
CREATE TYPE "public"."assignment_role" AS ENUM('lead', 'member');--> statement-breakpoint
CREATE TYPE "public"."assignment_source" AS ENUM('direct', 'propagated');--> statement-breakpoint
CREATE TYPE "public"."issue_importance" AS ENUM('critical', 'high', 'medium', 'low', 'none');--> statement-breakpoint
CREATE TYPE "public"."issue_priority" AS ENUM('urgent', 'high', 'medium', 'low', 'none');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."issue_type" AS ENUM('backlog', 'ticket', 'bug');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_phase" AS ENUM('concept', 'development', 'release', 'maintenance', 'retired');--> statement-breakpoint
CREATE TYPE "public"."member_origin" AS ENUM('internal', 'external');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'invited', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."member_type" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('active', 'maintenance', 'archived');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('backlog', 'planned', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('planned', 'in_progress', 'released', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."requirement_category" AS ENUM('performance', 'security', 'usability', 'reliability', 'compatibility', 'maintainability');--> statement-breakpoint
CREATE TYPE "public"."requirement_status" AS ENUM('draft', 'reviewing', 'approved', 'in_dev', 'shipped', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."requirement_type" AS ENUM('functional', 'non_functional');--> statement-breakpoint
CREATE TYPE "public"."sprint_status" AS ENUM('planned', 'active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."test_case_status" AS ENUM('draft', 'active', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."test_result" AS ENUM('untested', 'passed', 'failed', 'blocked');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"who_id" text,
	"kind" "activity_kind" DEFAULT 'comment' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"name" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_labels" (
	"issue_id" text NOT NULL,
	"label_id" text NOT NULL,
	CONSTRAINT "issue_labels_issue_id_label_id_pk" PRIMARY KEY("issue_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"team_id" text,
	"title" text NOT NULL,
	"description" text,
	"type" "issue_type" DEFAULT 'ticket' NOT NULL,
	"status" "issue_status" DEFAULT 'todo' NOT NULL,
	"priority" "issue_priority" DEFAULT 'none' NOT NULL,
	"importance" "issue_importance" DEFAULT 'none' NOT NULL,
	"assignee_id" text,
	"project_id" text,
	"requirement_id" text,
	"sprint_id" text,
	"estimate" integer,
	"story_points" integer,
	"backlog_rank" integer DEFAULT 0 NOT NULL,
	"ai_assigned" boolean DEFAULT false NOT NULL,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "member_type" DEFAULT 'human' NOT NULL,
	"name" text NOT NULL,
	"initials" text NOT NULL,
	"color" text,
	"role" text,
	"user_id" text,
	"agent_key" text,
	"origin" "member_origin" DEFAULT 'internal' NOT NULL,
	"email" text,
	"status" "member_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#0063D3' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"product_line_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'box' NOT NULL,
	"color" text DEFAULT '#0063D3' NOT NULL,
	"status" "product_status" DEFAULT 'active' NOT NULL,
	"lead_id" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"team_id" text,
	"release_id" text,
	"status" "project_status" DEFAULT 'backlog' NOT NULL,
	"lead_id" text,
	"ai_lead_id" text,
	"icon" text DEFAULT 'box' NOT NULL,
	"color" text DEFAULT '#0063D3' NOT NULL,
	"target" text,
	"progress" real DEFAULT 0 NOT NULL,
	"description" text,
	"summary" text,
	"goal" text,
	"non_goals" text
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "release_status" DEFAULT 'planned' NOT NULL,
	"phase" "lifecycle_phase" DEFAULT 'concept' NOT NULL,
	"target_date" timestamp with time zone,
	"progress" real DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"project_id" text NOT NULL,
	"release_id" text,
	"title" text NOT NULL,
	"type" "requirement_type" DEFAULT 'functional' NOT NULL,
	"category" "requirement_category",
	"priority" "issue_priority" DEFAULT 'none' NOT NULL,
	"importance" "issue_importance" DEFAULT 'none' NOT NULL,
	"status" "requirement_status" DEFAULT 'draft' NOT NULL,
	"description" text,
	"acceptance_criteria" text,
	"author_id" text,
	"ai_owner_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"node_type" "assignment_node" NOT NULL,
	"node_id" text NOT NULL,
	"member_id" text NOT NULL,
	"role" "assignment_role" DEFAULT 'member' NOT NULL,
	"source" "assignment_source" DEFAULT 'direct' NOT NULL,
	"added_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprint_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"sprint_id" text NOT NULL,
	"day" timestamp with time zone NOT NULL,
	"remaining_points" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprints" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text,
	"project_id" text,
	"name" text NOT NULL,
	"goal" text,
	"status" "sprint_status" DEFAULT 'planned' NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"capacity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"title" text NOT NULL,
	"status" "issue_status" DEFAULT 'todo' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"project_id" text NOT NULL,
	"requirement_id" text,
	"title" text NOT NULL,
	"priority" "issue_priority" DEFAULT 'none' NOT NULL,
	"status" "test_case_status" DEFAULT 'draft' NOT NULL,
	"result" "test_result" DEFAULT 'untested' NOT NULL,
	"preconditions" text,
	"steps" text,
	"expected" text,
	"author_id" text,
	"assignee_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"lark_union_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_lark_union_id_unique" UNIQUE("lark_union_id")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_who_id_members_id_fk" FOREIGN KEY ("who_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignee_id_members_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_product_line_id_product_lines_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_lead_id_members_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_id_members_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_ai_lead_id_members_id_fk" FOREIGN KEY ("ai_lead_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_ai_owner_id_members_id_fk" FOREIGN KEY ("ai_owner_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_assignments" ADD CONSTRAINT "resource_assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_assignments" ADD CONSTRAINT "resource_assignments_added_by_id_members_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_snapshots" ADD CONSTRAINT "sprint_snapshots_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_issues" ADD CONSTRAINT "sub_issues_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_assignee_id_members_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issues_key_uidx" ON "issues" USING btree ("key");--> statement-breakpoint
CREATE INDEX "issues_team_idx" ON "issues" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "issues_sprint_idx" ON "issues" USING btree ("sprint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_key_uidx" ON "labels" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "members_user_uidx" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_agent_uidx" ON "members" USING btree ("agent_key");--> statement-breakpoint
CREATE UNIQUE INDEX "members_email_uidx" ON "members" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "product_lines_key_uidx" ON "product_lines" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "products_key_uidx" ON "products" USING btree ("key");--> statement-breakpoint
CREATE INDEX "products_line_idx" ON "products" USING btree ("product_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_key_uidx" ON "releases" USING btree ("key");--> statement-breakpoint
CREATE INDEX "releases_product_idx" ON "releases" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requirements_key_uidx" ON "requirements" USING btree ("key");--> statement-breakpoint
CREATE INDEX "requirements_project_idx" ON "requirements" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ra_node_member_uidx" ON "resource_assignments" USING btree ("node_type","node_id","member_id");--> statement-breakpoint
CREATE INDEX "ra_node_idx" ON "resource_assignments" USING btree ("node_type","node_id");--> statement-breakpoint
CREATE INDEX "ra_member_idx" ON "resource_assignments" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_key_uidx" ON "teams" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "test_cases_key_uidx" ON "test_cases" USING btree ("key");--> statement-breakpoint
CREATE INDEX "test_cases_project_idx" ON "test_cases" USING btree ("project_id");