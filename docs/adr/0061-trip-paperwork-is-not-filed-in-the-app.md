# Trip paperwork is not filed in the app

Nothing in the app uploads or deletes a Perjadin Document any more
([#559](https://github.com/sugt-itb/sugt-itb-26/issues/559)). The Dokumen dialog on the `/pendamping`
trip card is gone for everyone, an Administrator included, and Hapus goes with it. The code is deleted
rather than hidden. Git history is the way back.

## Why

A trip's paperwork, its Daftar Hadir and SPPD, no longer needs to be uploaded to the internal app. This
gives up [ADR-0042](./0042-perjadin-documents-are-stored-in-the-company-google-drive.md)'s idea that a
trip's attendance sheets and SPPDs are filed in the tool. It also amends
[ADR-0048](./0048-a-perjadin-is-written-by-its-group.md), and the passages of
[ADR-0047](./0047-planning-a-perjadin-and-online-sessions-need-the-editor-grant.md),
[ADR-0050](./0050-transactions-and-receipts-may-be-deleted-and-the-log-keeps-the-copy.md) and
[ADR-0060](./0060-trip-spending-is-recorded-outside-the-app.md) that speak of Dokumen's upload or
Hapus as live.

## The decision

- **No new document, and no deletion, from anywhere.** The record is frozen, so a write path kept only
  to maintain it is not worth keeping. Unlike the lines ADR-0060 left maintainable, a document carries
  no money, and nothing downstream needs a wrong one corrected in the app.
- **Documents already uploaded stay readable.** `/perjadin/[id]` keeps its read-only Dokumen list, each
  document with its Drive link. The section appears only on a trip with at least one document: an
  empty "Dokumen" heading would read as nothing filed, when the app has simply stopped tracking it.
- **Their Drive sync stays.** The document reconcile, Periksa koneksi's sweep and its ensuring of
  `Dokumen/Pelaksanaan Offline/`, and the renaming of a trip's Dokumen folder on a start-date
  correction all stay, so a document left unsynced before this shipped still finishes.
- **The Log keeps its history.** Past `document_uploaded` and `document_deleted` entries, their labels
  ("Dokumen diunggah", "Dokumen dihapus"), the `/log` Dokumen filter and their Drive file links stay.
  As with `report_filed` in [ADR-0055](./0055-the-perjadin-report-is-neither-filed-nor-due.md), both
  values stay in `ACTIVITY_LOG_ACTIONS` and the CHECK, and `logActivity` stops accepting them.
- **No in-app notice.** PICs are told outside the app.

## Consequences

- **No migration.** The `perjadin_document` table and its rows, `perjadin.drive_dokumen_folder_id`, the
  kind folders and the files in Drive all stay, and so do `PERJADIN_DOCUMENT_KINDS` and
  `PERJADIN_DOCUMENT_PARTICIPANT_TYPES`, which the list's labels and the schema's CHECKs still read.
- **The rules a new document was checked against are gone with the record path.** The date inside the
  trip and a School that is one of the trip's Schools were held by the application, not the database;
  the CHECKs and the one-SPPD-per-School index still hold the rows that exist.
- **Drive stays connected.** It still serves Unggah bukti, Hapus bukti and Hapus transaksi on the lines
  already recorded, and Foto & Video.
