ALTER TABLE "session_teacher_name" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "session_teacher_name" CASCADE;--> statement-breakpoint
ALTER TABLE "session" DROP CONSTRAINT "session_participant_type_check";--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "pengajar_siswa_name" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "pengajar_gtk_ms_name" text;--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN "participant_type";--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_online_pengajar_not_null" CHECK ("session"."mode" <> 'online' or ("session"."pengajar_siswa_name" is not null and "session"."pengajar_gtk_ms_name" is not null));