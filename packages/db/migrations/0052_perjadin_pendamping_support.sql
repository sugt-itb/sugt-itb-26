ALTER TABLE "perjadin_evaluation" DROP CONSTRAINT "perjadin_evaluation_low_rating_needs_prose";--> statement-breakpoint
DROP INDEX "perjadin_evaluation_concerns_idx";--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" ADD COLUMN "pendamping_support" smallint;--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" ADD COLUMN "pendamping_support_comment" text;--> statement-breakpoint
CREATE INDEX "perjadin_evaluation_concerns_idx" ON "perjadin_evaluation" USING btree (least(lodging, transport, meals, punctuality, pendamping_support)) WHERE least(lodging, transport, meals, punctuality, pendamping_support) <= 7;--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" ADD CONSTRAINT "perjadin_evaluation_pendamping_support_check" CHECK ("perjadin_evaluation"."pendamping_support" between 1 and 10);--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" ADD CONSTRAINT "perjadin_evaluation_pendamping_support_rater_check" CHECK ("perjadin_evaluation"."filed_by_role" <> 'Pendamping' or ("perjadin_evaluation"."pendamping_support" is null and "perjadin_evaluation"."pendamping_support_comment" is null));--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" ADD CONSTRAINT "perjadin_evaluation_low_rating_needs_prose" CHECK (("perjadin_evaluation"."lodging" is null or "perjadin_evaluation"."lodging" > 7
             or btrim(coalesce("perjadin_evaluation"."lodging_comment", '')) <> '')
          and ("perjadin_evaluation"."transport" > 7
             or btrim(coalesce("perjadin_evaluation"."transport_comment", '')) <> '')
          and ("perjadin_evaluation"."meals" > 7
             or btrim(coalesce("perjadin_evaluation"."meals_comment", '')) <> '')
          and ("perjadin_evaluation"."punctuality" > 7
             or btrim(coalesce("perjadin_evaluation"."punctuality_comment", '')) <> '')
          and ("perjadin_evaluation"."pendamping_support" is null or "perjadin_evaluation"."pendamping_support" > 7
             or btrim(coalesce("perjadin_evaluation"."pendamping_support_comment", '')) <> ''));