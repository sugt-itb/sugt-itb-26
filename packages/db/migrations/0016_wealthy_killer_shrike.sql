ALTER TABLE "perjadin_evaluation" DROP CONSTRAINT "perjadin_evaluation_low_rating_needs_prose";--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" ADD COLUMN "lodging_comment" text;--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" ADD COLUMN "transport_comment" text;--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" ADD COLUMN "meals_comment" text;--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" ADD COLUMN "punctuality_comment" text;--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" DROP COLUMN "problems";--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" DROP COLUMN "suggestions";--> statement-breakpoint
ALTER TABLE "perjadin_evaluation" ADD CONSTRAINT "perjadin_evaluation_low_rating_needs_prose" CHECK (("perjadin_evaluation"."lodging" is null or "perjadin_evaluation"."lodging" > 7
             or btrim(coalesce("perjadin_evaluation"."lodging_comment", '')) <> '')
          and ("perjadin_evaluation"."transport" > 7
             or btrim(coalesce("perjadin_evaluation"."transport_comment", '')) <> '')
          and ("perjadin_evaluation"."meals" > 7
             or btrim(coalesce("perjadin_evaluation"."meals_comment", '')) <> '')
          and ("perjadin_evaluation"."punctuality" > 7
             or btrim(coalesce("perjadin_evaluation"."punctuality_comment", '')) <> ''));