ALTER TABLE "issues" ADD COLUMN "key_num" integer GENERATED ALWAYS AS (case when "key" ~ '\d+$' then cast(substring("key" from '\d+$') as integer) else 0 end) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "issues_key_num_idx" ON "issues" USING btree ("company_id","key_num","key");--> statement-breakpoint
ALTER TABLE "issues" DROP COLUMN "backlog_rank";