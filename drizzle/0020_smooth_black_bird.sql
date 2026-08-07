CREATE INDEX "activities_issue_idx" ON "activities" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "company_memberships_company_idx" ON "company_memberships" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "issues_project_idx" ON "issues" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "issues_assignee_idx" ON "issues" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "sprint_snapshots_sprint_idx" ON "sprint_snapshots" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "sub_issues_issue_idx" ON "sub_issues" USING btree ("issue_id");