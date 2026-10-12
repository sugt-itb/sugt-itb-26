-- Drop the Laporan's filing (#489, ADR-0055). Filing gated nothing — transactions could still be
-- added after it (ADR-0050) — so nothing replaces it, and since this change no app code reads or
-- writes the column. The Activity Log's `report_filed` entries keep the history, and its CHECK is
-- untouched.
ALTER TABLE "perjadin" DROP COLUMN "report_filed_at";
