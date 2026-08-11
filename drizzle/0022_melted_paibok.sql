CREATE TABLE "issue_status_transitions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"from_status" "issue_status",
	"to_status" "issue_status" NOT NULL,
	"who_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_status_transitions" ADD CONSTRAINT "issue_status_transitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_status_transitions" ADD CONSTRAINT "issue_status_transitions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_status_transitions" ADD CONSTRAINT "issue_status_transitions_who_id_members_id_fk" FOREIGN KEY ("who_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_status_transitions_company_time_idx" ON "issue_status_transitions" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_status_transitions_issue_idx" ON "issue_status_transitions" USING btree ("issue_id");--> statement-breakpoint
-- Backfill: replay the kind='status' activity feed ("状态变更为 <to>") into
-- structured transitions; from_status chains via the previous entry per issue
-- (NULL = 起始状态未知). Archive notes and non-status bodies don't match the
-- pattern and are skipped. Legacy status 'in_review' (pre-rewrite 可测试) maps
-- to 'testing'; anything else outside the current enum is dropped.
INSERT INTO "issue_status_transitions" ("id", "company_id", "issue_id", "from_status", "to_status", "who_id", "created_at")
SELECT
	gen_random_uuid()::text,
	"s"."company_id",
	"s"."issue_id",
	LAG("s"."to_s"::"issue_status") OVER (PARTITION BY "s"."issue_id" ORDER BY "s"."created_at", "s"."id"),
	"s"."to_s"::"issue_status",
	"s"."who_id",
	"s"."created_at"
FROM (
	SELECT
		"company_id",
		"issue_id",
		"who_id",
		"created_at",
		"id",
		CASE substring("body" from '状态变更为 (\S+)')
			WHEN 'in_review' THEN 'testing'
			ELSE substring("body" from '状态变更为 (\S+)')
		END AS "to_s"
	FROM "activities"
	WHERE "kind" = 'status' AND "body" ~ '^状态变更为 \S+$'
) "s"
WHERE "s"."to_s" = ANY (enum_range(null::"issue_status")::text[]);