# A Perjadin is written by its Group

A Perjadin and its offline Sessions are written only by **its Group** — the `group_member` rows, the PIC
and the Staff members — or by an **Editor** or an **Administrator**, who write every Perjadin. Everyone
signed in still reads every Perjadin, and anyone signed in may still issue its Evaluasi Perjadin link.

Settled with the product owner on 2026-10-07
([#439](https://github.com/sugt-itb/sugt-itb-26/issues/439)), as the companion to
[ADR-0047](./0047-planning-a-perjadin-and-online-sessions-need-the-editor-grant.md).

## Why

A trip's money and paperwork are its Group's responsibility. Until now any Staff member could change any
Perjadin — its dates, its Uang Perjalanan, its Group, its transactions and its files — including trips
they were never on, so a slip on the wrong card in `/perjadin` was a write to someone else's trip. A
Staff member on no trip should not be able to change it.

## The decision

One guard, `requirePerjadinWriter(caller, perjadinId)` in `packages/db/src/queries/staff-only.ts`,
beside `requireStaff` and `requireGrant`. It is three rules in this order:

1. `requireStaff` first, so a Pimpinan is still refused as `NotStaffError` — a Pimpinan writes nothing
   ([ADR-0025](./0025-pimpinan-is-a-second-signed-in-read-only-person-role.md)), and a Pimpinan recorded on a trip is not in its
   Group ([ADR-0020](./0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md)).
2. `hasGrant(caller, "Editor")` passes — an Administrator implies it.
3. Otherwise a `group_member` row for `(perjadinId, caller)` must exist, or the guard throws
   `NotOnPerjadinError` (`sugtErrorCode = "sugt/not-on-perjadin"`), which `staffSurface()` turns into a
   **403**, like its two siblings.

A Perjadin that does not exist passes, so a write on a stale id still answers its own
`no-such-perjadin` as a value: nobody is in a deleted trip's Group, and a stale screen is a state a
member can honestly reach. `requireSessionWriter` is the same guard for a write that names an offline
Session: it resolves the Session's `perjadin_id` first. An online Session has no Perjadin and is
ADR-0047's.

**Every write on a Perjadin and its offline Sessions runs it**, each keeping its existing guard:

- the dates, Uang Perjalanan, the Group and its PIC, the Pimpinan, the Narasumber
- an offline Session's add, edit, cancel, Tandai and date move, and its Session Record
- the Persiapan ticks
- Catat transaksi, Unggah bukti (and its early receipt count), Laporkan
- Dokumen and Foto & Video: the upload openers, the record, and Hapus

The guard runs on the write's own transaction where it has one, so the membership it reads is the state
the write commits against: a member who removes themselves from the Group is refused on their next write.
**The upload openers and both Hapus run it before any Drive call** — a non-member never gets an upload
URL and never trashes a file — the same check → verify → commit order as ADR-0040, ADR-0042 and ADR-0046.

The UI asks the non-throwing twin, `canWritePerjadin`, and hides every write control on `/perjadin/[id]`,
`/perjadin/[id]/laporan` and `/sesi/[id]` from whoever may not write; `/perjadin`'s directory read
returns the answer per row, so a row's Persiapan pill opens its checklist only on a trip the viewer
writes. `/pendamping` lists only trips whose Group the viewer is in, so its cards take a `canWrite`
computed from the viewer.

**Not guarded:** issuing the Evaluasi Perjadin link stays open to anyone signed in, a Pimpinan included
([ADR-0024](./0024-perjadin-evaluation-is-filed-through-an-unauthenticated-token-link.md)). So
does a Session's **Participant Feedback** QR, on an offline Session as on an online one: it is the
same kind of act — a link shown (the same one every time, since
[ADR-0049](./0049-feedback-links-never-expire-and-are-never-replaced.md)) by whoever is standing in
the room when the Session ends — and it records nothing about the trip. Reads stay open
([ADR-0026](./0026-money-is-open-to-read-and-staff-only-to-write.md)). The Drive bookkeeping that files
a recorded file into its folder, renames a trip's folders after a write, or reconciles the Drive from
Periksa koneksi stays Staff-only: it runs after a guarded write, or across every trip at once, and
changes nothing a person entered.

## Considered and rejected

- **PIC-only writes.** Rejected: the whole Group records transactions and uploads receipts, Dokumen and
  Foto & Video during the trip.
- **Restricting reads too.** Rejected: ADR-0026 keeps reading open to everyone signed in, and nothing here
  is a reason to reverse it.

## What it amends

Dated amendments point here from:

- [ADR-0026](./0026-money-is-open-to-read-and-staff-only-to-write.md): writing money is now per trip, not
  Staff-wide.
- [ADR-0040](./0040-transaction-evidence-is-stored-in-the-company-google-drive.md): "any Staff member
  uploads through it" becomes the Group, Editors and Administrators.
- [ADR-0042](./0042-perjadin-documents-are-stored-in-the-company-google-drive.md) and
  [ADR-0046](./0046-session-footage-is-stored-in-the-company-google-drive.md): "any Staff member uploads
  and deletes" becomes the Group, Editors and Administrators.

## Consequences

- **Membership is application-enforced, not a database rule** — the same reasoning as the Staff-only
  choke point: Better Auth means there is no `auth.uid()` in Postgres. `docs/data-model.md` lists it among
  the application-enforced rules.
- A Staff member with no Grant can't plan a Perjadin (ADR-0047) but runs one fully once they're in its
  Group. Adding them to a Group is how a trip gains a writer; leaving it is how one loses write access.
- An Editor or an Administrator writes a trip they are not on, from `/perjadin/[id]` or `/sesi/[id]`. It
  is not on their `/pendamping`, which lists their own trips.

## Amendment (2026-10-12): no Uang Perjalanan to write

Uang Perjalanan is no longer one of a trip's writes ([ADR-0051](./0051-the-advance-is-not-tracked.md),
#464): the Advance is not tracked, so the plan form does not ask for it and the trip page has no dialog
to correct it. "Its Uang Perjalanan" in _Why_ and in the list of guarded writes above are history. Every
other write on the list still runs `requirePerjadinWriter`.

## Amendment (2026-10-12): the Editor is now the Perjadin Editor

Writing every Perjadin, not only one's own Group's, is now the **Perjadin Editor** Grant's ([ADR-0052](./0052-editor-splits-into-perjadin-daring-and-dashboard-editor.md),
#469); "an Editor" above means a Perjadin Editor. Pengaturan Perjadin stays Administrator-only, and
the other Grants — Daring Editor, Dashboard Editor, Dashboard Viewer and Keuangan — write only a trip
whose Group the Person is in.
