# SUGT — STEM & Research Track · Design System

Design system for **Sekolah Unggul Garuda Transformasi (SUGT)**, the STEM & Research
Track delivered by **DITSAMA ITB** (Direktorat Persiapan Bersama ITB) on commission
from **Kementerian Pendidikan Tinggi**. It captures the visual foundations, tone, and
component vocabulary of two applications:

- **`@sugt/public`** — a public showcase of the Programme (Indonesian), which also
  doubles as DITSAMA ITB's portfolio. Ships first.
- **`@sugt/internal`** — a Staff/Teaching-Team tool for tracking Session delivery and
  Perjadin (duty-travel) administration.

## Sources

Built from the attached monorepo **`mafiefa02/sugt`** (a pnpm + Turborepo workspace,
Next 16 / React 19 / Tailwind v4). Explore it further to build higher-fidelity designs:

- `packages/ui/src/styles/globals.css` — the entire theme (shadcn **base-rhea** style, Base UI primitives). Colours, radius scale, and font wiring are copied verbatim into `tokens/`.
- `packages/ui/src/components/button.tsx` — the **only** implemented component. Ported faithfully to `components/core/Button.jsx`.
- `docs/product.md`, `CONTEXT.md`, `README.md`, `AGENTS.md` — product surfaces, domain vocabulary, and repo conventions. The UI kits are built from `product.md` because the apps themselves are still placeholders (`apps/public` renders `<Button>Tes</Button>`; `apps/internal` is empty).

> **Repo GitHub URL:** `https://github.com/mafiefa02/sugt` (recorded in `github.md`). If you can access it, read `docs/product.md` and `docs/adr/` for the reasoning behind every screen.

---

## CONTENT FUNDAMENTALS

The domain lexicon is strict and the copy is disciplined. Follow it exactly — the
words carry meaning the product depends on.

**Language.** Domain terms are **English** (the codebase is English): *Session, School,
Cluster, Stream, Perjadin, Advance, PIC, Class Record, Session Record, Aspect, Rating,
Participant Feedback, Perjadin Evaluation*. Public-facing **UI copy is Indonesian**. Some
Indonesian terms have no English equivalent and are kept verbatim: **Perjadin, PIC, GTK,
MS, Kabupaten/Kota**.

**Aspects are the exception**: English in the schema, Indonesian on screen — *Pemahaman*,
*Fasilitas*, *Penginapan*. They are the only domain terms a Participant reads, and the
Participant form is filled by school teachers and students. See *Ratings and severity*.

**A Session Record is the PIC's** account of the visit; the teaching account is a **Class
Record**, one per Class per professor. They are different documents with different rubrics
— do not use one word for both.

**Tone: counts, not claims.** The system reports what happened and lets a human judge it.
- The internal tool shows **"3 of 10 delivered"** — never "behind", "overdue", or "finished". Nothing is ever gated on a deadline. The only thing coloured as a verdict is a **Rating** at or below 7, and even then the number does the work and the colour reinforces it.
- The public site **leads with scope** ("47 Sekolah, tersebar di 16 provinsi"), and shows delivery figures only *as they accrue* — never "0 of 47 reached".

**Casing.** Domain nouns are **Capitalised** in prose (a School, a Session, the Group).
UI labels and headings use sentence case. The wordmark **SUGT** is all-caps.

**Person.** Institutional and neutral — third person, no "you"/"we" marketing voice.
Describes the Programme, doesn't sell it.

**Emoji:** none, anywhere. **Exclamation marks:** avoid. **Vocabulary to avoid** (from
`CONTEXT.md`): "event" (→ Programme), "trip/visit" (→ Perjadin), "overdue", "selesai/finished".

**Examples**
- Public: *"Membangun kapasitas riset di sekolah-sekolah unggul Indonesia."*
- Public scope: *"47 Sekolah · 2 Stream · 3 Kelas / sekolah · 10 Sesi / sekolah."*
- Internal count: *"3 dari 10 sesi terlaksana."*
- Aspect Rating: *Pemahaman 4 · Fasilitas 9.* The digit is the message.

---

## VISUAL FOUNDATIONS

**Rounded, consistently.** `--radius` is `0.625rem` (10px), and every step multiplies
that base off the component classes (`rounded-sm` → 6px, `rounded-lg` → 10px,
`rounded-2xl` → 18px on controls). Rounding is driven entirely by this one token, so
re-rounding — or squaring, at `0` — the whole system is a single-line change.

**Colour.** Achromatic neutrals (hue 0) plus a **single brand hue: brick red**
(`--primary: oklch(0.527 0.16 26.893)`). There is no second brand colour — `--accent`
*equals* `--primary`. Data visualisation is a **single red ramp** (`--chart-1…5`), not a
categorical palette. Because the palette has no green and no amber, **severity is never a hue** — it is a
number, reinforced by one colour. See *Ratings and severity* below. Full light (`:root`)
and dark (`.dark`) themes; the brand red is unchanged between them. All colours are
authored in **oklch**.

**Type.** One family: **Montserrat** (geometric sans), used for both body and headings
(`--font-heading` = `--font-sans`). Loaded via Google Fonts here; the repo loads it via
`next/font`. Weights 400/500/600/700/800 — **500 is the UI default** (buttons, labels),
700 for headings, 800 for display figures. Headings use tight tracking (`-0.02em`);
default UI text is 14px, body 16px.

**Spacing.** No custom scale — Tailwind's default **4px step** used directly
(`px-3` = 12px, `gap-1.5` = 6px, `h-8` = 32px control height). Aliased in `tokens/spacing.css`.

**Surfaces, borders & elevation.** The system is **flat and border-led**. A single
`1px` `--border` (`oklch(0.845 0 0)`, white/10% in dark) does the structural work —
cards, table rows, dividers. Shadow is reserved for overlays (popovers, dialogs, the
coverage action bar). Cards are a bordered box with no rounding and no shadow.

**Focus & interaction.** Focus is a **3px ring** at `--ring/30%` plus a solid ring-colour
border. Button hover **fades the fill** (default → `primary/80`; ghost/outline → `--muted`).
Press **nudges the control down 1px** (`translateY(1px)`) — no scale, no colour flip.
Transitions are short (~150ms ease); no bounce, no elaborate motion.

**Imagery.** Photography is *authored for publication* — deliberate field photos of
Schools and students (media consent is covered by enrolment). Never harvested from
records. In these specimens, imagery is a labelled placeholder ("Foto lapangan"); drop
real photographs in for production.

**Layout.** Public site is centred, max-width ~1120px, generous vertical rhythm, full-width
bordered section bands. Internal tool is a fixed 240px sidebar + fluid main, dense
bordered tables and tiles.

---

## RATINGS AND SEVERITY

The outcome signal is a **Rating**: 1–10 against a named **Aspect**, on four forms with
four different rubrics (`docs/data-model.md`). This replaces an earlier three-value pick
(*on track / some concerns / struggling*) that no longer exists anywhere in the product.

**The number carries the magnitude.** Always shown, tabular figures, reinforced by the
length of a ten-segment meter. Colour never carries it alone — which is the accessible
answer and, in a palette with no green and no amber, the only one available.

**Colour marks exactly one boundary.** At or below **7** an Aspect reaches the concerns
list and reads red; **8 and above are quiet grey**. That threshold is the domain's
(`CONCERN_AT_OR_BELOW` in `@sugt/domain`) and it is the only one. Do **not** invent
"mild / bad / severe" bands — the product apologises for the one threshold it has, and
adding two more in the visual layer would be worse than the palette limitation ever was.

**Within 1–7, density is continuous.** The fill deepens smoothly from a faint 7 to a solid
1. No steps, no categories, nothing for a reader to decode.

**Good is quiet, never green.** A high Rating gets no reward colour; it simply stops being
red. Counts, not claims.

### Aspect labels

Aspects are English in the schema and **Indonesian on screen** — the same rule
`CONTEXT.md` already applies to every domain term. The Participant form settles it: it is
filled by school teachers and students, so it cannot be in English, and one language
across all four forms beats two.

| Form | Aspect (column) | Label |
| --- | --- | --- |
| Class Record | `comprehension` | Pemahaman |
| | `participation` | Partisipasi |
| | `readiness` | Kesiapan |
| | `materials` | Materi |
| | `delivery` | Penyampaian |
| | `facilities` | Fasilitas |
| | `timing` | Ketepatan waktu |
| Session Record | `facilities` | Fasilitas |
| | `turnout` | Kehadiran |
| | `school_support` | Dukungan sekolah |
| | `timing` | Ketepatan waktu |
| | `coordination` | Koordinasi |
| Participant Feedback | `materials` | Materi |
| | `instructor` | Pengajar |
| | `relevance` | Relevansi |
| Perjadin Evaluation | `lodging` | Penginapan |
| | `transport` | Transportasi |
| | `meals` | Konsumsi |
| | `punctuality` | Ketepatan jadwal |

`timing` and `punctuality` would both read "Ketepatan waktu" literally; they never share a
form, but they are given distinct labels anyway so the concerns list — which unions all
four sources — never shows the same words meaning two things.

---

## ICONOGRAPHY

The design system standardizes on **Lucide** for iconography — loaded from CDN
(`unpkg.com/lucide`) in the specimen cards and both UI kits. Icons are line/stroke
glyphs at ~24px, `size-4` (16px) inside
controls, `size-3` (12px) at `xs`.

> **Note on the repo.** The source monorepo declares **hugeicons**
> (`@hugeicons/core-free-icons` + `@hugeicons/react`) in `pnpm-workspace.yaml` and its
> `components.json` files. This design system deliberately adopts **Lucide** instead
> (Lucide is canonical here). Lucide and hugeicons share the same 24px stroke grid, so
> production code that still imports hugeicons stays visually consistent — but new work
> against this system should use Lucide.
>
> **Usage.** Load `https://unpkg.com/lucide` and render `<i data-lucide="name"></i>`,
> calling `lucide.createIcons()` after mount (React: in a `useEffect`). Sizes: 16px in
> controls, 12px at `xs`.

No icon font, no emoji, no Unicode glyphs used as icons. The brand marks live in
`assets/`: **`logo-sekolah-garuda.png`** is the primary lockup (garuda mark + “SEKOLAH
GARUDA” wordmark, in the brand red) and **`logo-dpb.png`** is the supporting DPB /
DITSAMA ITB organiser mark. Use Sekolah Garuda as the primary mark everywhere; DPB
appears only in an organiser/collaborator context (e.g. the public footer). Both are
transparent PNGs — see `guidelines/brand-wordmark.card.html`.

---

## Components

Built in `components/core/` (namespace `window.SUGTDesignSystem_4f31cd`):

- **Button** — faithful port of the repo's only real component (Base UI + cva, shadcn base-rhea). Variants: default / outline / secondary / ghost / destructive / link. Sizes: default / xs / sm / lg + square icon sizes.
- **Card** — bordered surface container (title / description / footer / body).
- **Badge** — status & count pill. Labels and counts only; it carries no severity.
- **Rating** — a 1–10 Aspect score: label, meter, digit. The component every evaluation form and the concerns list is built from.
- **Input** — text field + `as="textarea"`, with error (`aria-invalid`) state.

### Intentional additions

The source defines exactly **one** component (Button); the apps are placeholders. **Card,
Badge, Rating and Input** are additions, included because the product surfaces in `docs/product.md`
cannot be rendered without them. Each is styled strictly to the established base-rhea
vocabulary (rounded corners, 1px border, muted fills, the exact control metrics from
Button) and adds no new visual ideas. If the team implements its own versions, treat those
as the source of truth.

---

## UI kits

- **`ui_kits/public/`** — the public homepage (`Beranda`), scope-led, Indonesian.
- **`ui_kits/internal/`** — the internal tool: Coverage (landing) → select Schools → Buat Perjadin; Concerns list; and the acquittal (Perjadin Report) with evidence-gated export.

Both are built to `docs/product.md` because the repo apps are placeholders. They are
faithful to the *specification*, not copied from finished screens.

---

## Index / manifest

```
styles.css                      global entry — @import list only
tokens/
  typography.css                Montserrat, weights, type scale (Google Fonts @import)
  colors.css                    :root + .dark, verbatim from globals.css (oklch)
  radius.css                    --radius: 0.625rem (10px) + scale
  elevation.css                 borders, shadow ramp, focus ring
  spacing.css                   Tailwind 4px step, control heights
components/core/                 Button, Card, Badge, Rating, Input (+ .d.ts, .prompt.md, card)
guidelines/                      13 foundation specimen cards (Colors / Type / Spacing / Brand)
ui_kits/public/                  Beranda homepage recreation
ui_kits/internal/                Coverage / Concerns / Acquittal recreation
thumbnail.html                   homepage tile
SKILL.md                         Agent Skills manifest
github.md                        source-repo association
```

---

## CAVEATS

- **The repo is early-stage.** Only `Button` and the theme tokens are real code; both apps
  are placeholders and there is no database, no other component, and no finished screen.
  Everything beyond tokens + Button is built to `docs/product.md` and clearly labelled.
- **Icons: Lucide** is canonical (loaded via CDN). The source repo declares hugeicons; this system adopts Lucide instead — same 24px stroke grid, so it stays consistent with any existing hugeicons code.
- **Logos provided** — Sekolah Garuda (primary) and DPB (supporting) are in `assets/` and wired into the thumbnail, specimen card, and both UI kits.
- **Montserrat** is the genuine font (Google-hosted here); no substitution.
