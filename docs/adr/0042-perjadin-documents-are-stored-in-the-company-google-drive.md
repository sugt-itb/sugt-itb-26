# Perjadin Documents are stored in the company's Google Drive

A Perjadin now carries **Perjadin Documents**, which the UI calls _Dokumen_. Each is a paper
attendance sheet, uploaded as **one PDF** to the same company Google Drive that holds the receipts
([ADR-0040](./0040-transaction-evidence-is-stored-in-the-company-google-drive.md)), under a
`Dokumen/` folder beside `Bukti Transaksi/`. Each **file** is shared "anyone with the link can view";
every folder stays private. This **extends ADR-0040**: the account, the connection, `_staging`, the
upload transport, the 50 MB cap and the reconcile are its, reused rather than forked.

## What a Perjadin Document is

> Amended 2026-10-08: a fourth kind, **SPPD**, and the "attendance" framing widened to the trip's
> paperwork — see [the amendment](#amendment-2026-10-08-sppd-a-fourth-kind-one-per-school-per-perjadin).

There are three kinds, and each is one PDF:

- **Daftar Hadir Peserta**: one School's attendance at one session, for one cohort (`Siswa` or
  `GTK-MS`). It records the session's date, its local start and end time, the School and the cohort.
- **Daftar Hadir Narasumber**: the Teaching Team's attendance for one day.
- **Daftar Hadir Pendamping**: the Group's attendance for one day.

The kind names stay Indonesian because they are the names of paperwork, the same footing as the
transaction categories. A Peserta sheet's School must be in the Perjadin's Sub-Cluster, which the
application holds, as it does for offline Sessions. Two sheets of one kind and date are allowed.

## Why

The attendance sheets are the evidence that the trip's sessions happened. They are signed on paper
during the trip and, like the Laporan, often finished after it. They belong beside the receipts, in
the Drive the company already uses for evidence, where the same external audit can reach them.

## PDF only

One PDF per document. A multi-page paper sheet is scanned to one PDF by whoever uploads it.

**Combining photos into a PDF in the browser was considered and deferred.** It would need a
page-ordering interface and would hold every page in a phone's memory at once, and neither is worth
it now. It could be added later in the browser alone, with no change to the schema, since what
arrives is still one PDF. Being PDF only also means no image is ever uploaded, so there is no photo
metadata to strip.

## The tree

> Amended 2026-10-08: an `SPPD/` kind folder; the whole tree is redrawn in
> [the amendment](#amendment-2026-10-08-sppd-a-fourth-kind-one-per-school-per-perjadin).

```
SUGT ITB 2026 Internal App Object Storage/
├── Bukti Transaksi/…                                        ← ADR-0040
└── Dokumen/
    └── Pelaksanaan Offline/
        └── {destination} · {starts_on}/                     ← the Perjadin's Dokumen folder, private
            ├── Daftar Hadir Peserta/                        ← a kind folder, private, made on first use
            │   └── {date} · {school} · {Siswa|GTK-MS} · Daftar Hadir Peserta · D-{doc8}.pdf
            ├── Daftar Hadir Pendamping/
            │   └── {date} · Daftar Hadir Pendamping · D-{doc8}.pdf
            └── Daftar Hadir Narasumber/
                └── {date} · Daftar Hadir Narasumber · D-{doc8}.pdf
```

- **`Dokumen/` and its `Pelaksanaan Offline/` are ensured wherever a document needs them:** on
  connect, by Periksa koneksi, and by the document reconcile. A missing or trashed one is made again,
  by the rule `Bukti Transaksi/` already follows. A connection made before this ADR therefore gets
  them without reconnecting. They are kept out of the fixed tree's readiness, so a receipt never
  waits on them.
- **The Perjadin's Dokumen folder** carries the same name as its receipts folder, and a start-date
  correction renames both. File names carry no `starts_on`, so nothing else moves.
- **Names follow ADR-0040's rules:** ISO dates, the `·` separator, `/` → `-` in a School's name,
  `:` → ` ·` in the destination, and `appProperties.sugtPerjadinId` on everything the app makes, plus
  `sugtDocumentId` on the file.

## The `D-{doc8}` marker

Drive allows two items with one name, and here that really happens: a sheet uploaded again, or two
Peserta sheets for one School, date and cohort. `doc8`, the first 8 hex characters of the document's
uuid, tells them apart, as `T-{txn8}` does for transactions. The uuid is generated before the insert
because the name needs it.

## Per-file sharing

**Each Dokumen file is shared anyone/reader.** This is the same deliberate widening ADR-0040 made
for receipts, for the same audit reason. The difference is the unit: a receipt's **transaction folder**
is shared, but a document is shared **file by file**. Its Perjadin and kind folders stay private,
because nothing in them is a unit an auditor asks for whole.

**Attendance sheets carry participants' names and signatures, including those of minors.** Sharing
each one by link was weighed against that and accepted. A link reaches one sheet; nobody can browse
from it to the folder or to the trip's other sheets.

## The write order

As Catat transaksi: **check → verify → commit → reconcile**.

1. **Check** before any Drive call: `requireStaff`, the Perjadin exists, the connection is
   `connected`. Anything other than one file, a declared type other than `application/pdf`, or a
   declared size above `MAX_UPLOAD_BYTES` is refused. The session opens in `_staging` as `{uuid}.pdf`.
2. **Verify** the file: in `_staging`, not trashed, carrying this Perjadin's `sugtPerjadinId`, within
   the cap, and its first bytes `%PDF-`. Then validate the fields against the trip.
3. **Commit** the `perjadin_document` row and its Activity Log entry in one database transaction,
   with `drive_synced_at` null.
4. **Reconcile**, one idempotent function per document: ensure the Dokumen folders, claim the
   Perjadin's Dokumen folder and the kind folder by compare-and-set, move and name the file, **share
   the file**, then set `drive_synced_at`. No row lock is held across a call to Google. It never
   moves what a person moved elsewhere and never recreates a trashed folder. If it fails, the
   document **is still recorded** and shows "belum tersinkron"; Periksa koneksi's sweep, and a
   reconnect, finish it.

ADR-0040's invariant holds: a file only leaves `_staging` once a committed row points at it.

## Deleting a document

A document is **uploaded or deleted, never edited**. Hapus is a later ticket, but its order is
decided here: **move the file to the Drive trash first, then delete the row.** If the trash fails,
nothing is deleted and the sheet is still listed. If the row delete fails after the trash, the sheet
is still listed and Hapus again finishes it. In neither case is a row left pointing at nothing it
says, or a shared file left that no row records.

## Who

**Any Staff member uploads and deletes**, the same Staff who record a transaction. A Pimpinan reads
only. The upload is closed, with the reason, while the connection is broken or not made, as receipts
are.

> Amended 2026-10-08: the trip's Group, an Editor or an Administrator, not every Staff member —
> [ADR-0048](./0048-a-perjadin-is-written-by-its-group.md), and the amendment at the bottom.

## Consequences

- Attendance sheets have one home, beside the receipts, and an auditor can be given one link per
  sheet.
- Every upload is in the Activity Log as `document_uploaded`, and Hapus will log `document_deleted`.
- A sheet a person shares from Drive by hand is beyond the app's control, as a receipt is.
- A trip's Dokumen and receipts folders are separate trees, so moving one by hand moves only that
  one.

## Amendment (2026-10-06): the Perjadin's Dokumen folder name

[ADR-0044](./0044-a-perjadin-is-named-by-its-kelompok-and-dates.md),
[#406](https://github.com/sugt-itb/sugt-itb-26/issues/406). The Perjadin's Dokumen folder still
carries the same name as its receipts folder, which is now
`{name} · {the trip's Schools} · P-{perjadin8}` (ADR-0040's 2026-10-06 amendment) rather than
`{destination} · {starts_on}`. The kind folders and file names below it are unchanged.

## Amendment (2026-10-06): when the Dokumen folder is renamed

[#407](https://github.com/sugt-itb/sugt-itb-26/issues/407). The Perjadin's Dokumen folder is renamed
together with its receipts folder, on the occasions ADR-0040's amendment _when a Perjadin folder is
renamed_ lists: a
change to either date or to the trip's Schools, right after the write commits and best effort; a
Sub-Cluster rename lazily, at the next reconcile; and every name re-asserted by Periksa koneksi.

## Amendment (2026-10-06): a Peserta sheet names one of the trip's Schools

[#410](https://github.com/sugt-itb/sugt-itb-26/issues/410). A Daftar Hadir Peserta's School must now
be one of **the trip's Schools** — those with a non-cancelled Session on the Perjadin
([ADR-0044](./0044-a-perjadin-is-named-by-its-kelompok-and-dates.md)) — not merely in its
Sub-Cluster. One Sub-Cluster may be covered by several trips
([ADR-0043](./0043-a-sub-cluster-may-be-covered-by-several-perjadins.md)), so the Sub-Cluster rule
offered Schools this trip never visits. The picker offers that set and the server refuses any other
School with a sentence; a sheet already recorded for a School that later left the trip stays.

## Amendment (2026-10-07): Session Footage beside the documents, not among them

Photos and videos of an offline Session are **not** Perjadin Documents and do not go under `Dokumen/`.
They have their own tree, `Foto & Video/`, and their own table
([ADR-0046](./0046-session-footage-is-stored-in-the-company-google-drive.md), #424): they are not
attendance paperwork, and each tree can be handed over on its own. They keep this ADR's per-file
sharing, every folder private, and its Hapus order — the file to the Drive trash first, then the row
and its Log entry.

## Amendment (2026-10-08): the Group uploads and deletes, not every Staff member

"Any Staff member uploads and deletes" now reads: **the trip's Group, an Editor or an Administrator**
uploads a Perjadin Document and deletes one with Hapus
([ADR-0048](./0048-a-perjadin-is-written-by-its-group.md), #439). The upload opener and Hapus both check
before any Drive call, so a Staff member off the trip never gets an upload URL and never trashes a
file. Reading the sheets stays open to everyone signed in.

## Amendment (2026-10-08): SPPD, a fourth kind, one per School per Perjadin

[#441](https://github.com/sugt-itb/sugt-itb-26/issues/441). A Perjadin Document is no longer only a
paper record of attendance: it is **the trip's paperwork**, the three attendance kinds plus
**SPPD** (Surat Perintah Perjalanan Dinas), each School's SPPD for the trip. Each is still one PDF
under the 50 MB cap, uploaded or deleted, never edited.

- **Its fields.** An SPPD records **only a School**, one of the trip's Schools (the Peserta rule of
  the #410 amendment above), and no date, time or cohort. `document_date` became nullable, and the
  two CHECKs that held the Peserta fields both ways round became **one CHECK per kind**, each that
  kind's exact shape: a Peserta sheet has a date, a School, a cohort and both times; a Narasumber or
  Pendamping sheet has a date and none of the rest; an SPPD has a School and none of the rest. Every
  row the old CHECKs allowed satisfies the new ones.
- **At most one per (Perjadin, School).** A second SPPD for a School on the same Perjadin is refused
  — "SMAN 1 Bontang sudah punya SPPD untuk Perjadin ini. Hapus dulu untuk menggantinya." — **before
  the upload session opens**, so nobody uploads a large scan only to be refused. The partial unique index
  `perjadin_document_sppd_unique` on `(perjadin_id, school_id) where kind = 'SPPD'` holds it against
  two uploads racing: the loser's record comes back as the same refusal, and its file stays unnamed
  in private `_staging`. The rule is per **Perjadin**: the same School on another trip gets its own.
  Hapus frees the School for a new SPPD; that is how one is replaced. The three attendance kinds
  keep having no duplicate rule.
- **An SPPD for a School that later leaves the trip stays**, listed and deletable, as a Peserta sheet does.
- **Its folder and name.** A fourth kind folder, `SPPD/`, made on first use and claimed by
  compare-and-set like the other three. The file is `{school} · SPPD · D-{doc8}.pdf`, with no date
  part, and `/` → `-` in the School's name. Only the file is shared, anyone with the link; every
  folder stays private. Periksa koneksi's sweep finishes an unsynced SPPD with no special case.
- **The Log** reads it as "SPPD · SMAN 1 Bontang"; no new action, since `document_uploaded` and
  `document_deleted` cover it.

**A trip-first reorganisation of the Drive was considered and rejected.** The Drive keeps one tree
per kind of thing, as [ADR-0046](./0046-session-footage-is-stored-in-the-company-google-drive.md)
decided: reversing it would undo that ADR's handover reason and move every file already in the
production Drive. The only addition is the `SPPD/` kind folder. The whole tree now reads:

```
My Drive/
├── SUGT ITB 2026 _staging — jangan dibagikan/                          private · every upload lands here first as {uuid}.{ext}; NEVER under the root
└── SUGT ITB 2026 Internal App Object Storage/                          private · the root
    ├── README
    ├── Bukti Transaksi/                                                private
    │   └── Pelaksanaan Offline/                                        private
    │       └── Kelompok 10 · 12–13 Okt 2026 · SMAN 1 Bontang, SMAN 2 Samarinda · P-1a2b3c4d/   private · the Perjadin folder
    │           └── 2026-10-12 · Konsumsi · T-9f8e7d6c/                  shared by link (whole folder)
    │               └── 2026-10-12 · Konsumsi · T-9f8e7d6c · 0a1b2c3d.jpg
    ├── Dokumen/                                                        private
    │   └── Pelaksanaan Offline/                                        private
    │       └── Kelompok 10 · 12–13 Okt 2026 · SMAN 1 Bontang, SMAN 2 Samarinda · P-1a2b3c4d/   private
    │           ├── Daftar Hadir Peserta/                               private
    │           │   └── 2026-10-12 · SMAN 1 Bontang · Siswa · Daftar Hadir Peserta · D-5c6d7e8f.pdf   shared by link (this file)
    │           ├── Daftar Hadir Narasumber/                            private
    │           │   └── 2026-10-12 · Daftar Hadir Narasumber · D-2b3c4d5e.pdf                      shared by link
    │           ├── Daftar Hadir Pendamping/                            private
    │           │   └── 2026-10-12 · Daftar Hadir Pendamping · D-3c4d5e6f.pdf                      shared by link
    │           └── SPPD/                                               NEW · private, made on first use
    │               ├── SMAN 1 Bontang · SPPD · D-1a2b3c4d.pdf                                     NEW · shared by link (this file)
    │               └── SMAN 2 Samarinda · SPPD · D-7e8f9a0b.pdf                                   NEW · shared by link
    └── Foto & Video/                                                   private
        └── Pelaksanaan Offline/                                        private
            └── Kelompok 10 · 12–13 Okt 2026 · SMAN 1 Bontang, SMAN 2 Samarinda · P-1a2b3c4d/   private
                └── 2026-10-12 · 08.00 · SMAN 1 Bontang · S-3e4f5a6b/  private · one per offline Session
                    ├── 2026-10-12 · SMAN 1 Bontang · Foto · M-7c8d9e0f.jpg                        shared by link (this file)
                    └── 2026-10-12 · SMAN 1 Bontang · Video · M-1b2c3d4e.mp4                       shared by link
```

## Amendment (2026-11-16): documents are no longer filed here

Nothing uploads or deletes a Perjadin Document any more
([ADR-0061](./0061-trip-paperwork-is-not-filed-in-the-app.md),
[#559](https://github.com/sugt-itb/sugt-itb-26/issues/559)). The write order and "Deleting a document"
above are history. The documents already uploaded stay readable on `/perjadin/[id]`, and the tree, the
per-file sharing, the reconcile and the folder rename stay, so one left unsynced still finishes.
