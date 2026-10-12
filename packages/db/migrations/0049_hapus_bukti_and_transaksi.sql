-- Hapus bukti (#462) and Hapus transaksi (#463), ADR-0050: the Activity Log gains the two deletes.
-- One migration for both, so the two tickets do not each widen the CHECK. The list is
-- `ACTIVITY_LOG_ACTIONS` character for character.
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_action_check";--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_action_check" CHECK ("activity_log"."action" in ('advance_set', 'advance_changed', 'transaction_recorded', 'evidence_uploaded', 'report_filed', 'document_uploaded', 'document_deleted', 'footage_uploaded', 'footage_deleted', 'evidence_deleted', 'transaction_deleted'));
