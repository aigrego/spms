-- 存量「评审中」迁入「待测试」(需在枚举重建前执行,否则 text→enum 回cast 报错)
UPDATE "issues" SET "status" = 'testing' WHERE "status" = 'in_review';--> statement-breakpoint
UPDATE "sub_issues" SET "status" = 'testing' WHERE "status" = 'in_review';--> statement-breakpoint
ALTER TABLE "issues" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "issues" ALTER COLUMN "status" SET DEFAULT 'todo'::text;--> statement-breakpoint
ALTER TABLE "sub_issues" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sub_issues" ALTER COLUMN "status" SET DEFAULT 'todo'::text;--> statement-breakpoint
DROP TYPE "public"."issue_status";--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('backlog', 'todo', 'in_progress', 'testing', 'done', 'canceled');--> statement-breakpoint
ALTER TABLE "issues" ALTER COLUMN "status" SET DEFAULT 'todo'::"public"."issue_status";--> statement-breakpoint
ALTER TABLE "issues" ALTER COLUMN "status" SET DATA TYPE "public"."issue_status" USING "status"::"public"."issue_status";--> statement-breakpoint
ALTER TABLE "sub_issues" ALTER COLUMN "status" SET DEFAULT 'todo'::"public"."issue_status";--> statement-breakpoint
ALTER TABLE "sub_issues" ALTER COLUMN "status" SET DATA TYPE "public"."issue_status" USING "status"::"public"."issue_status";