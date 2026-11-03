-- The Keuangan Grant is retired with /keuangan, the only thing it unlocked (#533, ADR-0059). Its rows
-- go, including the record of who held it; other Grants a holder has are untouched, and someone who
-- held only this one becomes grant-less Staff. Hand-added between the drop and the add, as in 0051,
-- since the CHECK would otherwise refuse the existing rows. Deploy the code before this runs: the old
-- code would offer a Grant the database refuses.
ALTER TABLE "person_grant" DROP CONSTRAINT "person_grant_grant_check";--> statement-breakpoint
DELETE FROM "person_grant" WHERE "grant" = 'Keuangan';--> statement-breakpoint
ALTER TABLE "person_grant" ADD CONSTRAINT "person_grant_grant_check" CHECK ("person_grant"."grant" in ('Administrator', 'Perjadin Editor', 'Daring Editor', 'Dashboard Editor', 'Dashboard Viewer'));