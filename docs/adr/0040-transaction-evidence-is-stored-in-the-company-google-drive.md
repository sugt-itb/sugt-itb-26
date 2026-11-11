# Transaction evidence is stored in the company's Google Drive

Receipts move out of the private Supabase Storage `receipts` bucket and into a **Google Drive owned
by the company**: a personal `gmail.com` account with about 2 TB, **not** Google Workspace. Every
transaction gets its own Drive folder, shared **"anyone with the link can view"**, and the database
stores the Drive ids of that folder and of each file in it. The internal app **stops rendering
receipts itself**: a receipt is a link that opens Drive in a new tab.

This **supersedes the storage half of [ADR-0039](./0039-every-transaction-is-recorded-with-its-evidence.md)**
— the Supabase upload URLs, the read-back from Storage, and its argument that orphans are harmless
because the bucket is private — and the storage-layer points of
[ADR-0030](./0030-receipts-may-attach-at-transaction-entry-not-only-per-row.md). The rest of
ADR-0039 stands: one to five receipts per transaction, all or nothing, and the row lock on
"Unggah bukti". It **widens [ADR-0026](./0026-money-is-open-to-read-and-staff-only-to-write.md)**
for receipts only, as the Consequences below say.

## Why

A future **external audit** needs a spreadsheet of the Programme's transactions, each with a public
link to its receipts. An auditor holds no account in this tool and should not need one, so the
link has to open on its own. The company already keeps its evidence in Drive, and that is where an
auditor expects to find it.

**Supabase's free-tier limits are not the reason.** Storage size and egress were never the
problem, and nothing here is a cost saving.

**What stays:** Vercel hosting, Supabase as the database, Story photos in the `public-media` bucket
on Supabase, and the one-to-five receipt rule. The audit spreadsheet export is a **later** feature.
This decision only makes it possible.

## The account and the auth

- **A company-owned personal Gmail, not Workspace.** It is the account the company already has,
  with the storage it already pays for.
- **No service account.** On a personal account a service account has no storage quota of its own,
  so it cannot own the files. Shared drives and domain-wide delegation, the two usual ways around
  that, both need Workspace.
- **An OAuth refresh token with the `drive.file` scope only.** The app can see the files and folders
  it created, and nothing else in the account. `drive.file` is non-sensitive, so the consent screen
  needs no Google verification.
- **The token is stored encrypted in the database**, AES-256-GCM under the key `DRIVE_TOKEN_KEY`,
  not in an environment variable. Reconnecting writes a new row value and needs no redeploy. Losing
  the key only means connecting again; it never loses a receipt.
- **Not Better Auth account linking.** The connection belongs to the system, not to a Person. It
  must outlive whoever clicked "Hubungkan", and nobody signs in as the company account.
- **A separate "sugt Drive connector" OAuth client**, not the sign-in client. Under `drive.file`,
  access to every file the app made belongs to that **client**, so the client must never be
  replaced or deleted: a new one may not see the old files. Reconnecting through the same client
  keeps them (the spike, [#370](https://github.com/sugt-itb/sugt-itb-26/issues/370), point d).
- **The account the app may connect is pinned** by `GOOGLE_DRIVE_ACCOUNT_EMAIL`. Picking any other
  account at Google is refused. Development and Vercel previews share the dev database, so they
  connect a **separate dev Gmail**, and a test receipt never lands in the audit Drive.

## Who

Only an **Administrator** ([ADR-0028](./0028-grants-are-a-second-additive-access-axis.md)) connects,
reconnects or checks the connection, on `/pengaturan`. **Any Staff member** uploads through it, the
same Staff who may write money today. A Pimpinan writes nothing, as before.

> Amended 2026-10-08: the trip's Group, an Editor or an Administrator, not every Staff member —
> [ADR-0048](./0048-a-perjadin-is-written-by-its-group.md), and the amendment at the bottom.

## The tree

```
My Drive/
├── SUGT 2026 _staging — jangan dibagikan/          ← private, NEVER under the root; uploads land here as {uuid}.{ext}
└── SUGT 2026 Internal App Object Storage/          ← the root; may be moved by hand under a company folder
    ├── README                                       ← "Dikelola aplikasi SUGT — jangan hapus, jangan ganti nama, jangan bagikan"
    └── Bukti Transaksi/
        └── Pelaksanaan Offline/
            └── {destination} · {starts_on}/                                   ← Perjadin folder, private
                └── {spent_on} · {category} · T-{txn8}/                        ← transaction folder, shared anyone/reader
                    └── {spent_on} · {category} · T-{txn8} · {ev8}.{ext}
```

- **`_staging` is a sibling of the root, never a child.** Drive permissions are inherited. The
  company may one day move the root by hand under one of its own folders, and if that folder is
  link-shared, everything inside the root becomes link-readable with it. `_staging` holds files
  nobody has checked yet, so it sits where that move cannot reach it. The Perjadin folders are
  inside the root and would be exposed by such a move; "Periksa koneksi" checks for any `anyone`
  permission, inherited or direct, on the root and on `_staging`, and warns if it finds one.
- **The database stores Drive ids, never paths.** Links are built from ids
  (`https://drive.google.com/file/d/{id}/view`, `https://drive.google.com/drive/folders/{id}`), so a
  folder renamed or moved by hand breaks nothing.
- **Naming rules.** Dates are ISO. The separator is `·` (U+00B7 with a space each side)
  everywhere. `/` becomes `-` in the two categories that contain one (`Tiket Pesawat/Kereta PP`,
  `Transport Bandara/Stasiun`). `:` becomes ` ·` in `perjadin.destination`, so a Perjadin folder
  reads `Kelompok 18 · Samarinda, Bontang dan Balikpapan · 2026-10-12`. That "Kelompok" is the
  **Sub-Cluster's own name** (the team's _Kelompok Sekolah_), carried by the `destination` snapshot,
  not the travelling party. `txn8` and `ev8` are the first 8 hex characters of the transaction and
  evidence uuids. The extension comes from the **verified** type. Every file and folder the app makes
  carries `appProperties`: `sugtPerjadinId`, and `sugtTransactionId` once it is known.
- **Names are app-owned.** The app computes them from the database. Transaction folders and files
  are named once, as they leave `_staging`, and never renamed: a transaction cannot be edited. The
  reconcile re-asserts the Perjadin folder's name, which follows a corrected start date. The README
  asks people not to rename. _Amended by
  [ADR-0050](./0050-transactions-and-receipts-may-be-deleted-and-the-log-keeps-the-copy.md): a
  transaction still cannot be edited, but it can be deleted, and the app then trashes its folder._
- **Moving the root by hand is allowed**, and recommended over Google Picker for putting it where
  the company files things. The new parent must be **owned by the company account**: a folder owned
  by anyone else would put the evidence under an account the company does not control.

## Share last, and the `_staging` invariant

**Everything outside `_staging` has a database row.** A file only leaves `_staging` for a folder
that a committed row points at. **Only transaction folders are ever shared** (anyone, reader). The
root, `_staging` and the Perjadin folders stay private. A transaction folder is shared as the last
step, once its files are verified, named and in place.

## The two write orders

**Catat transaksi:** check → verify → build the folder in `_staging` → commit → reconcile.

1. **Check** before any Drive call: `requireStaff`, the Perjadin exists, the batch is one to five,
   and the connection is `connected`.
2. **Verify** each uploaded file: `files.get` (in `_staging`, not trashed, carrying this Perjadin's
   `sugtPerjadinId`, within the size cap) and a read of its first bytes (below).
3. **Build** the transaction folder, private, **inside `_staging`**, and rename and move the files
   into it.
4. **Commit** the transaction, its evidence rows and the folder id in one database transaction, with
   `transaction.drive_synced_at` null.
5. **Reconcile.** If the reconcile fails, the line **is still recorded**, with a "belum tersinkron"
   note, never an error.

**Unggah bukti:** check → verify → commit under the row lock → reconcile.

The database goes first here, under the parent `transaction` row's `for update` lock that ADR-0039
introduced, because the folder is usually **already public**. A file moved in before the count was
checked could become a public sixth receipt that no row records. So the count is settled and the
rows written first, and the files move afterwards.

**The reconcile** is one idempotent function per transaction, tracked by
`transaction.drive_synced_at`. It creates the Perjadin and transaction folders if missing, moves
what is still in `_staging` into place and names it, shares the transaction folder, and sets
`drive_synced_at`. It never moves anything a person has moved elsewhere, and never recreates a
trashed folder. It runs **inline** after each write, from **"Periksa koneksi"**, and **after a
reconnect**, so work recorded while the connection was down gets finished.

**The Perjadin folder is created by compare-and-set** (`update … set drive_folder_id = $1 where id =
$2 and drive_folder_id is null`); a loser trashes its own folder and uses the winner's. It is
**never** created under a row lock held across an HTTP call to Google.

## The upload transport: straight from the browser to Drive

The spike ([#370](https://github.com/sugt-itb/sugt-itb-26/issues/370)) settled it. The server opens
a Drive **resumable upload session** in `_staging`, sending the page's own `Origin` and the declared
size as `X-Upload-Content-Length`. The browser then `PUT`s the bytes **straight to the session URI**.
No receipt byte passes through Vercel, so its 4.5 MB request limit is never in play, and no chunked
route is built.

- **The `Origin` header is required.** Without it the bytes still land, but the browser cannot read
  the response and never learns the file id. Previews each have their own URL, so the `Origin` is
  taken from the request, not hard-coded to `INTERNAL_APP_URL`.
- **Drive enforces the declared size.** A body longer than declared is refused and no file is
  created. In the browser that refusal looks like a CORS error, because Drive's error response
  carries no CORS headers, so the client treats any failed `PUT` as a failed upload without relying
  on the status.
- **The server-side sequence fits a function.** Verifying, building the folder, moving, renaming and
  sharing five files took 3.7–4.2 s in the spike.

## File handling

- **Types: PDF, JPEG, PNG and WebP, verified on the server from the first bytes.** Drive inspects
  nothing, so the server reads bytes 0–15 of each file and sniffs them. The stored `content_type`
  comes from the sniff, and `byte_size` from Drive, never from the browser.
- **A 20 MB per-file cap**, a product-rule constant beside `MAX_RECEIPTS_PER_TRANSACTION`. It is
  enforced when the session is opened (as the declared size) and again on read-back.
- **Images are always re-encoded in the browser** to JPEG, long edge at most 2400 px, quality about
  0.82, orientation applied. This shrinks phone photos and **strips EXIF, GPS included**, which
  matters now that the links are public. PDFs are untouched.
- **No HEIC library.** The file input's `accept` list makes iOS transcode HEIC to JPEG on its own.
  Anything outside the four types is refused.

## A broken connection

The **first `invalid_grant`** from Google's token endpoint marks the connection `broken`, and so
does a token that will not decrypt. While Drive is not connected or broken, **Catat transaksi and
Unggah bukti are disabled with the reason**, and their server actions refuse the same states.
Administrators see a badge on the sidebar's Pengaturan item.

**No daily Cron.** A Cron would only probe the token and sweep unsynced transactions, and neither
needs a schedule. A broken token is found the first time anyone uses it, and the form keeps every
value, so nothing is lost. An unsynced transaction is already recorded, with its files safe in
private `_staging`; the next reconcile on it, the next "Periksa koneksi" or the next reconnect
finishes it. A Cron would add an unauthenticated route and a secret to guard it, to learn sooner
something nobody needs to know sooner.

## Migration

**Expand, migrate, contract, then delete the bucket.**

1. **Expand.** Evidence rows gain a nullable `drive_file_id` beside a now-nullable `storage_path`,
   with a CHECK that exactly one is set. Catat transaksi moves to Drive first, then the row's
   "Unggah bukti"; legacy rows keep rendering through their signed URLs.
2. **Migrate** the legacy receipts with a **local, resumable script**. A Vercel function would time
   out on the backlog, and the script needs the service-role key and the token key together. It
   re-encodes legacy photos the way the browser does, because they are about to become link-public.
3. **Contract.** Drop `storage_path` and the signed-URL viewer; `drive_file_id` becomes NOT NULL.
   The migration refuses to run while any row is unmigrated.
4. **Delete the `receipts` bucket**, by hand, on both projects.

There is **one storage backend at the end, never two.**

## Consequences

- **Receipts are readable by anyone holding a link.** This goes further than ADR-0026, which opened
  money to any **signed-in** Person. It is a deliberate widening, for **receipts only**, and it is
  the point of the change: the audit needs a link that opens without an account. Everything else
  about money still needs a sign-in to read and Staff to write.
- **Orphans now live in private `_staging`.** A record refused after its files landed leaves them in
  `_staging`, unreferenced by any row. That replaces ADR-0039's argument that the private bucket made
  orphans harmless: `_staging` is private and outside the root, so an orphan there is just as
  unreadable. No cleanup is built for it, as none is for the orphaned ticks of
  [ADR-0018](./0018-the-preparation-checklist-stores-ticks-and-derives-the-list.md).
- **A new external runtime dependency.** Recording a transaction now needs Google Drive to be up and
  connected, as [ADR-0033](./0033-kalender-schedule-is-a-link-shared-google-sheet.md) accepted for
  the calendar. A failure after the commit costs only the sync, never the line.
- **The account has a lifecycle** that no code covers: the Google One subscription that pays for
  the storage, Google's deletion of personal accounts inactive for two years, and the retention
  period the evidence must outlive. The
  [operations handover](https://github.com/sugt-itb/sugt-itb-26/issues/381) owns these.
- **People can touch the files in Drive.** A rename or a move is harmless, because the database
  holds ids. Trashing or deleting a receipt is not, and nothing stops it; the later audit export
  flags it. That export is out of scope here.

## Considered and rejected

- **A service account.** It has no storage quota on a personal account, so it cannot own the files.
- **Google Workspace.** It would allow a service account with a shared drive, but the company
  account is personal and moving it is not this project's decision.
- **Google Picker** for choosing where the root lives. It adds a client-side Google script and a
  developer key to do what dragging the folder in Drive already does.
- **Sharing each file rather than the folder.** One permission per transaction is fewer calls, and
  one folder link is what the audit spreadsheet wants per row.
- **Keeping two storage backends.** Supabase for old receipts and Drive for new ones would mean two
  render paths and two access models forever. The migration exists so that never happens.
- **A daily Cron**, for the reasons above.

## Amendment (2026-10-06): "SUGT ITB 2026" folder names, and one 50 MB cap

[#394](https://github.com/sugt-itb/sugt-itb-26/issues/394). Two changes, both in constants; nothing
about the decision above moves.

**The root and `_staging` are named "SUGT ITB 2026 …".** The product owner renamed both by hand in
the production Drive. The app finds them by stored id, so that connection kept working and nothing
renames them back: after a folder is created, its name is not app-owned. The constants only matter
when a connection creates its folders for the first time, which now makes these names. An existing
README is not rewritten; one is recreated, with the new text, only if it is missing. The fixed part
of the tree is now:

```
My Drive/
├── SUGT ITB 2026 _staging — jangan dibagikan/      ← private, NEVER under the root
└── SUGT ITB 2026 Internal App Object Storage/      ← the root
    ├── README                                       ← "Dikelola aplikasi SUGT ITB — jangan hapus, jangan ganti nama, jangan bagikan folder ini."
    └── Bukti Transaksi/
        └── Pelaksanaan Offline/
            └── …                                    ← as drawn above
```

**The per-file cap is 50 MB, for every upload.** `MAX_RECEIPT_BYTES` (20 MB) becomes
`MAX_UPLOAD_BYTES` in `@sugt/domain`: 50 MB, meaning 50 × 1024 × 1024 bytes, as the old 20 MB did.
It is renamed because the attendance-sheet uploads that
[#397](https://github.com/sugt-itb/sugt-itb-26/issues/397) is to add (in a forthcoming ADR-0042) will
share it. It is enforced at four points, the two named under File handling plus two the code already
had: the browser after re-encoding, the declared size when the session opens, the session's own
`X-Upload-Content-Length`, and the size Drive reports on read-back. Images are still re-encoded first, so the cap mostly matters for PDFs. The bytes still go
from the browser straight to Drive, so Vercel's request limit is not in play.

The body above keeps the `SUGT 2026 …` names, the old README text and the 20 MB cap as the
point-in-time record of what was first decided; the running tool uses the names and the cap in this
amendment.

## Amendment (2026-10-06): the Perjadin folder's name carries the trip's Schools and an id

[ADR-0044](./0044-a-perjadin-is-named-by-its-kelompok-and-dates.md),
[#406](https://github.com/sugt-itb/sugt-itb-26/issues/406). `perjadin.destination` is dropped, so the
Perjadin folder is no longer `{destination} · {starts_on}`. It is

```
{name} · {the trip's Schools} · P-{perjadin8}
Kelompok 10 · 12–13 Okt 2026 · SMAN 1 Bontang, SMAN 2 Samarinda · P-1a2b3c4d
```

where the name is `{Sub-Cluster name} · {dates}` and the trip's Schools are those with a
non-cancelled Session on it, alphabetically; with none, the Schools part is left out. `P-{perjadin8}`
is the first 8 hex characters of the Perjadin's uuid, which tells two trips of one Kelompok apart
when their names and Schools agree. The `:` → ` ·` rule goes: the name has no colon. One function,
`perjadinFolderName`, builds it for both reconciles and the date-correction rename. The transaction
folders and files below it are unchanged.

## Amendment (2026-10-06): when a Perjadin folder is renamed

[#407](https://github.com/sugt-itb/sugt-itb-26/issues/407). The Perjadin folder's name now carries
both dates and the trip's Schools (the amendment above), so it is renamed whenever **any** of them
changes, not only `starts_on` (#376):

- **Right after the write commits, best effort**, when either date is corrected, or when a Session
  write changes the trip's set of Schools: a Session added at a School not yet on the trip, one moved
  to another School, or a School's last live Session cancelled. The write reports whether the set
  changed, so a Session write that leaves it alone makes no call to Google. A failed rename never
  fails the write.
- **A Sub-Cluster rename makes no call.** The next reconcile on each of its trips re-asserts the
  name, because names are app-owned.
- **Periksa koneksi re-asserts every Perjadin folder name**: it reads each folder, renames those
  whose name is out of date, at most 25 per press and within the sweep's time budget, and reports
  how many it renamed and how many it did not reach. A folder in the Drive trash or gone is reported
  and skipped, never recreated. This is how folders made before ADR-0044 take the new name: the
  product owner presses it after deploy until none is left.

## Amendment (2026-10-07): a third tree, `Foto & Video/`

The root now holds a third tree beside `Bukti Transaksi/` and `Dokumen/`: `Foto & Video/`, with its
own `Pelaksanaan Offline/`, a folder per Perjadin named as its receipts folder is, and inside it a
folder per offline Session ([ADR-0046](./0046-session-footage-is-stored-in-the-company-google-drive.md),
#424). It reuses this ADR's account, `_staging`, upload gate and reconcile; only a large file's
transport differs, sent to the resumable session in 16 MiB pieces rather than one `PUT`. A Perjadin
folder rename now renames all three of a trip's folders together, and Periksa koneksi ensures the
third tree, sweeps its unsynced files and re-asserts its names.

## Amendment (2026-10-08): the Group uploads, not every Staff member

"Any Staff member uploads through it" now reads: **the trip's Group, an Editor or an Administrator**
uploads a receipt to a trip ([ADR-0048](./0048-a-perjadin-is-written-by-its-group.md), #439). The
check that runs before any Drive call (`staffOnTrip`) is that guard, so a Staff member off the trip is
refused with a 403 before an upload session is opened. The account, `_staging`, the upload gate and the
reconcile are unchanged.

## Amendment (2026-10-08): an `SPPD/` kind folder under `Dokumen/`

The tree gains an `SPPD/` kind folder (#441), redrawn whole in [ADR-0042's amendment](./0042-perjadin-documents-are-stored-in-the-company-google-drive.md#amendment-2026-10-08-sppd-a-fourth-kind-one-per-school-per-perjadin).
