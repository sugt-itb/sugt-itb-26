CREATE TABLE "assessment_completion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"stream" text NOT NULL,
	"participant_type" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "assessment_completion_box_key" UNIQUE("school_id","stream","participant_type","kind"),
	CONSTRAINT "assessment_completion_stream_check" CHECK ("assessment_completion"."stream" in ('STEM', 'Research')),
	CONSTRAINT "assessment_completion_participant_type_check" CHECK ("assessment_completion"."participant_type" in ('Siswa', 'GTK-MS')),
	CONSTRAINT "assessment_completion_kind_check" CHECK ("assessment_completion"."kind" in ('pretest', 'posttest'))
);
--> statement-breakpoint
ALTER TABLE "assessment_completion" ADD CONSTRAINT "assessment_completion_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;