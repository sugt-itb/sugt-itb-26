-- The Keuangan Grant comes back for /keuangan's Block B budget view, and keuangan_source names the
-- spreadsheet tab it reads: one row or none, set by an Administrator (#549, ADR-0064). The CHECK is
-- only widened, so nothing is deleted; #533 removed the old holders and they are not restored.
-- Run this before deploying the code: the new code offers a Grant the old CHECK refuses.
CREATE TABLE "keuangan_source" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"url" text NOT NULL,
	"sheet_id" text NOT NULL,
	"gid" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"set_by_person_id" uuid NOT NULL,
	CONSTRAINT "keuangan_source_singleton_check" CHECK ("keuangan_source"."singleton")
);
--> statement-breakpoint
ALTER TABLE "person_grant" DROP CONSTRAINT "person_grant_grant_check";--> statement-breakpoint
ALTER TABLE "keuangan_source" ADD CONSTRAINT "keuangan_source_set_by_person_id_person_id_fk" FOREIGN KEY ("set_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_grant" ADD CONSTRAINT "person_grant_grant_check" CHECK ("person_grant"."grant" in ('Administrator', 'Perjadin Editor', 'Daring Editor', 'Dashboard Editor', 'Dashboard Viewer', 'Keuangan'));