ALTER TABLE "session" ADD COLUMN "ends_at" time;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "participant_type" text;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_participant_type_check" CHECK ("session"."participant_type" is null or "session"."participant_type" in ('Siswa', 'GTK-MS'));--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_ends_after_starts_check" CHECK ("session"."ends_at" is null or "session"."ends_at" > "session"."starts_at");