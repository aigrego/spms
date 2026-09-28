-- 手工改写(ATTACHMENT-REKEY M2,计划 §2):drizzle-kit 不认识表改名,默认生成
-- drop+create 会丢全部存量附件行,改写为 RENAME + 增量 ALTER。改名后既有
-- FK/索引保留旧名,一并 RENAME 成 drizzle 快照的新表名风格命名。
ALTER TABLE "issue_attachments" RENAME TO "attachments";--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "issue_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "test_case_id" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "requirement_id" text;--> statement-breakpoint
ALTER TABLE "attachments" RENAME CONSTRAINT "issue_attachments_company_id_companies_id_fk" TO "attachments_company_id_companies_id_fk";--> statement-breakpoint
ALTER TABLE "attachments" RENAME CONSTRAINT "issue_attachments_issue_id_issues_id_fk" TO "attachments_issue_id_issues_id_fk";--> statement-breakpoint
ALTER TABLE "attachments" RENAME CONSTRAINT "issue_attachments_uploaded_by_id_members_id_fk" TO "attachments_uploaded_by_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_one_owner_chk" CHECK (num_nonnulls(issue_id, test_case_id, requirement_id) = 1);--> statement-breakpoint
ALTER INDEX "issue_attachments_issue_idx" RENAME TO "attachments_issue_idx";--> statement-breakpoint
CREATE INDEX "attachments_test_case_idx" ON "attachments" USING btree ("test_case_id");--> statement-breakpoint
CREATE INDEX "attachments_requirement_idx" ON "attachments" USING btree ("requirement_id");
