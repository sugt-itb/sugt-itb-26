ALTER TABLE "person" DROP CONSTRAINT "person_role_check";--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_role_check" CHECK ("person"."role" in ('Staff', 'Pimpinan'));