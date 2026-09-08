CREATE TABLE "perjadin_feedback_token" (
	"perjadin_id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '14 days' NOT NULL,
	"issued_by_person_id" uuid NOT NULL,
	CONSTRAINT "perjadin_feedback_token_token_unique" UNIQUE("token"),
	CONSTRAINT "perjadin_feedback_token_expiry_check" CHECK ("perjadin_feedback_token"."expires_at" > "perjadin_feedback_token"."issued_at")
);
--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" DROP CONSTRAINT "perjadin_evaluation_one_per_filer";--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" DROP CONSTRAINT "perjadin_evaluation_filed_by_person_id_person_id_fk";
--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" ADD COLUMN "filed_by_role" text NOT NULL;--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" ADD COLUMN "filed_by_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "perjadin_feedback_token" ADD CONSTRAINT "perjadin_feedback_token_perjadin_id_perjadin_id_fk" FOREIGN KEY ("perjadin_id") REFERENCES "public"."perjadin"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perjadin_feedback_token" ADD CONSTRAINT "perjadin_feedback_token_issued_by_person_id_person_id_fk" FOREIGN KEY ("issued_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" DROP COLUMN "filed_by_person_id";--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" ADD CONSTRAINT "perjadin_evaluation_filed_by_role_check" CHECK ("perjadin_evaluation"."filed_by_role" in ('Pengajar', 'Pendamping', 'Pimpinan'));