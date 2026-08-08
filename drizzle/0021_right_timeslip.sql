ALTER TABLE "members" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "feishu_union_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "members_phone_uidx" ON "members" USING btree ("company_id","phone");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_feishu_union_id_unique" UNIQUE("feishu_union_id");