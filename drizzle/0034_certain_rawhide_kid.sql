ALTER TABLE "teams" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "issues" DROP CONSTRAINT "issues_team_id_teams_id_fk";--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_team_id_teams_id_fk";--> statement-breakpoint
ALTER TABLE "sprints" DROP CONSTRAINT "sprints_team_id_teams_id_fk";--> statement-breakpoint
DROP INDEX "issues_team_idx";--> statement-breakpoint
ALTER TABLE "issues" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "sprints" DROP COLUMN "team_id";--> statement-breakpoint
DROP TABLE "teams";