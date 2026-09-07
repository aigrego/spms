CREATE TYPE "public"."requirement_status" AS ENUM('draft', 'reviewing', 'approved', 'in_dev', 'shipped', 'rejected');--> statement-breakpoint
ALTER TABLE "requirements" DROP CONSTRAINT "requirements_sprint_id_sprints_id_fk";
--> statement-breakpoint
DROP INDEX "requirements_sprint_idx";--> statement-breakpoint
ALTER TABLE "requirements" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
-- 回滚「需求状态对齐 issue」:requirements.status 从 issue_status 迁回 requirement_status
-- 枚举。语义映射:in_progress/testing→in_dev、done→shipped、canceled→rejected、
-- 其余(todo/backlog)→draft。
ALTER TABLE "requirements" ALTER COLUMN "status" SET DATA TYPE "public"."requirement_status" USING (CASE "status"::text
  WHEN 'in_progress' THEN 'in_dev'
  WHEN 'testing' THEN 'in_dev'
  WHEN 'done' THEN 'shipped'
  WHEN 'canceled' THEN 'rejected'
  ELSE 'draft' END)::"public"."requirement_status";--> statement-breakpoint
ALTER TABLE "requirements" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "requirements" DROP COLUMN "sprint_id";