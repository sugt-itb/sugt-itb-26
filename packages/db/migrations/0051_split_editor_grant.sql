-- Editor splits into Perjadin Editor, Daring Editor and Dashboard Editor, and Keuangan is added
-- (#469, ADR-0052). Every Editor gets all three, keeping their `granted_at`, so nobody gains or loses
-- access when this deploys; an Administrator trims afterwards. The CHECK is dropped first, since the
-- new values are not legal until it is re-added, and Editor is not legal after.
ALTER TABLE "person_grant" DROP CONSTRAINT "person_grant_grant_check";--> statement-breakpoint
INSERT INTO "person_grant" ("person_id", "grant", "granted_at")
SELECT "person_grant"."person_id", "split"."grant", "person_grant"."granted_at"
FROM "person_grant"
CROSS JOIN (VALUES ('Perjadin Editor'), ('Daring Editor'), ('Dashboard Editor')) AS "split" ("grant")
WHERE "person_grant"."grant" = 'Editor'
ON CONFLICT ON CONSTRAINT "person_grant_person_id_grant_key" DO NOTHING;--> statement-breakpoint
DELETE FROM "person_grant" WHERE "grant" = 'Editor';--> statement-breakpoint
ALTER TABLE "person_grant" ADD CONSTRAINT "person_grant_grant_check" CHECK ("person_grant"."grant" in ('Administrator', 'Keuangan', 'Perjadin Editor', 'Daring Editor', 'Dashboard Editor', 'Dashboard Viewer'));
