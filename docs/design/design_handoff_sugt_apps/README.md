# Handoff: SUGT — public site + internal tool (all screens)

## Overview
Full-surface UI designs for the two SUGT applications: **`@sugt/public`** (Indonesian
public showcase / DITSAMA ITB portfolio) and **`@sugt/internal`** (Staff + Teaching Team
delivery + Perjadin administration tool). Every page described in `docs/product.md`, plus
role dashboards, the four evaluation forms, connective flows, and system states.

These designs were authored **from the `mafiefa02/sugt` repo itself** — the same repo this
handoff lands in. They reflect the concept as of `docs/product.md` + `docs/data-model.md`
(the **1–10 Rating** model, not the retired 3-value pick — see "Concept delta" below).

## About the design files
`SUGT Pages.dc.html` is a **design reference created in HTML** — a single scrolling canvas
of ~30 framed screens, each labelled. It is a prototype of intended look and behavior, **not
production code to copy**. The task is to **recreate these screens in the repo's existing
environment**: Next 16 / React 19 / Tailwind v4, composing `@sugt/ui` components and
`@sugt/domain` constants, reading data through `@sugt/db` (Drizzle). Do not port the
prototype's inline styles or its little `support.js` runtime — translate each screen into
real components + Tailwind classes against the theme tokens already in
`packages/ui/src/styles/globals.css`.

Open the HTML in a browser to see every screen. There is a **Theme** toggle (top-right) for
light/dark, and the internal forms/coverage/concerns are lightly interactive to show state.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, and interaction states, all
drawn from the repo's own theme. Recreate pixel-faithfully using `@sugt/ui` + Tailwind, not
by eyeballing. Field photography is shown as labelled placeholders ("Foto lapangan") — drop
real authored photos in production.

## Concept delta (read first if you saw an earlier version)
The outcome signal is a **1–10 Rating against a named Aspect**, on four forms — NOT the old
`on track / some concerns / struggling` pick. Consequences the designs already follow:
- **`Badge` has no severity variants.** Use `default | primary | outline` only. The old
  `ontrack / concern / struggling` variants are gone; workflow-status pills (evidence
  present, pending, approved, draft) use `default`/`outline`, and genuinely-destructive
  money states use an outline badge tinted with `--destructive`.
- There is a **new `Rating` component** (see spec below) carrying the whole severity
  encoding. Its source is in your repo at `docs/design/system/components/core/Rating.jsx`.
- **Session Record was split** into **Class Record** (Teaching Team, 7 Aspects) and
  **Session Record** (PIC, 5 Aspects). Both are distinct tables in `docs/data-model.md`.
- **No Final Project / Project Team tracking** internally — they appear only as curated
  public showcase pieces. **Scope figures: 47 Schools · 16 provinces · 4 Clusters · 2
  Streams · 3 Classes/School · 10 Sessions/School (4 offline, 6 online).**

## The Rating component (the one genuinely new component)
`Rating({ value, label?, variant })` — `variant: "default" | "compact"`.
- **The digit always shows.** Magnitude is carried by the number and the meter length —
  never by color alone (the palette has no green/amber).
- **One boundary only:** `value <= 7` (`CONCERN_AT_OR_BELOW` in `@sugt/domain`) reads red;
  8+ is quiet muted grey. Do **not** add mild/bad/severe bands.
- Within 1–7 the fill **deepens continuously** (opacity ramp on the meter; `color-mix`
  transparency ramp on the compact chip). A 1 is solid, a 7 faint.
- `default` = label + 10-segment meter + digit (forms, record detail, read-only rows).
  `compact` = tinted digit chip, meter hidden (dense list rows, e.g. Concerns).
- The compact concern chip's **digit stays `--foreground`, not `--destructive`** — red text
  on a red tint fails AA. This is measured; don't "fix" it to a red digit.
Port `Rating.jsx` verbatim into `@sugt/ui` (it did not exist in the repo's `src/components`).

The rating **input** used in the forms (Class Record, Perjadin Evaluation, Participant) is a
row of ten 28px cells (23px on the phone form); the selected cell is filled `--destructive`
(white text) when ≤7, else `--foreground` (background-colored text). Build this as a small
`RatingInput` control in `@sugt/ui`.

## Screens / Views
Each `<section>` in the HTML is labelled with a small title + one-line purpose. Grouped:

### Public site (`@sugt/public`) — centred, max-width 1120px, Indonesian
- **Beranda** — homepage; leads with scope figures, delivery figures accrue below.
- **Program** — Streams, the three Classes, the 4-offline/6-online Session rhythm.
- **Cerita (list + detail)** — authored field stories; list has Semua/STEM/Research filter.
- **Cluster (listing + detail)** — Schools grouped by Cluster (one Topic + Problem each).
- **Tentang** — about DITSAMA ITB; scope figure band (47 · 16 provinsi · 2 · 10).
- **Final Project (showcase)** — curated public pieces only (not internal records).
- **School — public page** — Cluster → School → its published stories.
- **Pencarian, 404** — search results and not-found.
- **Mobile** variants of Beranda, Cerita, Cluster.

### Internal tool (`@sugt/internal`) — fixed 240px sidebar + fluid main, dense bordered tiles
- **Masuk** — Google sign-in, invite-list gated (`person` is the invite list).
- **Dashboard — Teaching Team** *(new)* — greeting + Stream; count tiles; "Perlu Anda isi"
  (Class Records + Perjadin Evaluation owed); upcoming Sessions taught; a concern from a
  Class they taught. **Sidebar omits Perjadin Report** (money is Staff-only).
- **Dashboard — Staff** *(new)* — greeting + Staff/PIC badges; six programme-overview count
  tiles; per-Cluster coverage bars (uneven cluster sizes 7/18/12/10); a **Staff-only** Advance
  strip; "Perlu Anda kerjakan"; a **PIC work** card (Perjadin Report days-remaining,
  transactions logged, member-receipt checklist, remainder to return). PIC work appears only
  because PICs are always Staff.
- **Coverage** — every School by delivered count, grouped by Cluster; multi-select Schools →
  create a Perjadin. Counts only, no health color.
- **Rencanakan Perjadin** — validated create form launched from Coverage selection.
- **School detail / directory** — a School's ten Sessions; flagged Sessions show a compact
  Rating chip of the lowest Aspect, clean ones read "Tanpa concern".
- **Class Record** *(form)* — Teaching Team, 7 Aspects (Comprehension, Participation,
  Readiness, Materials, Delivery, Facilities, Timing) + Covered/Problems/Suggestions;
  Rating ≤7 requires prose.
- **Session Record — PIC** *(saved view)* — 5 Aspects (Facilities, Turnout, School support,
  Timing, Coordination) as read-only Rating meters + a "who still owes what" list (6 Class
  Records + PIC's Session Record).
- **Participant feedback** *(public, no sign-in)* — 24h QR-token form; class picker + 3
  Aspects (Materials, Instructor, Relevance) + comment + self-typed name. No elaboration rule.
- **Perjadin Evaluation** *(form)* — 4 Aspects (Lodging, Transport, Meals, Punctuality) +
  Problems/Suggestions. Not Staff-only.
- **Concerns (+ empty state)** — every Aspect Rated ≤7 across all four sources, newest first;
  each row shows source badge, subject (School · Class), Aspect + compact Rating chip, filer;
  internal rows carry prose, Participant rows note none is required. Source filter tabs.
- **Perjadin (list + detail), Advance, Perjadin Report / acquittal** — money, Staff-only;
  evidence-gated export.
- **Flows & states** — record-a-Session loop, resolve-a-concern, publish-a-story, advance
  approval, offline/loading/error/empty/notification states.

## Interactions & behavior
- **Theme:** `.dark` class on the root toggles the whole theme; brand red is unchanged
  between light/dark.
- **Rating input:** tap a cell 1–10; ≤7 turns the cell red and reveals the "wajib dijelaskan"
  requirement note. Coverage: multi-select rows → action bar → create Perjadin.
- **Concerns:** source filter tabs (Semua / Class Record / Session Record / Participant /
  Perjadin). **Cerita:** Semua/STEM/Research filter.
- **Nothing is gated, nothing is overdue.** The acquittal shows days-remaining (derived from
  `perjadin.ends_on + REPORT_DEADLINE_DAYS_AFTER_RETURN`), never a block.
- Transitions ~150ms ease; press nudges controls `translateY(1px)`; focus is a 3px ring at
  `--ring/30%`. No bounce, no scale.

## State management
Delivery data is open to anyone signed in; **money (`perjadin` financials, transactions,
receipts) is Staff-only** — enforced in app code at a single `@sugt/db` choke point, not RLS.
Writing stays with a record's owner. Key derived values (never stored): PIC =
`coalesce(session.online_pic_person_id, perjadin.pic_person_id)`; progress =
`count(delivered) / TOTAL_SESSIONS_PER_SCHOOL`; report deadline; acquittal remainder =
`advance_idr − sum(amount_idr)`; the "who owes what" list = `session_teacher × 3 class kinds
− filed class_records`. See `docs/data-model.md` for the full schema and every invariant.

## Design tokens
Do not re-enter these — they already live in `packages/ui/src/styles/globals.css`
(mirrored in `docs/design/system/tokens/`). Take values from there:
- **Color:** achromatic neutrals (hue 0) + one brand hue, brick red
  `--primary: oklch(0.527 0.16 26.893)` (`--accent` equals it). Severity lives entirely in
  the red ramp / `--destructive`; no green, no amber. Full light + dark.
- **Radius:** `--radius: 0.625rem` (10px) base; scale multiplies off it (`rounded-2xl` on
  controls = 18px). One value re-rounds everything.
- **Type:** Montserrat only (heading = sans). 400/500/600/700/800; **500 is the UI default**,
  700 headings, 800 display figures. Headings tracking `-0.02em`; UI text 14px, body 16px.
  In-app load Montserrat via `next/font` (the prototype's Google-Fonts `@import` is a
  prototype-only shortcut — do not port it).
- **Spacing:** Tailwind default 4px step; control height `h-8` (32px).
- **Surfaces:** flat, border-led. One 1px `--border` does cards/rows/dividers; shadow only on
  overlays. Cards = bordered box, no shadow.

## Aspect rubrics (columns, from `@sugt/domain`)
- **Class Record:** Comprehension, Participation, Readiness, Materials, Delivery, Facilities,
  Timing.
- **Session Record:** Facilities, Turnout, School support, Timing, Coordination.
- **Participant Feedback:** Materials, Instructor, Relevance.
- **Perjadin Evaluation:** Lodging, Transport, Meals, Punctuality.
All 1–10; `CONCERN_AT_OR_BELOW = 7`; internal forms require prose on a Rating ≤7 (a DB CHECK).

## Iconography
**Lucide** (`lucide-react`, PascalCase exports). The prototype references icons by kebab name
via `data-lucide`; map e.g. `file-down → FileDown`, `receipt-text → ReceiptText`,
`triangle-alert → TriangleAlert`, `clipboard-pen → ClipboardPen`, `qr-code → QrCode`.

## Assets
`assets/logo-sekolah-garuda.png` (primary lockup, brand red — use everywhere) and
`assets/logo-dpb-full.jpeg` (DITSAMA ITB organiser mark — footer/organiser context only).
Included in this bundle.

## Files
- `SUGT Pages.dc.html` — the design reference (all screens; each `<section>` labelled).
- `support.js` — prototype runtime only; **do not port**.
- `_ds/…` — the design-system bundle + token CSS the prototype loads, for faithful rendering
  when you open the HTML. The **source of truth in-repo** is `packages/ui` +
  `docs/design/system/` (which also holds `Rating.jsx`).
- `assets/…` — brand logos.

Reference alongside: `docs/product.md` (surfaces), `docs/data-model.md` (schema + invariants),
`docs/adr/` (why each decision), `packages/domain/src/index.ts` (the fixed sets & Aspect lists).
