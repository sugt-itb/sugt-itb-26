-- #284 narrows session_one_online_per_school_per_day from (school_id, held_on, stream) to
-- (school_id, held_on). ADR-0022 (which this supersedes) permitted a school to hold a STEM AND a
-- Research online session on one day, so populated data may hold a same-day pair that would abort the
-- CREATE UNIQUE INDEX below. Cancel the redundant still-standing *arranged* online sessions per
-- (school, held_on) — keeping a delivered one, else the earliest arranged — so at most one still
-- stands. Cancelled rows carry a reason (session_cancelled_iff_reason) and drop out of the partial
-- index. Delivered rows are real history and are never auto-cancelled here; two delivered online
-- sessions on one school-day are a genuine conflict the index build will surface for a human to
-- resolve, rather than this migration rewriting a delivered record. No-op on an empty or already-unique
-- database.
UPDATE "session" s
SET "status" = 'cancelled',
    "cancelled_reason" = 'Dibatalkan otomatis: satu Sesi daring per sekolah per hari (#284)'
WHERE s."perjadin_id" is null
  AND s."status" = 'arranged'
  AND EXISTS (
    SELECT 1 FROM "session" o
    WHERE o."perjadin_id" is null
      AND o."status" <> 'cancelled'
      AND o."id" <> s."id"
      AND o."school_id" = s."school_id"
      AND o."held_on" = s."held_on"
      AND (
        o."status" = 'delivered'
        OR (o."status" = 'arranged' AND (o."created_at", o."id") < (s."created_at", s."id"))
      )
  );--> statement-breakpoint
ALTER TABLE "session" DROP CONSTRAINT "session_stream_not_null";--> statement-breakpoint
ALTER TABLE "session" DROP CONSTRAINT "session_online_iff_pic";--> statement-breakpoint
ALTER TABLE "session" DROP CONSTRAINT "session_online_pic_role_check";--> statement-breakpoint
ALTER TABLE "session" DROP CONSTRAINT "session_pic_pair_check";--> statement-breakpoint
ALTER TABLE "session" DROP CONSTRAINT "session_online_pic_is_staff";
--> statement-breakpoint
DROP INDEX "session_one_online_per_school_per_day";--> statement-breakpoint
CREATE UNIQUE INDEX "session_one_online_per_school_per_day" ON "session" USING btree ("school_id","held_on") WHERE perjadin_id is null and status <> 'cancelled';--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN "online_pic_person_id";--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN "online_pic_role";--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_offline_stream_not_null" CHECK ("session"."mode" <> 'offline' or "session"."stream" is not null);