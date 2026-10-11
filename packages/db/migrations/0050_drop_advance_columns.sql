-- Drop the Advance (#465, ADR-0051). Since #464 no app code reads or writes these, so a deployed
-- app never misses them. Any Uang Perjalanan amounts go with `advance_idr` — accepted; the Activity
-- Log's `advance_set` / `advance_changed` entries keep the history, and its CHECK is untouched.
-- `returned_to_treasurer_idr` and `returned_at` were never written.
ALTER TABLE "perjadin" DROP CONSTRAINT "perjadin_advance_check";--> statement-breakpoint
ALTER TABLE "perjadin" DROP CONSTRAINT "perjadin_returned_check";--> statement-breakpoint
ALTER TABLE "perjadin" DROP COLUMN "advance_idr";--> statement-breakpoint
ALTER TABLE "perjadin" DROP COLUMN "returned_to_treasurer_idr";--> statement-breakpoint
ALTER TABLE "perjadin" DROP COLUMN "returned_at";