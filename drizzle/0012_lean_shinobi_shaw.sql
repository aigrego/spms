ALTER TABLE "issues" ADD COLUMN "completed_at" timestamp with time zone;

-- 存量回填:已完成 issue 的完成时间。非 Notion 同步的用 updated_at 近似
-- (状态变更会 bump);Notion 同步的真实完成时刻不可考,用创建时间
-- (Notion created_time,此前已回写)近似 —— 与同步代码的口径一致。
UPDATE "issues" SET "completed_at" = "updated_at" WHERE "status" = 'done' AND "completed_at" IS NULL;
UPDATE "issues" i SET "completed_at" = i."created_at"
FROM "notion_issue_links" l
WHERE l."issue_id" = i."id" AND i."status" = 'done';
