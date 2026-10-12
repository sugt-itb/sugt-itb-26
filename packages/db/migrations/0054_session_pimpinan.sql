-- A Pimpinan is recorded per Session, not per Perjadin (#492, ADR-0056). The new table keeps
-- `perjadin_pimpinan`'s guarantee — the composite FK into `person (id, role)` with the role pinned
-- to 'Pimpinan' — and cascades with its Session, like `session_teaching_team`.
CREATE TABLE "session_pimpinan" (
	"session_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text DEFAULT 'Pimpinan' NOT NULL,
	CONSTRAINT "session_pimpinan_session_id_person_id_pk" PRIMARY KEY("session_id","person_id"),
	CONSTRAINT "session_pimpinan_role_check" CHECK ("session_pimpinan"."role" = 'Pimpinan')
);
--> statement-breakpoint
ALTER TABLE "session_pimpinan" ADD CONSTRAINT "session_pimpinan_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_pimpinan" ADD CONSTRAINT "session_pimpinan_is_pimpinan" FOREIGN KEY ("person_id","role") REFERENCES "public"."person"("id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Every trip Pimpinan is copied onto every non-cancelled Session of that trip, which keeps today's
-- meaning ("came on the trip"); writers then remove them from the Sessions they missed. A trip with
-- no live Session copies onto all its Sessions instead, so nothing is lost. A trip with no Session
-- at all has nowhere to keep its Pimpinan; the migration test shows the query that counts those
-- rows, which is expected to find none on the live data.
INSERT INTO "session_pimpinan" ("session_id", "person_id", "role")
SELECT "session"."id", "perjadin_pimpinan"."person_id", 'Pimpinan'
FROM "perjadin_pimpinan"
JOIN "session" ON "session"."perjadin_id" = "perjadin_pimpinan"."perjadin_id"
WHERE "session"."status" <> 'cancelled'
	OR NOT EXISTS (
		SELECT 1 FROM "session" AS "live"
		WHERE "live"."perjadin_id" = "perjadin_pimpinan"."perjadin_id"
			AND "live"."status" <> 'cancelled'
	);--> statement-breakpoint
DROP TABLE "perjadin_pimpinan" CASCADE;
