-- 需求状态与 issue 对齐：requirements.status 从 requirement_status 枚举迁移到
-- issue_status 枚举。语义映射：in_dev→in_progress、shipped→done、rejected→canceled、
-- 其余（draft/reviewing/approved）→todo。迁移完成后删除 requirement_status 枚举。
ALTER TABLE "requirements" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "requirements" ALTER COLUMN "status" TYPE issue_status
  USING (CASE "status"::text
    WHEN 'in_dev' THEN 'in_progress'
    WHEN 'shipped' THEN 'done'
    WHEN 'rejected' THEN 'canceled'
    ELSE 'todo' END)::issue_status;
ALTER TABLE "requirements" ALTER COLUMN "status" SET DEFAULT 'todo'::issue_status;
DROP TYPE "requirement_status";
