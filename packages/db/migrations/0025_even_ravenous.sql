ALTER TABLE "person_grant" DROP CONSTRAINT "person_grant_grant_check";--> statement-breakpoint
UPDATE "person_grant" SET "grant" = 'Editor' WHERE "grant" = 'Monitoring Editor';--> statement-breakpoint
ALTER TABLE "person_grant" ADD CONSTRAINT "person_grant_grant_check" CHECK ("person_grant"."grant" in ('Administrator', 'Editor'));
