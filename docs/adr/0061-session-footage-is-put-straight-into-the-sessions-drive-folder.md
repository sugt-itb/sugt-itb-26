# Session Footage is put straight into the Session's Drive folder

The app no longer uploads Session Footage
([#552](https://github.com/sugt-itb/sugt-itb-26/issues/552)). The **Foto & Video** button on each
offline Session, on `/pendamping` and `/sesi/[id]`, opens **that Session's own folder in the company
Google Drive** in a new tab. Staff put photos and videos there themselves, through Drive's web
interface or app. The app makes the folder, sets its sharing and opens it. It no longer uploads,
checks, lists or logs footage.

The tree is [ADR-0046](./0046-session-footage-is-stored-in-the-company-google-drive.md)'s, unchanged:

```
Foto & Video/Pelaksanaan Offline/
└── {the Perjadin's folder name}/                                  ← sharing is set here, inherited below
    └── 2026-10-12 · 08.00 · SMA Pradita Dirgantara · S-3e4f5a6b/  ← the button opens this
```

## Why

Uploading through the app was the slow, fragile part of Foto & Video: phone videos of several hundred
megabytes, sent in 16 MiB pieces from a browser tab that had to stay open, over school and hotel
connections. Drive's own app uploads in the background, resumes by itself, and is already on the
Staff's phones. The app's checks bought little against that cost: the footage is the Group's own
record of its own visit, not evidence anyone audits.

## The decision

- **The button is a link to a route** (`GET /sesi/[id]/foto-video/buka`), opened with
  `target="_blank"`. The route does the work and answers with a **303** to
  `https://drive.google.com/drive/folders/{id}`. It is a link, not `window.open` after an `await`,
  because Safari blocks a new tab opened that way.
- **Anyone signed in may click it, a Pimpinan included.** Opening the folder is reading. Making a
  missing folder on the way, and setting its sharing, is the **company account's housekeeping**, not a
  write by whoever clicked. So the reads and claims it needs (the stored credential, the token-refresh
  bookkeeping, the footage folder ids, the Perjadin's folder name) carry no Staff guard of their own any
  more. They change only ids the app owns, never a record a person entered, and the credential stays on
  the server, where only `@sugt/internal` can decrypt it. This amends
  [ADR-0040](./0040-transaction-evidence-is-stored-in-the-company-google-drive.md)'s "Who" for these
  reads alone: a Pimpinan still writes nothing a person entered. Every upload still runs its own write guard
  before it reaches them.
- **Folders are made on the first click**: the fixed `Foto & Video/Pelaksanaan Offline`, then the
  Perjadin's, then the Session's, each claimed by compare-and-set with today's names, exactly as the
  reconcile always did. Two clicks at once keep one folder; the loser trashes its own. **A trashed or
  missing folder is not remade**, the rule for every Drive folder: the tab goes back with a message that
  an Administrator must restore it from the Drive trash.
- **When Drive is not usable**, a Session that already has a folder still opens, because the link works
  without the app. One without a folder goes back with "Google Drive belum tersedia — coba lagi nanti".
- **Online Sessions have no button**, and the route answers 404 for one. **A cancelled Session** keeps
  the button on `/sesi/[id]` only if it already has a folder; the route never makes one for it.
- **Sharing is set on the Perjadin's folder**, so every Session folder inside it inherits it:
  - **anyone with the link can view**;
  - **edit access by sign-in email**, without a notification email, for exactly the people who may write
    the trip under [ADR-0048](./0048-a-perjadin-is-written-by-its-group.md): its Group's members, every
    Perjadin Editor and every Administrator, **active Persons only**.
  - **Every click re-applies the list.** Missing editors are added, and a `user`/`writer` permission
    whose email is not on the list is removed, **including an editor someone added by hand in Drive**.
    The owner, the link share and every other kind of permission are never touched.
  - An email Drive refuses, such as one that is not a Google account, is skipped and logged. It does
    not fail the click, and nor does any other sharing failure: the folder still opens.
- **The Drive scope stays `drive.file`.** It is not widened.

## What stays

- **Files already uploaded** stay in their Session folders, each with its one-file share. Nothing in
  Drive is changed or deleted.
- **The `session_footage` table, its rows and its CHECKs** stay, with no migration. Nothing writes to it
  any more. Periksa koneksi's sweep still finishes rows an upload left unsynced, and the renames still
  name the files the old upload made.
- **Renaming stays.** A Perjadin's folder follows the trip's name, and a Session's folder follows its date,
  time and School. Files Staff add themselves keep the names they gave them.
- **The Activity Log keeps its history.** Old `footage_uploaded` and `footage_deleted` entries stay
  readable on `/log`, with the Foto & Video filter. No new ones are written: the app cannot see what is
  put in a folder.

## Trade-offs

- **The folder can be browsed by anyone with its link.** ADR-0046 shared one file at a time, so a link
  opened one photo. Now a link to a Perjadin's or a Session's folder opens every photo and video in it.
  The photos are of minors, and keep their GPS data, since nothing strips it.
- **The app cannot see inside the folder.** With the `drive.file` scope it reaches only files it made
  itself. That costs the list on `/sesi/[id]`, any count of footage, type and size checks, and the Log
  entries.
- **Storage ownership.** In a normal Drive, as opposed to a Shared Drive, a file someone uploads into
  another account's folder is normally owned by the uploader and counts against the uploader's storage,
  not the company account's. The company account is a personal Gmail, so Shared Drives are not an option.
  A separate human ticket is checking this.

  **Hasil verifikasi kepemilikan: belum.** _Replace this line with the result, and its date, once
  it is in._

- **Leaving a Group takes effect late.** Editors are re-applied only when someone clicks the button on
  that trip, so a Person who has left a Group, lost a Grant or been revoked keeps edit access until the
  next click. The follow-up ticket applies the sharing the moment a Group, Grant or Person changes.

## What it supersedes and amends

- **Supersedes [ADR-0046](./0046-session-footage-is-stored-in-the-company-google-drive.md)'s upload
  path**: the resumable 16 MiB pieces; check → verify → commit → reconcile for new files; the type and
  size checks (50 MB photos, 1000 MB videos, 30 files at a time); sharing one file at a time for new
  files; Hapus; and the Log entries. Its tree, its names, the sweep and the renames stand.
- **Amends [ADR-0048](./0048-a-perjadin-is-written-by-its-group.md)** on how its write rule is enforced
  for footage. Drive's edit access now enforces it, not a guard in the app, and it is re-applied when
  someone clicks, so leaving a Group takes effect late until the follow-up lands. Who may write is
  unchanged.
- **Amends [ADR-0040](./0040-transaction-evidence-is-stored-in-the-company-google-drive.md)** as above:
  the credential read and the folder bookkeeping are open to anyone signed in, for the app's own use.
