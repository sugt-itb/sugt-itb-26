# Session Footage is stored in the company Google Drive

An offline Session now carries **Session Footage**, which the UI calls _Foto & Video_: the photos and
videos documenting it. Each file goes to the same company Google Drive that holds the receipts and
the attendance sheets ([ADR-0040](./0040-transaction-evidence-is-stored-in-the-company-google-drive.md),
[ADR-0042](./0042-perjadin-documents-are-stored-in-the-company-google-drive.md)), under a third tree,
`Foto & Video/`. Each **file** is shared "anyone with the link can view"; every folder stays private.
This **extends** both ADRs: the account, the connection, `_staging`, the upload gate, check → verify
→ commit → reconcile, the Perjadin folder's name and Periksa koneksi are theirs, reused rather than
forked. Only the transport of a large file is new (#424).

## What it is

- **One offline Session's.** Online Sessions have none. A file may be added to any Session that is
  not cancelled, delivered or not; footage of a Session cancelled later **stays**.
- **Photos:** JPEG, PNG, HEIC/HEIF or WebP, **up to 50 MB** each. **Videos:** MP4 or MOV, **up to
  1000 MB** each. The caps are domain constants beside `MAX_UPLOAD_BYTES`, in the same MiB
  arithmetic, and the database holds them too (`session_footage_byte_size_check`).
- **Any Staff member** uploads and deletes. **Anyone signed in**, a Pimpinan included, lists and
  opens it. Footage is uploaded or deleted, never edited. _Amended 2026-10-08: the trip's Group, an
  Editor or an Administrator uploads and deletes —
  [ADR-0048](./0048-a-perjadin-is-written-by-its-group.md), and the amendment at the bottom._
- **Logged.** Upload and delete each write an Activity Log entry, "Foto/Video diunggah" and
  "Foto/Video dihapus", against the Session's Perjadin. The Log's CHECK was widened for them
  (migration 0044); the `document_*` pair had been added with the rest and needed none.
- **Not a Perjadin Document.** Those are single attendance PDFs per trip; footage is many large media
  files per Session. It has its own table, `session_footage`.

## A third tree, not a folder under `Dokumen/`

```
Foto & Video/Pelaksanaan Offline/
└── {the Perjadin's folder name}/                                   private
    └── 2026-10-12 · 08.00 · SMA Pradita Dirgantara · S-3e4f5a6b/   private, one per Session
        └── 2026-10-12 · SMA Pradita Dirgantara · Foto · M-7c8d9e0f.jpg   shared, this file only
```

Footage is not attendance paperwork, and each tree can be handed over on its own — the receipts to an
auditor, the sheets to the programme, the footage to whoever reports on it — without the others
coming along. The Perjadin's folder carries the same name as its receipts and Dokumen folders and is
renamed with them. A Session's folder carries its date, its start time written `08.00` (Drive names
avoid `:`), its School and `S-` with the Session id's first 8 hex characters; a file carries the
date, the School, `Foto` or `Video`, `M-` with its own id's first 8, and the extension of the type the
server **sniffed**. When a Session's date or time changes, its folder and files are renamed right
after the change commits, best effort; Periksa koneksi re-asserts them, which also picks up a School
renamed since.

`Foto & Video/` and its `Pelaksanaan Offline/` are ensured as `Dokumen/`'s are — on connect, on
Periksa koneksi and in the reconcile — outside the readiness receipts wait on.

## Untouched, and shared file by file

Receipts are re-encoded to a JPEG before upload; footage is not. It is uploaded **as it was taken**,
with no recompression, so a photo keeps its EXIF — **its GPS position included**. That was weighed:
the photos are of minors, at named schools. It is accepted on ADR-0042's reasoning. Each file is
shared on its own, so a link opens one photo and nothing else, and no one can browse from it to the
rest; every folder stays private. Stripping metadata in the browser would mean re-encoding, which a
video cannot reasonably have on a phone, and a photo would lose the quality it was taken for.

## Resumable pieces

A receipt is one `PUT`. A 1 GB video sent as one request over a phone's connection fails often and
restarts from zero. Footage is therefore sent **in pieces of 16 MiB** (a multiple of the 256 KiB Drive
requires), straight from the browser to Drive's resumable session — the bytes never pass through Next:

- the server opens the session in `_staging` exactly as for a receipt — Staff, an offline Session not
  cancelled and on a Perjadin, the connection up, the declared type and size within the kind's cap —
  declaring `X-Upload-Content-Length` and the page's `Origin`;
- each piece is a `PUT` with `Content-Range`; Drive answers `308` while it wants more;
- after a drop, a `5xx`, a `429`, or a piece Drive would not take, the browser asks Drive what it
  holds (`Content-Range: bytes */{total}`, no body) and resumes from there, with a backoff, up to five
  times in a row; then it gives up and says so;
- a batch is sent **one file at a time**, each its own open → upload → record, so a phone never holds
  several gigabytes in flight and one failure does not sink the batch.

**What was verified, and against what (2026-10-07).** In Chromium, against a local stand-in that keeps
Drive's resumable protocol, cross-origin from the app: a 40 MiB file went in three pieces, survived a
connection dropped mid-upload, and finished. Two findings:

1. **A `308` without `Location` comes back to `fetch` as a response**, not a redirect followed or an
   error. The protocol is usable from the browser.
2. **The browser re-sends a piece on its own.** When the connection dropped after a piece arrived,
   Chromium retried the `PUT` itself (it is idempotent, and the connection was reused), so the server
   already held the bytes the uploader then sent. The uploader therefore asks what Drive holds after
   _any_ refused piece, not only after a network error.

Whether the `Range` header of a `308` is **readable from script** depends on Drive exposing it
cross-origin. Both cases work against the stand-in: with `Range` readable the status query is
authoritative; without it — learnt when a piece's own `308` carries no readable `Range`, since a
status query's `308` without one is also how Drive says it holds nothing — the uploader resumes from
the last piece it saw accepted, and takes a piece refused (`400`) at that offset as already held,
**once**: if the next piece is refused too, the guess is taken back. A wrong guess costs retries,
never a corrupt file, since Drive refuses a piece that leaves a gap; a `308` that keeps none of a
piece counts toward giving up, so no answer can make the upload loop. **Not yet verified against Google itself**, which needs the company account:
whether `www.googleapis.com/upload` exposes `Range`, and how it answers a piece it already holds. That
check is owed before the first real video, and its result belongs here. So is a run on the phones
Staff actually use — Safari on iOS and Chrome on Android — since only desktop Chromium was tried. The
stand-in was a throwaway script kept outside the repository: it answered `308` with `Range` (exposed
or not, per run) while it wanted more, `200` with an id once it had every byte, refused with `400` a
piece not starting where its held bytes ended, and dropped the connection after the second piece.

A retry of the record step after a lost answer is safe: while the file is still unsynced it reaches
the commit again, and the same Drive file answers its first row without writing anything twice.

## Verify → commit → reconcile → delete

- **Verify** in `_staging`: not trashed, this trip's `sugtPerjadinId`, and the first bytes one of the
  six types — JPEG `FF D8 FF`, PNG's signature, `RIFF….WEBP`, or ISO-BMFF `ftyp` at offset 4 with a
  HEIC/HEIF, MP4 or QuickTime `qt  ` brand — of the kind declared, within that kind's cap by Drive's
  count. A declared kind the bytes contradict is refused.
- **Commit** the row and its Log entry in one transaction, the Session locked and checked again, so
  footage never lands on a Session cancelled since the upload opened.
- **Reconcile**, idempotent, no row lock across a call to Google: the fixed folders, the Perjadin's
  and the Session's folders claimed by compare-and-set, the file moved and named, then shared, then
  `drive_synced_at`. A failure leaves the footage recorded and "belum tersinkron"; Periksa koneksi's
  sweep and a reconnect finish it.
- **Hapus** keeps ADR-0042's order: the file to the Drive trash **first** (already trashed or gone
  counts as done), **then** the row deleted and `footage_deleted` logged in one transaction. If the
  trash fails, the row stays and Hapus can be pressed again.

Offline Sessions are only ever cancelled, never deleted, and `session_footage`'s key to `session` has
no cascade: a delete that would orphan Drive files is refused rather than followed.

## Storage

The company account is a personal Gmail with about 2 TB. There is **no quota** beyond the per-file
caps: about 47 Schools × two offline Sessions × a handful of videos fits with room to spare. If that
ever changes, a per-Session cap belongs in the domain beside the per-file ones.

## Amendment (2026-10-08): the Group uploads and deletes, not every Staff member

"Any Staff member uploads and deletes" now reads: **the Session's trip's Group, an Editor or an
Administrator** uploads footage and deletes it with Hapus
([ADR-0048](./0048-a-perjadin-is-written-by-its-group.md), #439). The opener (`footageSession`) and
Hapus both check before any Drive call. Viewing stays open to everyone signed in, a Pimpinan included.
