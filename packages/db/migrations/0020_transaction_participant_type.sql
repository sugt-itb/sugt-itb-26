ALTER TABLE "transaction" DROP CONSTRAINT "transaction_incurred_by_person_id_person_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "participant_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" DROP COLUMN "incurred_by_person_id";--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_participant_type_check" CHECK ("transaction"."participant_type" in ('Siswa', 'GTK-MS'));