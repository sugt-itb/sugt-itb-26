# What we're building

Two applications for the STEM & Research Track of SUGT: a public site that shows the
Programme to the world, and an internal tool that tracks its delivery and travel
administration.

This document describes their **surfaces** — what exists on screen and how it behaves.
It assumes the vocabulary in [`CONTEXT.md`](../CONTEXT.md) and does not repeat it. Why
any given decision was made is in [`docs/adr/`](./adr); this file links out rather than
re-arguing.

Where something here is proposed but not yet ratified, it says so.

---

## The public site

`@sugt/public`. Audience: the ministry, participating Schools, and anyone who goes
looking for the Programme. It doubles as DITSAMA ITB's portfolio, which is the reason
it exists at all.

**At launch it leads with scope, not delivery.** Schools committed, Clusters, Topics,
provinces covered, who is involved. Those are true on day one and impressive from the
start. Delivery figures — Sessions delivered, Schools reached — appear as they accrue.
Conflating the two means publishing "0 of 47 Schools reached" at launch, which is worse
than publishing nothing.

**Scope figures are reference data.** Schools are fixed, and Clusters and Topics are
fixed now they are allocated. They change rarely enough to be seeded by migration rather
than edited — but the database is still their single source of truth, not a static file
in this repository. Two authored copies of the same 47 Schools drift silently, and this
is the portfolio site.

**Both scope and delivery figures come from an aggregates endpoint** served by the
internal app, so the public site launches after the internal app rather than before it —
see the amendments to
[ADR-0008](./adr/0008-public-narrative-is-authored-in-the-internal-app.md). The public
app holds no database credentials and no Supabase client of its own; it reads the
endpoint and caches. That is what makes
[ADR-0001](./adr/0001-public-site-reads-aggregates-only.md) and
[ADR-0002](./adr/0002-two-apps-in-a-pnpm-workspace.md) constraints rather than
conventions.

**Not everything on the scope band is a figure from the database.** Four stats lead the
page, and only the first is fetched: 47 Schools across 16 provinces. Two Streams, three
Classes per School and eight Sessions per School are `@sugt/domain` constants both apps
already hold. Serving those over the endpoint would put the same fixed set in two places,
which is the duplication the ADR-0008 amendment exists to remove — just pointing the
other way.

**The delivery band is absent until there is delivery to report.** It renders only once at
least one Session has been delivered, so launch day is scope → Streams → Clusters with no
gap, and the band appears by itself after the first trip. "0 Sesi terlaksana · 0 Sekolah
terjangkau" under a caption promising the figures will grow is the screen
[ADR-0001](./adr/0001-public-site-reads-aggregates-only.md) names as worse than publishing
nothing.

**A failed fetch never degrades to zeros.** At build time it fails the deploy; at runtime
the last good payload keeps being served. The internal app being down is invisible to
visitors, and a zero on the page is always a real zero. That holds until the next deploy and no
further — caches do not survive one — and it is a measured property of one caching model rather
than a setting, which is why it has an ADR of its own:
[ADR-0014](./adr/0014-the-public-site-uses-the-pre-cache-components-caching-model.md).

**There is a search page, and it queries nothing.** Schools, Clusters and Story titles are
already on the page in the payloads the site fetched; searching them is a filter in the browser.
Forty-seven Schools and four Clusters is a browsable set, and a search box that reaches the
database would be the one hole in an app that deliberately holds no credentials. Story bodies
are not searched — that would mean shipping every Story's full text to every visitor.

**Narrative is authored for publication, never harvested.** A **Story** is written
deliberately by Staff, in the internal tool. Class Records, Session Records and Perjadin
Reports never reach a public page — not filtered, not flagged, not summarised. An internal
record is only worth keeping if its author is certain it will never be public.

Content is in Indonesian. Published material may name Schools and show students and
their work; the Programme's enrolment terms cover media consent, so nothing needs
building around permissions.

---

## The internal tool

`@sugt/internal`. Two roles, and no third: **Staff** (DITSAMA employees, leadership
included) and **Teaching Team** (the professors who deliver Sessions). Sign-in is Google,
restricted to an invite list — Staff with a DITSAMA account, Teaching Team with whatever Google
account they have, and a `person` row required either way. See
[ADR-0003](./adr/0003-google-sign-in-with-an-invite-list.md).

**Nothing is approved.** There is no approver, no queue, no submitted-and-returned state on an
acquittal, and no lifecycle on a Perjadin beyond its dates. Whatever sign-off DITSAMA does happens
where it happens today; the tool records what a trip spent, with the evidence. This is said plainly because the shape is so common that its absence reads as an
omission, and because an early design drew it in full.

Access splits along one line: **delivery data is open, money is not.** Anyone signed in
can read every Session, every Class Record and Session Record, and every progress view — with
Groups assembled per
Perjadin and no standing team per Cluster, that openness _is_ the continuity mechanism.
Perjadin Reports and their financial detail are Staff-only. Writing stays with the
record's owner throughout. Publishing to the public site is Staff-only; every Group
contains a Staff member by construction, so no trip's material is unreachable.

**Popups that take data are a big fixed panel** (#417), because Staff work the tool mostly from
phones during a Perjadin. Catat transaksi, Dokumen, Catatan Sesi, Tambah/Ubah Sesi, Ubah Group,
Ubah Sesi daring and both Persiapan popups open as a panel about 900px wide and nearly the screen's
height on a laptop, and as the whole screen on a phone. It keeps that size however much is added —
twenty checklist items, five staged receipts — with the title pinned at the top, the buttons at the
bottom, and only the fields between them scrolling. Confirmations and single-value edits stay small
popups.

**On a phone, pages keep 16px side margins** (28px from 640px up) (#418), so the content gets the
width; the top bar uses the same gutter, and so does `/pendamping`, whose cards also sit 12px
inside their border on a phone (#419). Tables still scroll sideways inside their own frame.
`/log`'s filters stack below 640px, and on the Laporan each transaction's receipts wrap under
it.

**An upload to Google Drive says that it is running** (#420). Catat transaksi, a line's Unggah
bukti and Dokumen's Unggah show a spinner with "Mengunggah ke Google Drive…" — "Mengunggah 2 dari 3
berkas ke Google Drive…" when several files go at once — and "Jangan tutup halaman ini sampai
selesai." under it. Once the files are in Drive it reads "Menyimpan…" while the app records them.
There is no progress bar. In a popup it sits directly above the buttons; for Unggah bukti it sits
under the line's receipts. Until it is over, the popup cannot be closed (its close button is
disabled, and Esc and a click outside do nothing), its fields are disabled (so is Dokumen's Hapus),
and reloading or closing the tab asks first. Then everything unlocks and the usual result shows.

### Coverage view — the landing screen

Every School with its delivered count, grouped by Cluster. Answers "where are we
overall" at a glance.

**Reading it needs a grant.** The Dashboard (`/`) is the overview surface for leadership and
for the Staff who steer the Programme: a **Pimpinan** reaches it by role, and a **Staff** Person
by holding **Dashboard Viewer** or **Dashboard Editor** (an **Administrator** implies both). Any
other Staff Person — a grant-less one, or one holding only **Perjadin Editor**, **Daring Editor** or
**Keuangan** — is sent to their own landing screen, `/pendamping`, instead — the mirror
of the redirect a Pimpinan gets from `/pendamping`. See
[ADR-0037](./adr/0037-dashboard-read-is-gated-by-a-grant.md).

It shows counts, and nothing else. No health indicator, no flagging, no colour. Nothing
is ever "overdue" either — no Session ever asserted a due date — so a School behind on
pace shows a low delivered count and noticing that is a human reading the number. See
[ADR-0006](./adr/0006-sessions-are-created-when-arranged.md).

**It is a read surface and nothing else.** It used to be where both kinds of arranging
started, by selecting Schools and acting on the selection. Neither starts here now: a trip
is planned around a **Sub-Cluster** rather than a hand-assembled set of Schools, and an
online Session is arranged one School at a time. Nothing is left for a multi-selection to
mean, so there is no selection.

What that costs is the thing the old design was proudest of — planning in front of the
delivered counts rather than from memory. It is a real loss and it is accepted: the counts
decide _which Sub-Cluster is next_, and that reading now happens before you leave this
screen instead of inside the form you launched from it. Since one Sub-Cluster may need several trips
([ADR-0043](./adr/0043-a-sub-cluster-may-be-covered-by-several-perjadins.md)), the reading is per
School: _which Schools are next_, and the trip is planned around the Sub-Cluster they share.

**The Dashboard has three tabs**, left to right: **Pelaksanaan** (delivery and budget, the default),
**Persiapan Program** (the free-standing Preparation Cards, named Persiapan until #423) and
**Persiapan Luring**.

#### Persiapan Program — two orders

**Urutkan** offers two orders, each combining date and progress (#466):

- **Tanggal: Terdekat**, the default: by start date, earliest first; on one date, the least-prepared
  card first.
- **Persiapan: Terendah**: the least-prepared card first; equally prepared ones by start date.

Progress is the share of a card's items ticked, an empty checklist counting as 0%. What is still tied
keeps the order the cards were made in. The date is the start date, not counted from today, so past
cards stay where they are. Neither order touches the Peringatan block.

#### Persiapan Luring — one week's Preparation Checklists

**Persiapan Luring** follows, week by week, how far each Perjadin's Preparation Checklist has got
(#423). It is open to everyone who can read the Dashboard and is **read-only for all of them**,
Staff included: nothing on it ticks or unticks a box.

- **A week is Monday to Saturday.** It opens on the current week by today in WIB; on a Sunday, on the
  week that starts the next day. The arrows step a week back or forward, **Minggu ini** returns to
  the current week, and a date field with **Lihat** (or Enter) jumps to the week of any date picked. The week is in the URL
  (`/?minggu=2026-10-12`), so it survives a reload and switching tabs; such a link opens on this tab.
- **A Perjadin belongs to the week its start date falls in**, and one starting on a Sunday to the
  week that follows: "Kelompok 12 · 11–14 Okt 2026" starts on Sunday 11 Okt and is in the week of
  12–17 Okt.

It shows three things, all worked out afresh on every load:

1. **A summary** titled "Persiapan Luring 12–17 Okt 2026" (or "28 Sep – 3 Okt 2026", "28 Des 2026 – 2
   Jan 2027"): the share of boxes ticked over all boxes, summed across the week's Perjadins each with
   its own list, as a whole percent, with "{ticked}/{all} item · {n} Perjadin" beside it. A week with
   none reads "Tidak ada Perjadin minggu ini".
2. **Per item**: one row for every item on at least one of the week's lists, under the item's own
   wording (a Cluster's or a Perjadin's rewording is the same item), with a bar, "{x}/{y} Perjadin" (y
   being the trips it is on) and the percent. The lowest percent comes first; equal ones keep the
   checklist's order. On a phone a long label wraps above its bar.
3. **One card per Perjadin**, by start date: its name, Schools, "PIC: …" and its own percent in the
   usual tones. Opened, it lists its checklist with every box disabled.

### Pendamping — your own trips

`/pendamping` is a Staff member's own trips and nothing else. A Pimpinan is sent to the Dashboard
instead. A grant-less Staff member lands here, and so does every Staff member right after
signing in.

**An Administrator gets two tabs here, "Anda" and "Pendamping Lain"** (#440), because showing a
Staff member how to use `/pendamping` means a screenshot of _their_ page:

- **Anda** is the page described below, greeting included.
- **Pendamping Lain** has a searchable picker, "Pilih pendamping…", over every Staff Person
  but the viewer, matching name and email. Choosing one shows that Person's **Perjalanan Dinas
  Anda** and **Perjalanan Dinas Sebelumnya** exactly as they see them — the same titles,
  descriptions and empty state ("Anda belum tergabung dalam Perjalanan Dinas.") — with **no
  greeting**. An id that names no Staff Person reads "Pendamping tidak ditemukan." under the picker.
- The tab and the Person are in the URL, `/pendamping?tab=lain&pendamping=<id>`, so a refresh or a
  pasted link keeps the view.
- **Every control there works, as the Administrator**, not as the other Person: a Persiapan tick, a
  Tandai or an upload is the Administrator's, and the Log names them. Viewing writes nothing.

For anyone who is not an Administrator — any other Grant included — those URL parameters are ignored on
the server: they get their own page, with no tabs, and nothing of the other Person is loaded or sent.

It opens with one small line, **"Selamat datang kembali, {nama}"**. Below it are two sections, each listing the trips the person is in the
Group of:

- **Perjalanan Dinas Anda**: the trips not yet over (ending today or later, in WIB), soonest
  first.
- **Perjalanan Dinas Sebelumnya**: the trips that are over, the most recently ended first, with
  every action still on them. It reads "Perjalanan yang sudah selesai, yang terbaru di atas.
  Transaksi dan dokumennya masih bisa dikerjakan."

**Every collapsed card looks the same** (#419), in both sections, whether the trip is past, current
or future and whether or not the person is its PIC:

```
Kelompok 12 · 11–14 Okt 2026                                  PIC: Aziz Satrio   [Persiapan 0/14]   ⌄
SMA Pradita Dirgantara, SMA Trensains Muhammadiyah Sragen
```

- **Left:** the name, which already carries the dates, with the trip's Schools as a muted line
  beneath it.
- **Right:** "PIC: {nama}", the Persiapan pill (it opens the checklist, which can be ticked there),
  and the chevron.
- **Nothing else.** The card has no Laporan line. The Laporan is reached through **Edit**, on
  `/perjadin/[id]`.
- The two sides share a line whenever they fit, and the name never wraps to make room for the
  right side. On a phone, PIC and Persiapan wrap onto their own line under the Schools.

A card opens to show **Uang Perjalanan Terpakai** — every transaction on the trip, all categories,
the same figure as the trip's screen and its Laporan — then **Catat Transaksi**, **Dokumen**, **Evaluasi Perjadin**
and **Edit**, then the timeline of Sessions and who is on the trip. On a phone those four buttons
are a full-width two-column grid, and the money row and each Session's buttons wrap rather than
spill sideways. Each section shows three cards with **Tampilkan lebih banyak** for the rest, and is
left out when it has none. With neither, the page says "Anda belum tergabung dalam Perjalanan
Dinas."

**Who is on the trip** lists Pendamping and Pimpinan by name, as plain lists — the Pimpinan being
everyone recorded on one of the trip's Sessions that was not cancelled (#492) — and folds the
Narasumber away by School (#447) — a trip done PP over several Schools often carries a different
six or so at each, full names with titles, which listed flat crowd the card:

```
Narasumber (11)
› Tampilkan Narasumber SMAN 1 Bontang (6)
› Tampilkan Narasumber SMAN 2 Bontang (6)
  Narasumber SMAN 3 Bontang: belum ditugaskan
› Tampilkan Narasumber belum ditugaskan (1)
```

- **The heading counts the trip's Narasumber once each**, the unassigned included. A trip with none
  reads `Narasumber (0)` and nothing beneath it.
- **A Narasumber belongs to a School** when they are in the "Diajar oleh" of one of its live
  Sessions on this trip. Each School's list stands alone: someone who taught at two Schools is under
  both, and someone who taught two of one School's Sessions is there once.
- **A School with nobody in "Diajar oleh"** says "Narasumber {School}: belum ditugaskan", with
  nothing to open. Whoever is in no live Session's "Diajar oleh" — someone whose only Session was
  cancelled included — is under a last toggle, "Narasumber belum ditugaskan", shown only when there
  is someone.
- **Schools go by their earliest live Session**, then by name — the timeline's order. Names inside
  a list go A–Z, one per line.
- **Each toggle opens on its own** to "Sembunyikan Narasumber {School} (n)", and every one starts
  closed on each page load. The height animates, and snaps under reduced motion. On a phone each
  toggle is a full-width tap target, and a long School name wraps.

This is how the trip is usually staffed, shown, not a rule: nothing about entering Narasumber or
"Diajar oleh" changes, and `/perjadin/[id]` still names them per Session (see
[Perjadin](#perjadin)).

**Each Session row of the timeline has its own buttons**: **Tandai** while it is still arranged,
**Feedback**, and **Foto & Video** (#425) — in both sections, since footage is often uploaded after
the trip. A cancelled Session is not in the timeline, so it has none. There is no Foto & Video
button on the card's own row: footage belongs to a Session, not to the trip.

**Foto & Video** opens a large popup titled "Foto & Video — 12 Okt 2026 · SMA Pradita Dirgantara",
described "Upload dokumentasi kegiatan luring untuk sesi ini"
([ADR-0046](./adr/0046-session-footage-is-stored-in-the-company-google-drive.md)):

- **Pilih foto/video** takes several files at once — photos JPG, PNG, HEIC or WebP up to 50 MB,
  videos MP4 or MOV up to 1000 MB, at most 30 in one go. Each picked file is listed with its kind and
  size and a × to drop it. A file of another type, empty, or over its cap is named at once with the
  reason ("Jenis berkas tidak didukung", "Foto lebih dari 50 MB", "Video lebih dari 1000 MB") and
  left out; past 30, the rest are left out with a sentence saying so.
- **Unggah** sends them one at a time, each straight to Google Drive in pieces, under the usual
  status — "Mengunggah 2 dari 5 berkas ke Google Drive…", "Jangan tutup halaman ini sampai selesai.",
  "Menyimpan…" — with the popup locked and the browser asking before the page is left. Afterwards it
  says "{n} berkas terunggah", names each file that failed with its reason, and offers **Coba lagi**
  for just those; picking more files keeps that summary. Files whose place in Drive is not yet
  finished are counted ("{k} berkas belum tersinkron…"), as Dokumen says it. A file picked twice is
  left out the second time ("Sudah dipilih").
- **Sudah diunggah** lists the Session's files, newest first: Foto or Video, the file's own name, its
  size, who uploaded it and when, **Buka** (it opens in Drive in a new tab), "belum tersinkron" while
  it is not yet in place, and **Hapus**, which asks "Hapus berkas ini? File akan dipindahkan ke Sampah
  Google Drive." first.
- **While Drive is down** the popup still opens and lists the files; uploading and Hapus are closed,
  with the reason said as text.

**Dokumen**, beside Catat Transaksi on every card in both sections, opens **"Dokumen —
{name}"**: the trip's attendance sheets and each School's SPPD
([ADR-0042](./adr/0042-perjadin-documents-are-stored-in-the-company-google-drive.md)).

- **The list**, under four headings: Daftar Hadir Peserta, Daftar Hadir Narasumber, Daftar Hadir
  Pendamping and SPPD. A Peserta sheet reads `2026-10-14 · SMA Y · Siswa · 08.00–11.30 WITA`; the
  Narasumber and Pendamping sheets read their date; an SPPD reads its School. The SPPD heading
  carries **"SPPD: x/y sekolah"** — how many of the trip's Schools have their SPPD — so a missing
  one shows. Each has a **Buka** link that opens the PDF in Drive in a new tab, and
  "belum tersinkron" while it is not yet in place there. An empty heading says "Belum ada".
- **Unggah dokumen**: pick the **Jenis dokumen**, then its fields.
  - A Peserta sheet asks for **Tanggal Sesi**, **Waktu Mulai** and **Waktu Selesai** (with the
    School's time zone beside them once it is picked), **Sekolah** (a plain list of the trip's
    Schools — those with a Session on this trip that was not cancelled, so a School of the Kelompok
    this trip never visits is not offered; one that is refused says "Sekolah ini tidak punya Sesi di
    Perjadin ini.") and **Tipe Peserta** (`Siswa` or `GTK-MS`). A sheet already uploaded for a
    School that has since left the trip stays listed and can still be deleted.
  - A Narasumber or Pendamping sheet asks for **Tanggal Dokumen**.
  - Both dates are limited to the trip's.
  - An **SPPD** asks only for **Sekolah**: the trip's Schools, each one that already has its SPPD
    on this trip marked **"sudah ada"** and not selectable. One School has at most one SPPD per
    Perjadin; a second is refused before the upload starts with "{School} sudah punya SPPD untuk
    Perjadin ini. Hapus dulu untuk menggantinya." Hapus then a new upload replaces it. The same
    School on another Perjadin has its own.
  - **File**: one PDF, "1 file .pdf, maks. 50 MB". Anything else is refused with "Hanya file .pdf",
    and a larger file with the 50 MB message, before anything is uploaded.
- **Unggah** uploads the PDF straight to Drive and records it. Any refusal keeps every field and
  the picked file, so pressing Unggah again retries. A sheet recorded while Drive could not finish
  putting it in place says so, and Periksa koneksi finishes it.
- **Hapus** on each sheet asks first — "Hapus dokumen ini? File akan dipindahkan ke Sampah Google
  Drive." — then moves the file to the Drive trash and removes the sheet. There is no editing: a
  wrong upload is fixed by Hapus and a new upload.
- The trip's Group, a Perjadin Editor or an Administrator uploads and deletes (ADR-0048). The button, and Hapus, are disabled with the reason while
  Drive is not connected or broken, as Catat Transaksi is.

### Concerns list

A plain list of **Aspects Rated 7 or below**, across all Schools and all trips, newest first,
each linking to what it came from — and naming the Class where the Rating had one.

**Any single low Rating surfaces an Aspect — never an average.** Nothing is required, so a
Class may carry one Rating or four; and where several people did file, a lone 2 among three 9s
is the most informative number in the set, which is exactly what an average destroys.

Because the score is against an Aspect of a named Class, the list says _which cohort_ and _what
about it_ — "SMAN 8 · Student Class · Comprehension 4" is a different instruction from "SMAN 8 ·
Facilities 3". Internal entries always carry prose, because a Rating that low cannot be filed
without an explanation; Participant entries may not, since they are held to no such rule.

It draws on four sources — Class Records, Session Records, Participant Feedback and Perjadin
Evaluations — and **shows which kind each came from**. A professor scoring Delivery 3 and a
student scoring Instructor 3 are not the same claim, and a screen that flattens them invites
the wrong response. The rubrics do not collide: Comprehension only ever comes from a professor,
Instructor only from the room, Turnout only from the PIC.

This is the only place Ratings are aggregated, and the only reason they are worth collecting
at all. Deliberately a separate screen rather than a column on the coverage view: pace and
health are different questions and get different surfaces.

Seven is a wide net — roughly the bottom two-thirds of the scale — and it is a guess. It is
also what makes prose mandatory on internal records, so it costs writing as well as screen
space, and it lives in four index predicates, so moving it is a migration. Read the first month
of this list before settling it.

### Sessions

A School receives **eight**: two offline, six online. Each teaches all three of its
Classes.

**A Session has a date and a start time, and the time is the School's.** 09:00 at a School in
Papua is not 09:00 to the professor reading the screen in Bandung, so a time is only
meaningful with its zone attached and is always shown that way — "09:00 WIT". Which zone comes
from the School's Province, since no Indonesian province straddles a boundary. Screens read
from Bandung show the WIB equivalent alongside it. This holds for online Sessions too: the
stored time is the School's, so it means one thing whichever mode a Session is.

A Session comes into existence **when it is written**, never before. The full eight are not laid
out in advance with target dates, because those dates would be invented and a schedule nobody
maintains displays confident wrong information. Progress reads "3 of 8 delivered" without any
planned rows existing.

**An offline Session is arranged, then delivered or cancelled.** It is written when a Perjadin is
planned. A cancelled Session persists, flagged with a reason. It counts for nothing, but a School
that was planned for and missed looks different from one nobody has reached yet — which is the
actionable difference.

**An online Session is recorded after it happened.** A third-party LMS runs online delivery, so the
tool does not schedule one and confirm it later — it **logs a Session that already took place**,
written straight to _delivered_ (ADR-0036). The form is titled "Catat Sesi daring" and its button
reads "Tandai Terlaksana"; the date cannot be in the future.

**Recording, editing and deleting an online Session need the Daring Editor Grant** (ADR-0047, ADR-0052); an
Administrator has it implicitly. **Catat Sesi Daring** on `/sesi-daring` and the form on
`/sekolah/[slug]` are shown only to them, `/sesi-daring/baru` answers 403 to anyone else, and the edit
and delete controls on `/sesi-daring/[id]` are theirs alone. Everyone signed in still reads every
online Session.

**An offline Session's own page, `/sesi/[id]`, has a Foto & Video section** (#425), so a Pimpinan —
who has no `/pendamping` — sees its photos and videos too. Everyone signed in gets the list with
**Buka**; whoever writes the Session's trip — its Group, a Perjadin Editor or an Administrator (ADR-0048) —
also gets **Hapus** and **Unggah Foto & Video**, which opens the same popup, and the Session's own
writes (Tandai terlaksana, Batalkan Sesi, the date edit). A
cancelled Session keeps its list but offers no upload. An online Session has none.

**Only an offline Session has a PIC** — its Perjadin's. An online Session has none: a third-party
LMS runs delivery, so DITSAMA staffs no PIC and an online Session files no Session Record
(ADR-0035). It carries no Stream either (ADR-0034), and no single-cohort "Peserta" — both cohorts
are always taught.

**Online Sessions are recorded one School at a time.** Each happened at a moment of its own — its
own date, its own start and end time — so there is nothing for a batch to share. The screen stands
on its own with a **searchable School combobox** (type a name or a Kabupaten/Kota), and the same
action appears on a School's own page, which is where you already are when you are thinking about one
School. Six of every eight Sessions are online, so this is not a secondary path.

**It names two Narasumber, one per cohort.** One professor taught the Siswa cohort and one taught
GTK-MS, so the form asks for exactly those two names, both required — not a variable list (ADR-0036).
There is no separate "mark delivered" step and no who-taught prompt: the Session is recorded
delivered with its two Narasumber in one act.

**Correcting an online Session is an edit; removing one is a delete.** Its fields — School, date,
times and the two Narasumber — are editable from its detail page, and a Session recorded in error is
**hard-deleted** behind a confirm dialog rather than cancelled. (Cancellation, with a required
reason, remains for offline Sessions, and only while one is still arranged — a Session that was
delivered and then went wrong is a correction, not a cancellation.)

**The Sesi daring list is a table** ([#344](https://github.com/sugt-itb/sugt-itb-26/issues/344)),
built from the same pieces as the Perjadin list: Sekolah, Tanggal, Jam Mulai (WIB), Jam Selesai
(WIB) — "—" when none was recorded — and Status. Only Tanggal sorts, newest first; same-day Sessions
follow their start time the same way. The header stays in view, a row opens its Session, and the
search box above narrows it by School.

### Perjadin

Created inside the tool, because the Group rule is enforced at creation: **one PIC, and
at least one Teaching Team member assigned to each Stream.** Roles are exclusive, so a
valid Group is always at least three people, around four in practice. Two professors
genuinely cover all six teaching threads, because each covers their Stream across all
three Classes.

Creation is a plain validated form — pick a **Sub-Cluster**, dates and people. It is not a
planning aid: no ranking, no suggestions, no coverage data inside the form itself.

**The dates are two typed fields, Tanggal mulai and Tanggal selesai**, both required, the same day
allowed and an end before the start refused. The form asks nothing about getting there — no
Keberangkatan, no Kepulangan, no time, no transport mode — because many trips are done PP, out to a
nearby Sub-Cluster and back, sometimes daily
([ADR-0041](./adr/0041-a-perjadin-carries-no-travel-legs-and-its-dates-are-typed.md)). Each
Session's date picker is bounded by the two dates. On the trip's own screen whoever writes the trip
corrects them with **Ubah tanggal** beside the range; the edit moves no Session, and is refused whole
if a Session still to be delivered would fall outside the new range. Everyone else sees the dates
read-only.

**The form asks for no money.** The tool does not track how much Uang Perjalanan a trip received
([ADR-0051](./adr/0051-the-advance-is-not-tracked.md), #464): the figure is usually unknown unless
someone asks the trip's members. The trip's screen carries a **Pengeluaran** strip — a link to the
Laporan and one figure, **Uang Perjalanan Terpakai**: the sum of every transaction on the trip, all
categories. It shows no due date: the Laporan is neither filed nor due (ADR-0055, #489). The
Laporan, its export and the `/pendamping` card show that same number. Nothing shows an amount
received, a remainder or a progress bar.

**A trip goes to one Sub-Cluster.** A Sub-Cluster is a set of Schools near enough that any of
them can share a journey. Choosing it is what decides which Schools may appear on the trip at
all, so the form no longer asks anyone to assemble that set by hand — which was the old
design asking a planner to remember geography the tool could have held.

**One Kelompok may need several trips**
([ADR-0043](./adr/0043-a-sub-cluster-may-be-covered-by-several-perjadins.md)). Two of a Sub-Cluster's
three Schools can be visited on Monday and Tuesday and the third only the following Monday: that is
two Perjadins on one Sub-Cluster, each keeping only the Schools it visits.

**A trip is named `{Sub-Cluster} · {dates}`** — `Kelompok 10 · 12–13 Okt 2026`, or
`Kelompok 10 · 12 Okt 2026` for a one-day trip — on every screen
([ADR-0044](./adr/0044-a-perjadin-is-named-by-its-kelompok-and-dates.md)). The name is read live, so
renaming a Sub-Cluster relabels its trips, past ones included. Where trips are listed — the
Perjadin list, the `/pendamping` cards, `/log` and the Evaluasi Perjadin form — **the trip's
Schools** (those with a Session that was not cancelled, alphabetically) sit as a muted second line
under the name, because two trips of one Kelompok on the same dates share a name. The trip's own
screen is headed by the name and its tab reads `Perjadin — {name}`; the Laporan's reads
`Laporan — {name}`.

**Its Schools default to all of the Sub-Cluster's, and any of them can be dropped.** The
Sub-Cluster says which Schools are eligible; the plan says which are visited this time. A
School sitting exams that week is a School left off the trip, not a reason to abandon it.

**Each School gets its own date and its own start time**, inside the trip's range. The Group
travels once and teaches across several days, so one date for the whole Perjadin was never
the right shape. Two Schools may share a date — morning at one, afternoon at another — but
not a date _and_ a time, because the Group cannot be in two places.

**Creating a Perjadin is what brings its Sessions into existence** — one per School kept on
the trip. This form is the arranging.

**Each Session on the form carries its own "Diajar oleh" and Pimpinan** (#492): a **Pimpinan**
multi-select from the Pimpinan roster sits right after "Diajar oleh" on every Session row. There is
no trip-level Pimpinan list on the form; while the roster is empty, one line above the Schools says
to ask an Administrator to add Pimpinan on /orang.

**Each School shows what it already has on other trips**
([#409](https://github.com/sugt-itb/sugt-itb-26/issues/409)), because a Kelompok split across
several trips is otherwise planned one School at a time from memory. Under each School row of the
plan form, one muted line per offline Session it has on another Perjadin that was not cancelled —
`Sesi 1 · 12 Okt 2026, 08:00 WITA · Kelompok 10 · 12–13 Okt 2026`, the Sesi being the School's
ADR-0027 rank and the trip's name opening it in a new tab — or "Belum ada Sesi luring". On the
trip's own screen the Tambah/Ubah Sesi dialog still offers the whole Sub-Cluster, so a School can be
added to a trip later, and shows the same lines under the Sekolah picker once a School is chosen,
leaving out this trip's own Sessions, which the screen already lists ("Belum ada Sesi luring di
Perjadin lain" when there are none). **The note is read-only and never blocks**: the cap of two
offline Sessions per School is still not enforced, and a School with Sessions elsewhere can be
planned like any other — only the same School at the same date and time is refused.

**The trip's screen lists its Sessions, each with its Narasumber one per line** (#491): a row of
date, time, School and status badge — plus Ubah and Batalkan, for whoever writes the trip, while the
Session is still arranged — then that Session's "Diajar oleh" beneath it, indented, A–Z, one name to
a line, on every viewport. A Session with no Narasumber has nothing under its row.

**A Pimpinan is recorded on the Sessions they attended**, not on the trip (#492,
[ADR-0056](./adr/0056-a-pimpinan-is-recorded-per-session.md)): a Pimpinan on a trip across several
Schools and days is often at only some of them. Under each Session's Narasumber its Pimpinan follow,
one per line, as "Pimpinan: {name}". The Tambah/Ubah Sesi dialog has a **Pimpinan** multi-select
right after "Diajar oleh", offering the Pimpinan roster — with a hint naming /orang while it is
empty — and moving a Session to another School or date keeps them. A delivered Session, whose
School, date and time are settled, has **Ubah Pimpinan** on its row instead, for the same people:
who attended is often written down after the trip. A cancelled Session has neither.

**The trip's Pimpinan section is read-only**: everyone recorded on at least one of its Sessions that
was not cancelled, each followed by the Schools they were recorded at — "Prof. X — SMAN 1, SMAN 3" —
or "Tidak ada.". A Pimpinan recorded only on a Session later cancelled stays on that Session's row
but leaves this list. The Laporan's "Pimpinan yang turut serta", its CSV and the `/pendamping` card
read the same list.

Offline Sessions happen during a Perjadin. **Online Sessions have no Perjadin at all** —
which is why counting trips never tells you how much teaching has happened, and why six
of every eight Sessions are invisible to anything trip-shaped.

**A Perjadin's screen carries a Preparation Checklist** — a private, hand-ticked list of
pre-departure to-dos, shown under `Persiapan`. It is an internal-monitoring aid and nothing more:
no money, no deadline, not a record, and **nothing ever ticks a box automatically**. Whoever writes
the trip may tick any box; the boxes flip optimistically. The checklist's state also shows off the
trip's own screen, as an `x/N` pill that greys at zero, ambers part-way and greens when everything is
done: in the Persiapan column of the Perjadin list, and on the trip cards on `/pendamping`. On a trip
the viewer writes, the pill opens the checklist in a dialog, toggleable there; on any other row it is
static. The
Dashboard's [Persiapan Luring](#persiapan-luring--one-weeks-preparation-checklists) tab follows the
checklists week by week, read-only.

**Which boxes a trip has** is set by an Administrator at three levels: every Perjadin, one Cluster,
or one Perjadin ([ADR-0045](./adr/0045-the-preparation-checklist-is-stored-per-level-and-frozen-for-finished-perjadins.md)).
`N` is each trip's own. The list reads every-Perjadin items first, then the Cluster's, then the
trip's own.

- **Every trip that had not ended when the company's 14 came in has them**, in this order:
  1. Pembagian keberangkatan/Pendamping
  2. Fiksasi Dosen/Narasumber oleh PIC Dosen
  3. Pembuatan grup koordinasi keberangkatan
  4. Fiksasi itinerary oleh Ibu Direktur
  5. Komunikasi dengan pihak sekolah oleh Pak Rahmat/Fandy di antaranya terkait kesiapan sekolah,
     fasilitas, dan lainnya
  6. Menginformasikan kepada Ketua Rombongan (Dosen) oleh Pak Rahmat/Fandy
  7. Itinerary disebarkan kepada dosen kelompok melalui Grup Keberangkatan
  8. Pemesanan Hotel
  9. Pemesanan Tiket Pesawat/Kereta/Travel
  10. Barang bawaan sudah aman (RBL/Modul)
  11. Kelengkapan dokumen sudah aman (SPPD dan Daftar Hadir Peserta/Pendamping/Narasumber)
  12. Uang pegangan konsumsi sudah diterima
  13. Kirim CV Narasumber ke pihak sekolah
  14. Drive dokumentasi kegiatan dan laporan keuangan harian berupa spreadsheet/lainnya beserta
      dengan drive upload bukti pembelian
- **A trip that had already ended by then keeps the old six**, with its ticks: SK Perjalanan, "Tiket /
  transportasi PP", lodging, local transport, "confirmed with the Pendamping" and "Narasumber
  sudah lengkap".
- **A finished trip's list does not change.** Adding, removing or hiding a box for every Perjadin or
  for a Cluster reaches only the trips ending that day or later. Moving a trip's dates re-decides
  this against its new end date. A change made for one Perjadin
  always reaches it. A box's wording, once changed, shows everywhere, finished trips included.
- **"Fiksasi Dosen/Narasumber oleh PIC Dosen" unticks itself** whenever the trip's Narasumber change
  (a name added, renamed or removed), so each change has to be confirmed again by hand. It can be
  reworded but never removed or hidden.

The levels are edited on [Pengaturan Perjadin](#pengaturan-perjadin--the-preparation-checklist).

**A Perjadin's screen ends with its Dokumen**: the attendance sheets and SPPDs uploaded from the
`/pendamping` card, under the four kinds with the "SPPD: x/y sekolah" summary, each with a **Buka**
link and "belum tersinkron" while it is not yet in place in Drive. It is read-only and shown to everyone signed in, a Pimpinan included;
uploading and Hapus happen in the card's Dokumen dialog.

**The Perjadin list is a table** ([#343](https://github.com/sugt-itb/sugt-itb-26/issues/343)):
Perjadin, Sekolah (Schools with a Session that was not cancelled), Mulai, Selesai, PIC,
Persiapan and Terlaksana — delivered over not-cancelled Sessions, as an `x/N` badge in the same three
tones, `0/0` grey. It opens newest Mulai first; every column sorts, a new column descending
first — Perjadin by name, Kelompok 2 before Kelompok 10, and two trips of one Kelompok by their
dates. The header stays in view while the list scrolls, a row opens its trip, and the search box
above narrows it by the trip's Kelompok, its Schools, its PIC, its Narasumber and its Group.

**The list's header holds two buttons**: **Rencanakan Perjadin**, for a Perjadin Editor (ADR-0047, ADR-0052
— an Administrator has it implicitly), and beside it **Pengaturan Perjadin**, for an Administrator only.
Anyone else is not shown them; neither is in the sidebar. `/perjadin/baru` answers 403 to a Staff
member without the Perjadin Editor Grant, who still runs any trip they are on but cannot plan a new one.

**A trip is written by its Group** — its PIC and its Staff members — **or by a Perjadin Editor or an
Administrator** ([ADR-0048](./adr/0048-a-perjadin-is-written-by-its-group.md), #439). Everyone signed
in reads every trip. On `/perjadin/[id]`, `/perjadin/[id]/laporan` and `/sesi/[id]`, anyone else sees
everything with every write control absent — Ubah tanggal, Ubah Group, the
Narasumber edits, Tambah/Ubah/Batalkan Sesi (a Session's Pimpinan with it), Ubah Pimpinan, Tandai,
the Persiapan boxes, Catat transaksi, Unggah bukti, Foto & Video's upload and Hapus — and a forced
request answers 403.
Only **Evaluasi Perjadin**'s link stays open to everyone signed in. A Staff member added to a Group
writes that trip from then on; one who leaves it stops at once. `/pendamping` lists only a person's own
trips, so every control on its cards stays theirs.

### The acquittal — the most important screen

The PIC accounts for the whole Group. They enter each transaction on the trip together with its
evidence, and export a filled template of the acquittal paperwork. Nothing is reconciled against an
amount received, which the tool does not track (ADR-0051): the Laporan is every transaction, each with
its receipts, totalled as **Uang Perjalanan Terpakai** and split into **Total Siswa** and **Total
GTK-MS**.

**A transaction is entered with its receipts: one to five, image or PDF** (ADR-0039). The
"Catat transaksi" dialog uploads them all before it records the line. If any fails to upload,
nothing is recorded, and the form keeps what was typed and picked so the PIC can try again. More
receipts can be added later from the line's own "Unggah bukti", up to five in total. A line
entered before this rule may have none; it is marked on the screen and fixed the same way.

**Receipts open in Google Drive** (ADR-0040). The dialog, and each line's own "Unggah bukti", upload
to the company Google Drive, and the app never shows a receipt itself — every receipt, including
those recorded before the move, is a link to Drive. "Unggah bukti" adds to a
line already recorded, up to five receipts in total. A file that is not a real receipt is reported
as failed, and the rest are kept.

- Each line shows **Bukti 1…n**, links that open each receipt in Drive in a new tab.
- A line also shows **Buka folder**, a link to its own Drive folder that anyone holding it can
  view — the link the external audit will use.
- Beside each **Bukti n** sits a small **Hapus** (#462,
  [ADR-0050](./adr/0050-transactions-and-receipts-may-be-deleted-and-the-log-keeps-the-copy.md)), for
  a receipt uploaded by mistake. It asks _"Hapus bukti ini? File akan dipindahkan ke Sampah Google
  Drive."_, then moves the file to the Drive trash and takes the receipt off the line, freeing its
  slot for Unggah bukti. **A line's only receipt cannot be deleted**: its Hapus says _"Satu-satunya
  bukti tidak bisa dihapus. Unggah bukti yang benar dulu, atau hapus transaksinya."_ — so a single
  wrong receipt is replaced by uploading the right one first. Hapus is the trip writer's alone, like
  Unggah bukti, and is disabled with the reason while Drive is not connected or broken. Each one is
  a **Bukti dihapus** entry on `/log`, under the Unggah bukti filter.
- Each line carries its own **Hapus** (#463), for a line entered by mistake — against the wrong
  trip, or twice. It asks _"Hapus transaksi ini? Folder buktinya akan dipindahkan ke Sampah Google
  Drive."_, then moves the line's folder and receipts to the Drive trash and takes the line off the
  Laporan. The totals, the Siswa and GTK-MS subtotals and the export no longer count it. Any line can be deleted, with or without receipts. Like Hapus bukti, it is the trip writer's
  alone, and is disabled with the reason while Drive is not connected or broken. Each one is a
  **Transaksi dihapus** entry on `/log`, under the Catat transaksi filter; the line's earlier entries
  stay, without their Buka folder link.

What both controls take:

- JPG, PNG, WebP or PDF; anything else is refused before it uploads. An iPhone photo arrives as a
  JPG.
- At most 50 MB per file.
- Every photo is shrunk before it uploads — longest side 2400 px — which also strips its location
  and camera data, since the link is public.

**While Drive is not connected, or its connection has broken**, "Catat transaksi" and every
"Unggah bukti" are disabled, and the screen says why and that an Administrator fixes it on
Pengaturan. If Drive stops answering after a line is recorded, the line still stands; the dialog
says its receipts are not yet in place in Drive, and that is finished later.

**Each transaction carries a category**, from a closed list of eleven plus _Lainnya_ —
_Tiket Pesawat/Kereta PP_, _Uang Harian_, _Honorarium Narasumber_, _Akomodasi_,
_Transport Bandara/Stasiun_, _Transport Lokal Dalam Provinsi_, _Konsumsi_, _Modul_, _ATK_,
_Alat dan Bahan Research Project_, _Seminar kit_. They are the line items the Programme's
approved budget repeats across every travel group, so they are what DITSAMA already itemises
rather than a scheme invented here, and they are in Indonesian because that is what goes on the
paperwork. Each transaction also carries a **participant type** — _Siswa_ or _GTK-MS_ — an axis
orthogonal to the category that records which cohort the spend served, so the acquittal can split
how much of the trip's spend went to the Student cohort versus the GTK and MS cohorts (#182).

**The export is generic until the real paperwork exists.** Nobody has filed an acquittal
for this Programme yet and no prior trip's completed set is available to borrow, so the
first version exports a plain itemisation the PIC attaches rather than the real SPJ. It
**invents no fields beyond those** — no cost-centre, no account code, no payee — so it is
replaced rather than corrected when a filled example arrives. Until then a PIC still retypes the figures into
the real form, which is the one thing this screen exists to stop; see the amendment to
[ADR-0007](./adr/0007-the-tool-generates-the-acquittal.md) for why that means the bet is
not yet placed.

Transactions can be entered **as they happen or after returning** — whichever suits,
with the receipt in hand either way. Both are first-class paths. There is no offline
support; capture needs connectivity, and where it fails the PIC enters it later, losing
convenience but never data. Offline is worth adding eventually, not worth blocking on.

**The Laporan is neither filed nor due**
([ADR-0055](./adr/0055-the-perjadin-report-is-neither-filed-nor-due.md), #489). There is no
Laporkan, no "Dilaporkan" line and no deadline, on the Laporan or on the trip's screen: it is the
trip's running acquittal, the same before, during and after the trip, and the export is whatever it
holds when it is taken. Filing froze nothing and the deadline gated nothing, so both were noise —
the tool is never stricter than the process it serves. Past filings stay on `/log` as **Laporan
dikirim**, with their totals.

This screen is load-bearing in a way the others are not. Nothing structurally compels a
PIC to use this tool: the paperwork is accepted in any format. So it has to be plainly better
than a spreadsheet, a calculator and a folder of WhatsApp photos — evidence attached to
the line it belongs to, arithmetic done for you, nothing retyped to produce the document.
See [ADR-0007](./adr/0007-the-tool-generates-the-acquittal.md), including what to do if
that bet does not land.

### Session Record — the PIC's

**The PIC files one per Session**, about the visit rather than the teaching. They organised it
and taught none of it, so they are asked only what an organiser can see from the back of the
room:

| Aspect             | What a low score means                            |
| ------------------ | ------------------------------------------------- |
| **Facilities**     | The room, equipment or — online — the connection. |
| **Turnout**        | The people expected did not come.                 |
| **School support** | The School hosted badly.                          |
| **Timing**         | The day did not run to schedule.                  |
| **Coordination**   | The logistics on the day did not work.            |

Then **Problems** and **Suggestions**. No Covered field — they taught nothing.

Coordination is the PIC rating their own planning, which people do generously. It stays because
a low one is then very informative, and nobody else was in a position to judge it.

### Class Record — the Teaching Team's

**One per Class, per professor.** Both Stream professors teach all three Classes, so a Session
expects **six**: 2 × 3. Each carries seven Ratings.

| Aspect            | What a low score means                  |
| ----------------- | --------------------------------------- |
| **Comprehension** | They did not follow it.                 |
| **Participation** | They did not take part.                 |
| **Readiness**     | They arrived unprepared.                |
| **Materials**     | The material was wrong for this cohort. |
| **Delivery**      | How it was taught did not land.         |
| **Facilities**    | The room or equipment for this Class.   |
| **Timing**        | This Class's slot did not run to plan.  |

The first three are judgements only the person at the front can make — which is exactly why the
Participant form does not ask them.

Then **Covered** (what was taught), **Problems** and **Suggestions**. With no standing team per
Cluster, Suggestions _is_ the institutional memory.

**Stream is not a field.** It follows from who filed. Two Class Records on the same Class from
different professors is not duplication — STEM saying 8 and Research saying 4 about the same
cohort is the most useful thing on the screen.

**A Rating of 7 or below cannot be filed without saying what went wrong.** Prose is otherwise
optional, so a Class that went well costs seven taps.

That is twenty-one Ratings per professor per Session. It is the largest ask in the system and
it was chosen rather than stumbled into — see
[ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md), which is where to look first
if Records stop arriving.

### Who still owes what

**Nothing is required and nothing is blocked.** No deadlines, no gating. What the tool does is
name who has not filed, so they can be chased in the group chat.

For a Session that is a simple subtraction: `session_teacher` names the two professors, the
three Class kinds are a constant, so six Class Records are expected and whatever is missing is
listed with the name of whoever owes it. The PIC's Session Record is one more row on the same
list.

**Participants cannot be listed.** Nobody knows who was in the room, so "4 of ? responded" is a
count with no denominator — which is precisely the half-figure
[ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md) warns reads as a system of
record and is not one. Their form is chased in the room, not by the tool.

### Participant feedback

Separate from every internal record, deliberately and permanently — see
[ADR-0012](./adr/0012-participants-write-through-a-short-lived-session-token.md).

At the end of a Session a link or QR code is shown. **It never expires and is never replaced**
([ADR-0049](./adr/0049-feedback-links-never-expire-and-are-never-replaced.md)): staff print the QR
the day before and shorten the link, so "Tampilkan QR" shows the Session's one link to whoever
presses it — a colleague, another device, after a reload — and makes one only the first time.
There is no "Terbitkan QR baru". A cancelled Session offers no QR, and its link opens on "Tautan
sudah tidak berlaku", as an unknown link does. Anyone taught there
can open it without signing in — almost always on a phone, so the form is laid out for ~360px —
say which Class they sat in, type their name, then answer, in this order (#446):

| Label on the form                                                                  | Description under it                                | Input                                     |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------- |
| **Pengalaman hands-on RBL** — Siswa only                                           | Apakah modul RBL yang dibuat mudah dilakukan?       | Rating 1–10, required + optional Komentar |
| **Materi**                                                                         | Apakah materi yang diberikan mudah dipahami?        | Rating 1–10, required + optional Komentar |
| **Narasumber**                                                                     | Apakah narasumber menyampaikan materi dengan jelas? | Rating 1–10, required + optional Komentar |
| **Relevansi**                                                                      | Apakah materi yang diberikan relevan?               | Rating 1–10, required + optional Komentar |
| **Melalui kegiatan kelas ini apakah meningkatkan atau menambah pengetahuan Anda?** | —                                                   | Free text, optional                       |
| **Saran dan masukan untuk kegiatan kelas**                                         | —                                                   | Free text, optional                       |

- **Hands-on RBL** (Research-Based Learning) appears, first, once the Participant picks **Siswa**,
  and disappears for GTK and MS. Rating it and then switching to GTK or MS drops that Rating and
  its Komentar; nothing about it is sent. Before a Class is picked the form shows the three every
  Class is asked.
- It is a full Aspect: a Rating of 7 or below puts it on the concerns list like the others.
- The two written questions are **not Aspects**: no Rating, never counted, never averaged, never
  on the concerns list.
- The descriptions are on the form only. Everywhere else the Aspects keep their short names —
  Hands-on RBL, Materi, Narasumber, Relevansi.
- The instruction above the first Aspect says which end of the scale is good: _"Skala 1–10: 1 =
  paling rendah, 10 = paling tinggi."_ (#480). A Participant may otherwise read 1 as "best". The
  Perjadin Evaluation form and the Session Record dialog carry the same sentence in their own
  instruction. It is said once, not as captions at the two ends of every control: those repeat on
  every row and are cramped on a phone.

**On `/feedback`'s Peserta tab**, Hands-on RBL has its own average card and its own filter beside
Narasumber, Materi and Relevansi. Its average is over the rows that have one — GTK, MS and Siswa
rows filed before it existed never count as 0 — and reads "—" while none do; a Siswa card filed
before it reads "—" for it too, and a GTK or MS card has no such line. A row's average is the mean
of the Ratings it has. Each card shows the two written answers under **"Peningkatan
pengetahuan"** and **"Saran dan masukan"**, clamped like the comments ("selengkapnya" /
"sembunyikan"); an empty one shows no heading.

**The Peserta tab narrows by School, then by Session, and by Tipe Peserta** (#466, #487):

- **Sekolah** is a searchable picker, "Semua Sekolah" until one is chosen. It lists only the Schools
  with at least one response, by name, so a pick never reads empty.
- **Sesi** is disabled until a School is picked, then reads "Semua Sesi". It lists that School's
  Sessions with responses, offline and online, by date, each as
  `Sesi 1 · Luring · 12 Okt 2026 · 09.00 WITA`. The number is the Session's Sesi
  ([ADR-0027](./adr/0027-a-sessions-sesi-is-its-per-school-date-rank.md)), the number the Dashboard
  matrix and the planning note give it. An online Session's time is in WIB. Picking another School resets it to "Semua Sesi".
- **Tipe Peserta** reads "Semua Tipe Peserta", then **Siswa** or **GTK-MS**: Siswa keeps the
  Student Class's responses, GTK-MS the GTK and MS Classes' together — the same split as the Daftar
  Hadir Peserta sheets and `/keuangan`. A Participant still picks GTK, MS or Siswa on the form.
  Picking a School leaves it as it is.
- **Each response card carries the same line**, linking to the Session.
- All three AND with each other and with the score filters, each change goes back to the first
  page, and sorting and "Tampilkan lebih banyak" work as before.
- **The four averages follow the School, Session and Tipe Peserta, never the score filters**, and
  their titles say what they cover: `Nilai rata-rata · Narasumber · SMAN 1 Bontang`, or
  `… · SMAN 1 Bontang · Sesi 1 Luring · GTK-MS`. With none picked they are programme-wide. Under
  GTK-MS the Hands-on RBL card reads "—", since only Siswa are asked it.
- The choice lives in the browser, not the URL, like the other filters; switching tabs resets it.

**Nothing asks them to rate themselves.** Comprehension, Participation and Readiness sit on the
Class Record precisely because they are judgements about the room, and a room grading its own
readiness is not evidence. Materials and Instructor overlap with the Class Record on purpose —
that overlap is what lets the professor's view be set against the room's on the same cohort.

No elaboration rule applies. A Participant owes nothing and is not signed in; refusing their 3
because they did not justify it would simply lose the 3.

It is **indicative, not a census**. Nothing stops one person submitting twice or the link being
forwarded, and the names are self-reported. Anything stricter needs an attendee list, which
ADR-0009 decided against building.

Internal records are written frankly because only colleagues read them. That is why these never
share a table, a screen or a query.

### Perjadin evaluation

How the trip went, as against how the teaching went. **Only the Group that travelled can file
one**, and each of them files at most one.

It is filed through the trip's link (`/ep/{token}`), shared from **Evaluasi Perjadin** as a QR or a
copyable URL. Like the Participant Feedback link it **never expires and is never replaced**
([ADR-0049](./adr/0049-feedback-links-never-expire-and-are-never-replaced.md)): "Tampilkan QR" shows
the trip's one link, and there is no "Terbitkan tautan baru".

Four Aspects, same 1–10 scale, same rule that 7 or below needs an explanation:
**Lodging**, **Transport**, **Meals** and **Punctuality**. Transport is the ground transport
generally rather than the shuttle specifically; Punctuality is whether the schedule held.
They are separate because they fail independently — a good car an hour late is a different
complaint from a bad car that was prompt, and one is the vendor's fault while the other is
the plan's.

A fifth, last on the form, once the filer picks Peran **Narasumber** or **Pimpinan**: **Pendamping
Support**, asked as _"Pendamping membantu selama keberjalanan kegiatan."_ with a Rating and an
optional Komentar like the others, and required (#481). A **Pendamping** is not shown it — they would
be Rating themselves — and switching Peran to Pendamping clears a Rating and Komentar already given,
as _Tidak menginap_ clears lodging. Nothing shows it before a Peran is picked. Its short name
elsewhere is **Bantuan Pendamping**
([ADR-0054](./adr/0054-pendamping-support-is-rated-only-by-narasumber-and-pimpinan.md)).

Each Aspect reads top to bottom, at every width, as the Participant Feedback form's questions do
(#486): the question, then its 1–10 selector on a row of its own and as wide as it, then its
**Komentar (opsional)**. Lodging's _Tidak menginap (perjalanan pulang-hari)_ box sits between its
selector and its Komentar. At 360px the selector's cells shrink to fit, and nothing scrolls
sideways.

Then **Problems** and **Suggestions**. There is no Covered field; nothing was taught on a
journey.

**It is not Staff-only.** A Perjadin Evaluation carries no money, so it follows the
open-delivery rule rather than the Perjadin Report's — anyone signed in can read one. Worth
saying plainly because it hangs off a Perjadin, and Teaching Team members are the ones who
slept in the hotel.

Which means **the Perjadin screens have a money-free variant**, and Teaching Team see it: the
same trip, its dates, its Group, its Schools, with the transactions and the Report
absent rather than disabled. They need it to find the trip they are filing about, and a greyed
box saying they may not look is worse than no box.

**Lodging is the one Aspect a Group may leave blank**, because not every Perjadin involves a
night away — a School close enough for a day trip has no hotel to rate, and asking for a Rating
anyway would produce an invented one.

**On `/feedback`'s Perjadin tab, the list narrows by trip and by Peran pengisi** (#466):

- **Perjadin** is a searchable picker, "Semua Perjadin" until one is chosen. It lists only the trips
  with at least one evaluation, earliest first, by name (`Kelompok 10 · 12–13 Okt 2026`) with the
  trip's Schools beneath. Typing a School's or a Kelompok's name finds the trip.
- **Peran pengisi** is Semua Peran, Narasumber, Pendamping or Pimpinan: the role the filer declared.
- There is no School filter; the Perjadin picker finds a trip by its Schools.
- As on the Peserta tab, both AND with the score filters, and the five averages follow them — never
  the score filters — with titles naming the trip and the Peran.

**Bantuan Pendamping has its own average card and its own filter** on the Perjadin tab (#482), after
Ketepatan Waktu. As with Hands-on RBL on the Peserta tab, its average is over the rows that have
one. A Pendamping's evaluation and one filed before the Aspect existed never count as 0, and the
card reads "—" while none in scope does, so with Peran pengisi on Pendamping it always reads "—".
Such a row is in neither arm of its filter, and its card has no Bantuan Pendamping line, as a day
trip's has no Penginapan line. A row's average is the mean of the Ratings it has: three, four or
five.

The form deliberately matches the Session Record's shape. Two evaluation forms that behaved
differently would be two things to learn.

**Each `/feedback` tab has an Ekspor CSV button** (#490), above its list, for anyone who can read
the page. It downloads that tab's own file:

- **Every row the tab's choices match**, across all pages, not just those loaded: the scope (Sekolah,
  Sesi and Tipe Peserta; Perjadin and Peran pengisi) and every score filter. Rows come **in the
  tab's current sort**, lowest average first by default, so the file reads as the screen does —
  unlike `/keuangan`, which always exports oldest first.
- **Peserta:** Tanggal (the day it was filed), Sekolah, Sesi (the card's line), Tipe Peserta (GTK, MS
  or Siswa), Nama, then Materi, Narasumber, Relevansi and Hands-on RBL each with its Komentar, the two
  written answers, and Rata-rata. **Perjadin:** Tanggal, Perjadin (its name), Peran, Nama, then
  Penginapan, Transportasi, Konsumsi, Ketepatan Waktu and Bantuan Pendamping each with its Komentar,
  and Rata-rata.
- **A Rating that was not given is an empty cell, never 0**; Rata-rata is the row's average over the
  Ratings present, to one decimal, as on its card. The file is written as `/keuangan`'s is — a BOM,
  every field quoted — so comments with commas, quotes or line breaks open intact in Excel.
- Named `feedback-peserta-<filter>-<today>.csv` or `feedback-perjadin-<filter>-<today>.csv`: what the
  scope covers, then `tersaring` when a score filter is on, or `semua` with neither.
- The screen keeps its choices in the browser, so the button's link carries them as query
  parameters; a bad or missing one falls back to the default.

### Publishing

Staff write **Stories** here — prose and photographs about **exactly one School** — and the
public app fetches the published ones through the same mechanism as
the figures. Staff-only, per
[ADR-0004](./adr/0004-delivery-data-is-open-internally-money-is-not.md); every Group
contains a Staff member by construction, so no trip's material is unreachable.

**No longer deferred.** The authoring UI was left out of the first release partly because
the public site shipped alone, and it no longer does. That deferral was re-examined rather
than inherited and dropped: the alternative is launch narrative committed to the repo and
then migrated into rows once the UI lands, so the material the portfolio leads with gets
written twice and is meanwhile the one thing on the site a Staff member cannot change.
**Nothing narrative is hand-seeded, at any point** — the same rule scope figures already
follow. See the second amendment to
[ADR-0008](./adr/0008-public-narrative-is-authored-in-the-internal-app.md).

The public site therefore launches with real Stories in the database, which makes the
launch gate Better Auth, the invite list, the `public-media` bucket, the publishing tables
and this editor — not the aggregates endpoint alone.

**A Story is about exactly one School**, carries a cover photograph and any number of
others, and may name a Stream. Its Cluster is the School's and is never chosen separately.
It is never about a Perjadin; public narrative and the trip that carries the money stay
apart.

**A Story is either field narrative or a Final Project piece**, and that is the only thing that
differs between them — same editor, same photographs, same rule that neither is derived from an
internal record. The distinction exists because the public site gives Final Projects their own
section rather than a filter on the stories feed. It is also how a Final Project reaches the
public at all: [ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md) still refuses to
track them, and a curated piece about one is not tracking.

**Prose is written in a visual editor and stored as Markdown.** Staff are describing a school
visit, not learning syntax. What the editor can produce and what the public site will render are
one list rather than two — see
[ADR-0015](./adr/0015-story-bodies-are-markdown-and-the-editor-schema-is-the-allowlist.md), which
is where that constraint is argued, because the failure it prevents is silent.

**A formatting toolbar sits above the body.** A writer who does not know `##` can still make a
subheading, and a link — which had no keyboard shortcut and no input rule — becomes reachable at
all. Seven controls: the paragraph or heading level (Judul 1 is left off, because the Story's title
is the page's one H1), bold, italic, a bullet and a numbered list, a quote, and a link. Each button
lights up to show what the caret already carries. The bar is bound to the same one list the editor
and the public renderer share, so it can never offer a format the body is not allowed to hold.

**A Story is a draft until it is published, and comes down immediately when withdrawn.**
Publishing or unpublishing tells the public site to refresh rather than waiting for its next
scheduled one — the site otherwise serves its last good copy indefinitely, which is right for
a figure and wrong for a photograph someone has asked to have removed.

### Sub-Clusters — which Schools can share a journey

Staff group a Cluster's Schools into **Sub-Clusters**: sets close enough that any of them can share
a trip. A trip goes to one Sub-Cluster, and one Sub-Cluster may be covered by one trip or by several
([ADR-0043](./adr/0043-a-sub-cluster-may-be-covered-by-several-perjadins.md)). This is what offline
planning is built on, so it is the one piece of reference data the
tool lets anyone edit — create a Sub-Cluster, rename one, move Schools between them.

**Every School is in exactly one, always.** There is no unassigned state to represent, because
an unassigned School would be a School no trip could be planned for and nothing on any screen
would say so. The initial grouping is seeded for that reason; the screen is for correcting it.

**It exists because the grouping is a guess until somebody has made the journey.** Clusters and
Topics were allocated to DITSAMA and the tool only reflects them. Nobody allocated the
Sub-Clusters — they are DITSAMA's own reading of roads, flights and distances, and the first
Perjadin is what teaches you two Schools are not as close as the map suggested. Behind a deploy,
that lesson does not get recorded. See
[ADR-0016](./adr/0016-sub-clusters-are-editable-because-nobody-allocated-them.md).

Two things the screen refuses, both saying why rather than failing quietly:

- **Deleting a Sub-Cluster that still holds Schools.** Empty it first — there is nowhere for
  the Schools to go.
- **Moving a School that a planned trip is still going to visit**, naming the Perjadins in the
  way — each by its name, `Kelompok 10 · 12–13 Okt 2026` — so somebody can re-plan or cancel them. Only trips that have not happened block a move:
  Sessions already delivered record where the Programme went, and a grouping that could not be
  corrected after the first trip would be a grouping nobody could fix.

### People — the invite list

An Administrator adds and revokes People here (#470). This is the invite list from
[ADR-0003](./adr/0003-google-sign-in-with-an-invite-list.md): a `person` row **is** an
invitation, and nobody whose email has no row can sign in at all.

**Only an Administrator sees Orang** (#488), in the sidebar and at `/orang`, to read as well as to
write. Anyone else, Pimpinan included, gets the 403, as on Log and Pengaturan. Nothing else links
here: each Session's Pimpinan picker, on the Perjadin form and the trip's Session dialog, reads its
own list, so whoever plans or runs a Perjadin still picks from it. Schools, Clusters and Topics
have no admin screen because they are fixed reference data — People are not, so they do. The header
says only an Administrator reads the roster, adds people and deactivates them.

- **Tambah orang** and each row's **Nonaktifkan**: anyone but an Administrator calling either write
  gets a 403, and nothing is written.
- **An Administrator cannot Nonaktifkan themselves**: their own row has no button, and the write
  refuses it. Deactivating another Administrator is allowed.
- **Akses** is a column of Grants. Each active Staff row has a searchable multi-select of the six
  Grants, held ones as chips; adding or removing a chip assigns or revokes at once. Each option carries a line saying what it gates — Administrator "semua akses", Keuangan
  "tabel dan ekspor semua transaksi", Perjadin Editor "merencanakan dan menulis setiap Perjadin", Daring Editor "Sesi
  daring dan Pretest", Dashboard Editor "termasuk Dashboard Viewer", Dashboard Viewer "membaca
  Dashboard". Only Grants actually held are chips: choosing Dashboard Editor shows Dashboard Editor
  alone. A Pimpinan or deactivated row shows "—".
- **An Administrator cannot revoke their own Administrator Grant**: that chip is locked on their
  row, and the write refuses it. With the rule above, no Administrator can remove their own
  access.

**A Person's role cannot be changed once they have been used.** The database refuses it,
and correcting a wrong one means revoking that Person and adding a new one, which keeps
every historical reference truthful. The screen says so rather than offering an edit that
will be rejected.

**Revoking is one write.** `active = false` is the whole of it. The invite list on its own
gates _signup_ — it stops an email that has never signed in from creating an account — and
somebody who has already signed in holds a session it cannot see, so `active` is read on every
request as well. A revoked Person is refused the next thing they do, mid-session, and there is
no second switch to throw. Nothing here can half-succeed, so the screen never has to show a
revocation that partly landed.

The founding Staff rows are seeded, because nothing else can be: without a Person, nobody
can sign in to reach this screen. See
[ADR-0013](./adr/0013-people-are-added-in-the-tool-and-their-role-is-write-once.md).

### Pengaturan — the company Google Drive

**Only an Administrator sees Pengaturan**, in the sidebar and at `/pengaturan`. Anyone else,
Pimpinan included, gets the 403. It holds one card for now: the company Google Drive that
transaction evidence is moving to
([ADR-0040](./adr/0040-transaction-evidence-is-stored-in-the-company-google-drive.md)).

The card is in one of four states:

- **Belum terhubung** — a short explanation and **Hubungkan Google Drive**.
- **Terhubung** — the account, a link that opens the root folder in Drive, who connected it and
  when, when it was last used, and **Hubungkan ulang**.
- **Terputus sejak {tanggal}** — Google stopped accepting the stored token. Receipts cannot be
  uploaded until an Administrator presses **Hubungkan ulang**.
- **Folder bermasalah** — the token works, but the main folder or `_staging` is in the Drive trash
  or gone, or Drive failed while the folders were being set up. It says which, and offers
  **Hubungkan ulang**.

**Connecting** goes to Google's consent screen for the company account and back. If the wrong
account was picked, the Drive permission was unticked, or Google sent no long-lived token, the card
says so in its own words and stores nothing. A first connect creates the app's folders in the
company Drive: the main folder, **SUGT ITB 2026 Internal App Object Storage**, and beside it, never
inside it, **SUGT ITB 2026 \_staging — jangan dibagikan**. A reconnect reuses them. The app knows
them by id, not by name, so renaming either by hand in Drive breaks nothing and is never undone. If
it finds the main folder or `_staging` in the Drive trash or gone, the card shows Folder bermasalah;
it does not recreate them. There is no disconnect button. A successful reconnect also finishes what
was recorded while the connection was down, as Periksa koneksi does below.

**Periksa koneksi**, on the Terhubung card, checks the connection and reports each step:

- whether Google still accepts the token — if not, the card turns to Terputus;
- whether the main folder, `_staging`, Bukti Transaksi and Pelaksanaan Offline are still there, in
  the Drive trash, or gone;
- whether a "anyone with the link" share reaches the main folder or `_staging`. That happens when
  someone moves the main folder into a shared company folder. It is warned about prominently: "Folder
  utama dapat dibuka siapa saja yang punya link — pindahkan keluar dari folder yang dibagikan."
- whether `Dokumen/` and its `Pelaksanaan Offline/` are there, making them if not: "Folder Dokumen:
  ada." or "Folder Dokumen: dibuat." A connection made before Dokumen existed gets them here,
  without reconnecting. Then the same for `Foto & Video/`: "Folder Foto & Video: ada." or "…dibuat.";
- a **sweep** of the transactions whose receipts are not yet in place in Drive, oldest first, up to
  25 per press: "{n} transaksi disinkronkan, {m} masih menunggu", with the reason for any that could
  not be finished, such as a folder in the Drive trash, which is never recreated. Then the same for
  Perjadin Documents: "{n} dokumen disinkronkan, {m} masih menunggu", and for Foto & Video: "{n}
  foto/video disinkronkan, {m} masih menunggu";
- **every Perjadin folder's name**, receipts, Dokumen and Foto & Video, brought to the trip's name
  (`Kelompok 10 · 12–13 Okt 2026 · SMAN 1 Bontang · P-1a2b3c4d`), and every Session's Foto & Video
  folder and files brought to the Session's date, time and School: "{n} nama folder dan berkas
  diganti, {m} folder tersisa". It stops after 25 renamed folders, or when the press's time is up,
  even part-way through one Session's files; a folder already right is only read, and a Session
  folder already right means its files are too, so they are not read at all. A
  folder in the Drive trash or gone is listed with the reason and left alone. Folders made before
  the name changed, or whose Sub-Cluster was renamed since, take the new name here — press again
  until nothing is left.

A trip's folders are also renamed by themselves, right after the change is saved, when either of
its dates changes or its Schools do: a Session added at a new School, moved to another School, or a
School's last Session cancelled. A Session's Foto & Video folder and files are renamed the same way
when its date or start time changes. If Drive fails then, the next Periksa koneksi catches it.

**The whole tree in the company Drive** — each folder private, and only the files marked shared:

```
SUGT ITB 2026 _staging — jangan dibagikan/          every upload lands here first, then is moved
SUGT ITB 2026 Internal App Object Storage/
├── README
├── Bukti Transaksi/Pelaksanaan Offline/
│   └── Kelompok 12 · 11–14 Okt 2026 · SMA Pradita …, SMA Trensains … · P-1a2b3c4d/
│       └── 2026-10-12 · Konsumsi · T-9f8e7d6c/          shared by link (the whole folder)
├── Dokumen/Pelaksanaan Offline/
│   └── Kelompok 12 · 11–14 Okt 2026 · … · P-1a2b3c4d/
│       ├── Daftar Hadir Peserta/
│       │   └── 2026-10-12 · SMA Pradita Dirgantara · Siswa · Daftar Hadir Peserta · D-5c6d7e8f.pdf   shared
│       └── SPPD/
│           └── SMA Pradita Dirgantara · SPPD · D-1a2b3c4d.pdf   shared
└── Foto & Video/Pelaksanaan Offline/
    └── Kelompok 12 · 11–14 Okt 2026 · … · P-1a2b3c4d/
        └── 2026-10-12 · 08.00 · SMA Pradita Dirgantara · S-3e4f5a6b/   one per offline Session
            ├── 2026-10-12 · SMA Pradita Dirgantara · Foto · M-7c8d9e0f.jpg    shared
            └── 2026-10-12 · SMA Pradita Dirgantara · Video · M-1d2e3f4a.mp4   shared
```

**Foto & Video** ([ADR-0046](./adr/0046-session-footage-is-stored-in-the-company-google-drive.md))
holds the photos (JPEG, PNG, HEIC or WebP, up to 50 MB) and videos (MP4 or MOV, up to 1000 MB) of
each offline Session, uploaded as they were taken — a photo keeps its location data — and shared one
file at a time. A large file is sent to Drive in 16 MB pieces and picks up where it stopped if the
connection drops. The trip's Group, a Perjadin Editor or an Administrator uploads them from each Session's **Foto & Video** on `/pendamping` and on `/sesi/[id]`;
anyone signed in views them on `/sesi/[id]`.

**A badge on Pengaturan** in the sidebar tells an Administrator that Drive needs them: not
connected, broken, or its folders unresolved — the states in which nobody can upload a receipt or a Dokumen.

**On the acquittal**, a line whose receipts are recorded but not yet in place in Drive shows a small
"belum tersinkron" mark. Its tooltip reads "Bukti belum tersinkron ke Google Drive — Administrator
dapat menyelesaikannya lewat Periksa koneksi." A line with no receipt never shows it.

### Log — Administrator only

**Only an Administrator sees Log**, in the sidebar just above Pengaturan and at `/log`. Anyone else,
Pimpinan included, gets the 403. It is the Activity Log: who did what to a Perjadin's money,
receipts, documents and report, and when.

A table, newest first, 50 rows a page:

| Waktu (WIB)        | Oleh   | Perjadin                                                                               | Aksi                   | Rincian                                                                     |
| ------------------ | ------ | -------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| 14 Okt 2026, 08.05 | rina@… | Kelompok 18 · 12–15 Okt 2026 — PIC: Rina Setiawati<br>SMAN 1 Bontang, SMAN 2 Samarinda | Unggah bukti           | Konsumsi · Rp1.250.000 · tgl 2026-10-12 · +1 bukti (kini 3/5) · Buka folder |
| 8 Okt 2026, 16.02  | budi@… | (the same)                                                                             | Uang Perjalanan diubah | Rp15.000.000 → Rp18.500.000                                                 |

- **Waktu** is when the act happened in the app, in WIB. "tgl" in Rincian is the date the money
  was spent, and the two differ.
- **Oleh** is the email the person had at that moment.
- **Perjadin** links to the trip by its name (`Kelompok 18 · 12–15 Okt 2026`), with its current PIC
  and, as a second line, the trip's Schools.
- **Aksi** is one of Uang Perjalanan ditetapkan, Uang Perjalanan diubah, Catat transaksi, Unggah
  bukti, Laporan dikirim, Dokumen diunggah, Dokumen dihapus, Foto/Video diunggah and Foto/Video
  dihapus. Entries derived from data recorded
  before the Log existed read "(dari data lama)" after it. The two Uang Perjalanan actions are
  history only: nothing writes them since the Advance stopped being tracked (ADR-0051), and past
  entries still read as they did. Laporan dikirim is history only the same way: nothing writes it
  since the Laporan stopped being filed (ADR-0055).
- **Rincian** says what changed. A transaction's row links to its folder in Drive, when it has one.

**Above the table**, a search box, an Aksi filter and a Rentang tanggal:

- the search matches, ignoring case, the email, the trip's Kelompok (its Sub-Cluster's name), its
  Schools, its PIC's name, and the Aksi and Rincian text;
- Aksi is Semua, Uang Perjalanan, Catat transaksi, Unggah bukti, Dokumen, Foto & Video or Laporan
  dikirim; Uang Perjalanan and Laporan dikirim now find history only;
- Rentang tanggal is two WIB dates, dari and sampai, both included.

They combine, and **all of them are in the URL**, with the page number, so a view can be bookmarked.
Below the table are the number of entries that match and the page links. The page does not update
itself: new entries appear on the next load or filter change.

### Keuangan — every transaction, for finance

`/keuangan` (#472, [ADR-0053](./adr/0053-the-programme-wide-transaction-table-is-keuangan-only.md))
is one table of every money transaction across every Perjadin. **Only a Keuangan holder or an
Administrator opens it**; anyone else, a Pimpinan included, gets the 403 from the page and from the
export, and has no **Keuangan** link. The link sits after Pendamping and before Perjadin, and keeps that
place when Pendamping moves to the top. Each Perjadin's own Laporan stays open to everyone signed in.

- **Filters**, all optional and ANDed: a searchable **Perjadin** picker ("Semua Perjadin"), listing only
  trips with transactions, earliest first; and **Dari / Sampai** on the Perjadin's **start date**, both
  ends inclusive, either end open. A Dari after Sampai applies neither date and says so.
- **Columns**: Tanggal Transaksi, Kategori, Keterangan, Perjadin (its name, linking to its Laporan),
  Tipe Peserta, Jumlah (Rp), and Link Bukti 1–5 — "Buka ↗" to each receipt in Drive, in upload order,
  blank past the last. A line whose receipts are not yet in place carries "belum tersinkron".
- **Sort**: newest Tanggal Transaksi first. Every column but the receipts sorts both ways; a new column
  starts descending and a second click flips it. Ties break by entry time, then id, so a row never moves
  between pages.
- **50 a page**, Sebelumnya / Berikutnya. Above the table, "123 transaksi · Rp45.600.000" counts and
  totals the whole filtered set, not the page. The filter, sort and page are all in the URL.
- **Ekspor CSV** downloads every row of the current filter, oldest first whatever the page's sort, as
  `keuangan-<filter>-<today>.csv`: Tanggal Transaksi, Kategori, Keterangan, Tipe Peserta, Jumlah (Rp)
  as plain digits, and Link Bukti 1–5 as full Drive URLs. There is no Perjadin column and no total row.
  It is written as the Laporan export is — a BOM, every field quoted — and both now prefix a `'` to any
  text that starts like a spreadsheet formula.
- **On a phone** the filters stack and the table scrolls sideways inside its own box; the page itself
  does not.

### Pengaturan Perjadin — the Preparation Checklist

**Only an Administrator opens Pengaturan Perjadin**, at `/perjadin/pengaturan`, from its button on
the Perjadin list. Anyone else, Pimpinan included, gets the 403. For now it does one thing: decide
which boxes the Preparation Checklist has, at its three levels
([ADR-0045](./adr/0045-the-preparation-checklist-is-stored-per-level-and-frozen-for-finished-perjadins.md)).
Its changes are not written to the Log.

**First, choose the level**: **Semua Perjadin**; **Cluster**, then one of the four from a list; or
**Perjadin**, then one trip from a search box that lists every Perjadin newest first, by its name with
its Schools as a second line. The level is in the URL, so it survives a reload. The page then shows
the checklist as it applies there:

- **Semua Perjadin** — the boxes every trip gets.
- **A Cluster** — what a trip of that Cluster that has not ended gets: the Semua boxes it has not
  hidden, in its wording, then its own.
- **A Perjadin** — that trip's own list. A finished trip shows the list it was frozen with, and says
  so: boxes added, removed or shown again for every Perjadin or its Cluster no longer reach it, but
  a wording or an order changed there still does, and changes made for it always do.

**Each box shows where it comes from** — "Semua", the Cluster's name or "Perjadin ini" — and
"Diubah di sini" when its wording was changed at this level, with the wording beneath it as "Teks
asal". Each box has:

- **Ubah**, which edits the wording in place, with Simpan and Batal; Simpan with the wording
  unchanged changes nothing. A box from this level is
  reworded itself; a box from a wider level gets a wording for this level only, which **Kembalikan
  teks asal** takes away again.
- **Hapus**, which always asks first and says what it will do: "Item ini akan hilang dari 7 Perjadin
  yang belum selesai. Perjadin yang sudah selesai tidak berubah.", counted from the trips at the
  time, or "Item ini akan hilang dari Perjadin ini." A box from this level is removed; a box from a
  wider level is hidden here, and is listed under **Disembunyikan di sini** with **Tampilkan lagi**.
- **Up and down arrows**, on this level's own boxes only, which move it within them at once. Like a
  wording, the order is not dated: it shows on finished trips too.

**"Fiksasi Dosen/Narasumber oleh PIC Dosen" has no Hapus** at any level, with a line saying why: its
tick is cleared, and must be given again, whenever the trip's Narasumber change.

**Tambah item adds nothing by itself.** It opens an empty row with Simpan and Batal; the box is
created, at the end of this level's own boxes, only on Simpan, and Batal throws the row away. An
empty wording is refused, as is one longer than 200 characters, or one another box on this list
already has (ignoring case and spacing). Ubah refuses the same. The check is against this list only:
a Semua box may share its wording with one Cluster's own box.

On a phone the Cluster and Perjadin pickers take the full width, the three level buttons wrap if
they must, each box's buttons wrap under its wording, and nothing scrolls sideways.

---

## What it deliberately does not do

Absences look like oversights unless they are written down. These are decisions.

- **No stages** between a School's first and last Session. Progress is delivered
  Sessions out of eight, and nothing else.
- **No Project Teams and no Final Projects.** Several hundred exist across the Programme;
  none are tracked. They reach the public as curated Stories, never as records — a piece
  written about one is not a record of it.
- **No approvals.** No approver role, no queue, no submitted/returned/approved states, no
  Perjadin lifecycle. Nothing in this tool waits on a decision by somebody else, and the two
  roles are the only two. An early design drew the whole apparatus and it is not being built.
- **No search inside the internal tool.** Coverage groups every School by Cluster and the
  directory filters; a third way to find a School is a screen to maintain and nothing more.
- **No outcome tracking beyond the Ratings.** Every further outcome field
  competes with the six that already exist, and data that will not be entered is worse
  than data that is absent — a half-filled field looks like a system of record and is not
  one.
- **No admin screens for Schools, Clusters or Topics.** They are fixed reference data,
  seeded by migration. **This does not extend to People** — the roster grows and
  revocations happen, so there is a People screen; see
  [ADR-0013](./adr/0013-people-are-added-in-the-tool-and-their-role-is-write-once.md).
  **Nor to Sub-Clusters**, which do have one. The three nouns above were allocated to
  DITSAMA by somebody else and the tool's job is to reflect them; a Sub-Cluster is
  DITSAMA's own judgement about which Schools are one journey, and the first trip is what
  teaches you it was wrong. See
  [ADR-0016](./adr/0016-sub-clusters-are-editable-because-nobody-allocated-them.md).
- **No scheduling, no overdue, no alerts.**

The consequence, stated plainly so nobody builds against the opposite: _"has this School
had all its Sessions?"_ is answerable. _"Is this School finished?"_ is not. See
[ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md).

---

## Still undecided

- When a Final Project is due.
