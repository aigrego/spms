ALTER TABLE "requirements" ADD COLUMN "sprint_id" text;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "assignee_id" text;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_assignee_id_members_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requirements_sprint_idx" ON "requirements" USING btree ("sprint_id");