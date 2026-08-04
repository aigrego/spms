-- 日报条目粒度:项目 → 产品(TKT-7)。对已有数据安全:
-- 1) 加可空 product_id;2) 按 项目 → 版本(release)→ 产品 回填;
-- 3) 同一日报内多个项目映射到同一产品时合并为一条,保证唯一索引可建;
-- 4) 项目无 release、无法推导产品的条目删除;5) 收紧约束并替换索引/FK,删旧列。
ALTER TABLE "daily_report_entries" ADD COLUMN "product_id" text;--> statement-breakpoint
UPDATE "daily_report_entries" e
SET "product_id" = r."product_id"
FROM "projects" p
JOIN "releases" r ON p."release_id" = r."id"
WHERE e."project_id" = p."id";--> statement-breakpoint
UPDATE "daily_report_entries" e
SET "content" = (
	SELECT string_agg(d."content", E'\n' ORDER BY d."position")
	FROM "daily_report_entries" d
	WHERE d."report_id" = e."report_id" AND d."product_id" = e."product_id"
)
WHERE EXISTS (
	SELECT 1 FROM "daily_report_entries" d
	WHERE d."report_id" = e."report_id" AND d."product_id" = e."product_id" AND d."id" <> e."id"
);--> statement-breakpoint
DELETE FROM "daily_report_entries" a
USING "daily_report_entries" b
WHERE a."report_id" = b."report_id"
	AND a."product_id" = b."product_id"
	AND a."position" > b."position";--> statement-breakpoint
DELETE FROM "daily_report_entries" WHERE "product_id" IS NULL;--> statement-breakpoint
ALTER TABLE "daily_report_entries" ALTER COLUMN "product_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_report_entries" DROP CONSTRAINT "daily_report_entries_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "daily_report_entries" ADD CONSTRAINT "daily_report_entries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX "daily_report_entries_report_project_uidx";--> statement-breakpoint
DROP INDEX "daily_report_entries_company_project_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "daily_report_entries_report_product_uidx" ON "daily_report_entries" USING btree ("report_id","product_id");--> statement-breakpoint
CREATE INDEX "daily_report_entries_company_product_idx" ON "daily_report_entries" USING btree ("company_id","product_id");--> statement-breakpoint
ALTER TABLE "daily_report_entries" DROP COLUMN "project_id";
