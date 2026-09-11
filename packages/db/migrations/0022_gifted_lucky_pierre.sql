CREATE TABLE "person_grant" (
	"person_id" uuid NOT NULL,
	"grant" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_grant_person_id_grant_key" UNIQUE("person_id","grant"),
	CONSTRAINT "person_grant_grant_check" CHECK ("person_grant"."grant" in ('Administrator', 'Monitoring Editor'))
);
--> statement-breakpoint
ALTER TABLE "person_grant" ADD CONSTRAINT "person_grant_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;