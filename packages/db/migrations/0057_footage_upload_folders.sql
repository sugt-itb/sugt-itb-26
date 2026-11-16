ALTER TABLE "perjadin" ADD COLUMN "drive_footage_upload_folder_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "drive_footage_upload_folder_id" text;--> statement-breakpoint
ALTER TABLE "drive_connection" ADD COLUMN "footage_upload_folder_id" text;--> statement-breakpoint
ALTER TABLE "drive_connection" ADD COLUMN "footage_upload_pelaksanaan_offline_folder_id" text;