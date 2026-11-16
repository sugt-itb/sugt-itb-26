ALTER TABLE "session" ADD COLUMN "drive_footage_upload_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drive_connection" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "drive_connection" ADD COLUMN "footage_copy_lease_until" timestamp with time zone;