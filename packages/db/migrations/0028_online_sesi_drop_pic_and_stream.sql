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