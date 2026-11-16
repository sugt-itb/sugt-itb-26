# Session Footage is uploaded to a Drive folder and copied into the company archive

The app no longer uploads Session Footage
([#561](https://github.com/sugt-itb/sugt-itb-26/issues/561)). Each offline Session gets **two
folders** in the company Google Drive:

- an **upload folder** (_Folder Unggah_), where the trip's writers put photos and videos themselves,
  through Google Drive's website or app. The files stay **owned by the Staff member who uploaded
  them**, on their storage;
- an **archive folder** (_Arsip_), ADR-0046's existing Session folder. It holds **company-owned**
  files, and anyone with its link can view it.

A daily job ([#562](https://github.com/sugt-itb/sugt-itb-26/issues/562)) copies every new file from
the upload folder into the archive, as the company account. After that, a Staff member deleting their
original, or their whole Google account, loses the company nothing.

This revisits [#552](https://github.com/sugt-itb/sugt-itb-26/issues/552), which opened the archive
Session folder itself for uploads. That was reverted in
[#558](https://github.com/sugt-itb/sugt-itb-26/pull/558): files Staff put there were theirs, not the
company's, and could vanish with them.

## The two trees

```
SUGT ITB 2026 Internal App Object Storage/
├── Foto & Video/Pelaksanaan Offline/                      ← the archive (ADR-0046)
│   └── {Perjadin folder name}/                             private
│       └── 2026-10-12 · 08.00 · SMA … · S-3e4f5a6b/       anyone with the link can view  ← Lihat arsip
│           └── (footage uploaded before #561, and #562's copies)   company-owned
└── Foto & Video — Unggahan/Pelaksanaan Offline/           ← the upload tree
    └── {Perjadin folder name}/                             edit access by email for the trip's writers
        └── 2026-10-12 · 08.00 · SMA … · S-3e4f5a6b/       ← Foto & Video
            └── (Staff-owned uploads)
```

The upload tree mirrors the archive: the same fixed folders under the root, one folder per Perjadin
and per Session, **with the same names**, each id claimed by compare-and-set and stored beside the
archive's (`drive_connection.footage_upload_*`, `perjadin.drive_footage_upload_folder_id`,
`session.drive_footage_upload_folder_id`). Its folders are renamed with the archive's: after the trip's
name or the Session's date, time or School changes, and in Periksa koneksi's sweep. **Only folders are
renamed in the upload tree, never a Staff file.**

## The decision

- **Two buttons, both links to a route**, opened with `target="_blank"`. Each route does the work and
  answers with a **303** to `https://drive.google.com/drive/folders/{id}`; a link, not `window.open`
  after an `await`, because Safari blocks a tab opened that way.
  - **Foto & Video** (`GET /sesi/[id]/foto-video/unggah`) opens the upload folder. It is shown to, and
    the route admits, only the trip's writers under
    [ADR-0048](./0048-a-perjadin-is-written-by-its-group.md); anyone else gets a 404. It makes the
    archive's folders too, so the daily copy always has somewhere to copy to.
  - **Lihat arsip** (`GET /sesi/[id]/foto-video/arsip`) opens the archive folder, for anyone signed in,
    a Pimpinan included. It makes only the archive's folders.
- **Making a folder on the way is the company account's housekeeping**, not a write by whoever clicked,
  as #552 decided: the credential, token and folder-claim reads carry no Staff guard of their own
  ([ADR-0040](./0040-transaction-evidence-is-stored-in-the-company-google-drive.md)'s amendment).
- **Folders are made on the first click** and reused after; two clicks at once keep one each, the loser
  trashing its own. **A trashed or missing folder is not remade**, the rule for every Drive folder: the
  tab goes back with a message that an Administrator must restore it from the Drive trash. **When Drive
  is not usable**, an existing folder still opens and a missing one sends the tab back with "Google
  Drive belum tersedia — coba lagi nanti". **Online Sessions** have neither button, and both routes
  answer 404. **A cancelled Session** shows a button only if its folder already exists, and neither
  route makes one for it.
- **Sharing:**
  - **The upload tree** is shared on the **Perjadin upload folder**, so every Session folder inside
    inherits it: `type: user`, `role: writer`, no notification email, for exactly the trip's active
    writers — its Group's members, every Perjadin Editor and every Administrator
    (`perjadinWriterEmails`). **Every click of Foto & Video re-applies the list**: missing writers are
    added, a `user`/`writer` permission not on it is removed, the owner and anything else are left, and
    an email Drive refuses is skipped and logged. **No link share anywhere in the upload tree.**
  - **The archive**: each **Session** archive folder gets "anyone with the link can view" when it is
    made, re-asserted if missing on each click. The Perjadin archive folder and everything above it
    stay private. The per-file shares of footage uploaded before this stay as they are.
  - Periksa koneksi's warning about a link share reaching the root or `_staging` is unchanged; a link
    share on a Session archive folder, or a writer share on an upload folder, is below both and does not
    set it off.
- **Under Foto & Video, a fixed note**: "Unggah langsung di Google Drive. Berkas disalin ke arsip
  perusahaan sekali sehari; setelah itu berkas asli boleh Anda hapus."
- **The Drive scope stays `drive.file` here.** Copying Staff-owned files needs full `drive` (see the
  trade-offs); #562 widens it.

## What stays

- **The `session_footage` table, its rows and its CHECKs**, with no migration touching them. Nothing
  inserts into or deletes from it any more. Periksa koneksi's sweep still finishes rows an upload left
  unsynced, and the renames still name the files the old upload made.
- **Files already uploaded** stay in their archive Session folders, with their per-file shares.
- **The Activity Log keeps its history**: old `footage_uploaded` and `footage_deleted` entries stay
  readable on `/log`, under the Foto & Video filter. No new ones are written; the app cannot see what is
  put in a folder.

## Trade-offs

- **Ownership.** The company account is a personal Gmail, with no Workspace and so no Shared Drives. A
  file uploaded into another account's folder there is owned by, and counts against, the uploader, and
  only they can delete it. Hence two folders and a company-owned copy. Staff storage is used until they
  delete their originals; a new free Google account has 5 GB, 15 GB once its phone number is verified.
- **The loss window.** A file deleted before the next daily copy is lost. Accepted.
- **Leaving a Group takes effect late.** Edit access on the upload folder is re-applied when a writer
  clicks Foto & Video, so a Person who has left the Group, lost a Grant or been revoked keeps it until
  then. [#563](https://github.com/sugt-itb/sugt-itb-26/issues/563) applies it the moment a Group, Grant
  or Person changes.
- **Archive folders can be browsed by anyone with their link.** ADR-0046 shared one file at a time, so a
  link opened one photo; a Session archive link now opens every photo and video in it. The photos are of
  minors and keep their GPS data, since nothing strips it.
- **The scope.** Under `drive.file` the app reaches only files it made itself, so it cannot copy a Staff
  upload. Copying needs full `drive`, which amends ADR-0040's `drive.file`-only point. #562 widens it and
  records how that was verified
  ([#560](https://github.com/sugt-itb/sugt-itb-26/issues/560)).
- **Why not the alternatives:**
  - **Ownership transfer**: only the Staff member can start it, file by file.
  - **Copy, then remove the original, in one folder**: rejected; the app never touches a Staff
    member's original.
  - **A Google Form upload**: not chosen. It would be one more place for Staff to upload, beside the
    Drive app the rest of this design relies on.
  - **Keeping the in-app upload**: the slow, fragile part #552 removed — videos of several hundred
    megabytes, sent in 16 MiB pieces from a tab that had to stay open.

## What it supersedes and amends

- **Supersedes [ADR-0046](./0046-session-footage-is-stored-in-the-company-google-drive.md)'s upload
  path**: the resumable 16 MiB pieces; check → verify → commit → reconcile for new files; the type and
  size checks (50 MB photos, 1000 MB videos, 30 files at a time); one-file sharing for new files; Hapus;
  and the Log entries. Its tree, its names, the sweep and the renames stand, and the tree is now the
  archive.
- **Amends [ADR-0048](./0048-a-perjadin-is-written-by-its-group.md)** on how its write rule is enforced
  for footage: by Drive's edit access on the Perjadin upload folder, re-applied from the rule, rather
  than by a guard in the app. Who may write is unchanged.
- **Amends [ADR-0040](./0040-transaction-evidence-is-stored-in-the-company-google-drive.md)** as #552
  did: the credential read and the footage folder bookkeeping are open to anyone signed in, for the
  app's own use. A Pimpinan still writes nothing a person entered
  ([ADR-0025](./0025-pimpinan-is-a-second-signed-in-read-only-person-role.md)).
