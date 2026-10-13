-- Drop the Laporan's filing (#489, ADR-0055). Filing gated nothing — transactions could still be
-- added after it (ADR-0050) — so nothing replaces it. Apply this only once the #489 build is live:
-- the build before it still selects the column on every Laporan and trip page. The Activity Log's
-- `report_filed` entries keep the history, and its CHECK is untouched.
ALTER TABLE "perjadin" DROP COLUMN "report_filed_at";
