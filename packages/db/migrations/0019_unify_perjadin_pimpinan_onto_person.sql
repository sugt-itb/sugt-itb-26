ALTER TABLE "perjadin_pimpinan" DROP CONSTRAINT "perjadin_pimpinan_name_check";--> statement-breakpoint
ALTER TABLE "perjadin_pimpinan" DROP CONSTRAINT "perjadin_pimpinan_perjadin_id_name_pk";--> statement-breakpoint
ALTER TABLE "perjadin_pimpinan" ADD COLUMN "person_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "perjadin_pimpinan" ADD COLUMN "role" text DEFAULT 'Pimpinan' NOT NULL;--> statement-breakpoint
ALTER TABLE "perjadin_pimpinan" ADD CONSTRAINT "perjadin_pimpinan_perjadin_id_person_id_pk" PRIMARY KEY("perjadin_id","person_id");--> statement-breakpoint
ALTER TABLE "perjadin_pimpinan" ADD CONSTRAINT "perjadin_pimpinan_is_pimpinan" FOREIGN KEY ("person_id","role") REFERENCES "public"."person"("id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perjadin_pimpinan" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "perjadin_pimpinan" ADD CONSTRAINT "perjadin_pimpinan_role_check" CHECK ("perjadin_pimpinan"."role" = 'Pimpinan');