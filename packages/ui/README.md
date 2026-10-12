# `@sugt/ui`

The primitives both apps share, and the one stylesheet that declares the theme.

Read [`AGENTS.md`](../../AGENTS.md) for how `shadcn add` is run here and why the
`@source` line in `globals.css` is load-bearing. Read
[`docs/design/README.md`](../../docs/design/README.md) for what the imported design
bundle is and what must not be ported out of it.

## Rule 4, in one paragraph

Both apps depend on this package, so **anything it can reach, the public app can
reach** — and the public app deliberately holds no database credentials
([ADR-0010](../../docs/adr/0010-one-shared-ui-package-not-shadcn-per-app.md), and
[ADR-0001](../../docs/adr/0001-public-site-reads-aggregates-only.md) behind it). So
nothing here fetches data, reads an environment variable, or imports `@sugt/domain`.
A component that needs a domain value takes it as a prop.

## The inventory

Derived from the thirty first-iteration surfaces enumerated in
[issue #9](https://github.com/mafiefa02/sugt/issues/9), plus the design handoff. The
rule for adding one: **name the surface that needs it.** A primitive nobody has a
surface for is a file to maintain and nothing more.

`shadcn add` writes against **Base UI**, not Radix, so a custom trigger uses
`render={<X />}` and never `asChild`.

| Component      | From                  | A surface that needs it                                                                                                                                                                                                                                                                                |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accordion`    | hand-written          | Monitoring — "Peringatan yang diabaikan" ([#178](https://github.com/mafiefa02/sugt/issues/178)); Perjalanan Dinas Anda — one card per trip, the Persiapan pill beside its title trigger ([#348](https://github.com/sugt-itb/sugt-itb-26/issues/348))                                                   |
| `alert`        | `shadcn add`          | Perjadin Report — the note that a transaction has no evidence                                                                                                                                                                                                                                          |
| `avatar`       | `shadcn add`          | Rencanakan Perjadin — the Group's members; the sidebar's signed-in Person                                                                                                                                                                                                                              |
| `badge`        | `shadcn add`          | Concerns — which of the four sources a row came from; Cerita — the Stream                                                                                                                                                                                                                              |
| `breadcrumb`   | `shadcn add`          | Cerita (detail), Cluster (detail), the Class Record form's header — the handoff draws each as raw `a / span` markup rather than as a named component                                                                                                                                                   |
| `button`       | `shadcn add`          | everywhere; the package's first component                                                                                                                                                                                                                                                              |
| `card`         | `shadcn add`          | both Dashboards' count tiles; Program's two Streams                                                                                                                                                                                                                                                    |
| `checkbox`     | `shadcn add`          | Coverage — selecting Schools for a Perjadin or a batch of online Sessions                                                                                                                                                                                                                              |
| `collapsible`  | `shadcn add`          | Perjalanan Dinas Anda — the trip card's Narasumber, one fold per School ([#447](https://github.com/sugt-itb/sugt-itb-26/issues/447)); the height animation is styled at the card, as Base UI's demo draws it. Not `accordion`: the folds sit inside an accordion panel and each opens on its own       |
| `combobox`     | `shadcn add`          | Rencanakan Perjadin — the extra-Staff and "Diajar oleh" multi-selects; a Base UI combobox with chips                                                                                                                                                                                                   |
| `dialog`       | `shadcn add`          | Tandai terlaksana, Batalkan Sesi; every popup that takes data, as the `panel` size — see [The two Dialog sizes](#the-two-dialog-sizes)                                                                                                                                                                 |
| `empty`        | `shadcn add`          | Concerns — the empty state is a named surface, not an absence                                                                                                                                                                                                                                          |
| `field`        | `shadcn add`          | the four evaluation forms — label, description and error as one unit                                                                                                                                                                                                                                   |
| `input`        | `shadcn add`          | Rencanakan Perjadin, Orang's add form, Pencarian                                                                                                                                                                                                                                                       |
| `input-group`  | `shadcn add`          | dependency of `combobox` — the chips/input shell it composes; kept because removing it breaks that import                                                                                                                                                                                              |
| `label`        | `shadcn add`          | every form                                                                                                                                                                                                                                                                                             |
| `link-button`  | hand-written          | every control that navigates but looks like a Button — see [Button vs LinkButton](#button-vs-linkbutton)                                                                                                                                                                                               |
| `popover`      | `shadcn add`          | Monitoring — the calendar's click-to-open event popup, anchored to a date cell ([#233](https://github.com/mafiefa02/sugt/issues/233))                                                                                                                                                                  |
| `progress`     | `shadcn add`          | Coverage — delivered against ten; the Staff Dashboard's per-Cluster bars                                                                                                                                                                                                                               |
| `rating`       | hand-written          | Concerns, Detail Sekolah, Detail Sesi — every Rating already filed                                                                                                                                                                                                                                     |
| `rating-input` | hand-written          | Class Record, Session Record, Perjadin Evaluation, Participant Feedback                                                                                                                                                                                                                                |
| `select`       | `shadcn add`          | Perjadin Report — Kategori, a closed twelve-value set; Direktori Sekolah's Cluster filter                                                                                                                                                                                                              |
| `separator`    | dependency of `field` | not chosen — arrived with `field`, kept because removing it breaks that import                                                                                                                                                                                                                         |
| `sheet`        | `shadcn add`          | the public site on a phone — the header's four sections behind a menu                                                                                                                                                                                                                                  |
| `skeleton`     | `shadcn add`          | the loading states of both apps                                                                                                                                                                                                                                                                        |
| `switch`       | `shadcn add`          | the internal sidebar's Mode Gelap row — on in Dark, the whole row toggles it ([#358](https://github.com/sugt-itb/sugt-itb-26/issues/358))                                                                                                                                                              |
| `table`        | `shadcn add`          | Perjadin Report's transactions, Direktori Sekolah, Orang, the Perjadin list                                                                                                                                                                                                                            |
| `tabs`         | `shadcn add`          | Concerns' source filter, Cerita's Semua / STEM / Research filter                                                                                                                                                                                                                                       |
| `textarea`     | `shadcn add`          | Covered, Problems and Suggestions on three forms; the Participant's comment                                                                                                                                                                                                                            |
| `time-field`   | hand-written          | every time-of-day input — Session, online-Session and Perjadin session times — forced to 24-hour on any browser locale ([#328](https://github.com/mafiefa02/sugt/issues/328)); a masked text input because no attribute forces the native `<input type="time">` picker off the browser's AM/PM         |
| `tooltip`      | `shadcn add`          | the internal sidebar's collapsed rail — each nav icon, the theme button, the avatar and sign-out name themselves on hover and focus ([#359](https://github.com/sugt-itb/sugt-itb-26/issues/359)); the acquittal's "belum tersinkron" mark ([#375](https://github.com/sugt-itb/sugt-itb-26/issues/375)) |

### Deliberately absent

Absences look like oversights unless they are written down.

| Not added                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@shadcn/sidebar`                                               | It is a collapsible provider block at `--sidebar-width: 16rem` (256px). The internal sidebar does collapse now — 288px to a 64px icon rail ([#359](https://github.com/sugt-itb/sugt-itb-26/issues/359)) — but the block is still the wrong fit: it would replace the phone top bar and drawer the shell already has ([#122](https://github.com/mafiefa02/sugt/issues/122), [#127](https://github.com/mafiefa02/sugt/issues/127)), and the collapsed header's logomark-into-panel-icon swap is custom either way. So the shell stays hand-written in the app against the `--sidebar-*` tokens this package already declares. |
| `command`                                                       | `combobox` is now added (Rencanakan Perjadin's multi-selects, [#137](https://github.com/mafiefa02/sugt/issues/137)) — the Base UI combobox is self-contained (its own popup and filtering), so `command` (a `cmdk` palette) is not needed with it. `popover` is now added for the Monitoring calendar's event popup ([#233](https://github.com/mafiefa02/sugt/issues/233)); no surface asks for `command` on its own.                                                                                                                                                                                                       |
| `calendar`                                                      | The same form takes two dates, and the handoff draws `<input type="date">`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `toast`, `sonner`                                               | Nothing in the thirty surfaces reports a result that way. The Class Record form shows "Menyimpan otomatis · terakhir 10:42" instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `dropdown-menu`, `pagination`, `scroll-area`, `navigation-menu` | No surface asks for one. The public header is four links; forty-seven Schools do not paginate; `/log` pages with two plain links.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `chart`                                                         | The two bar-shaped things in the design are progress against a fixed denominator, which `progress` is. There is no chart in the first iteration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `radio-group`                                                   | `rating-input` uses native radios, so it needs no styled one, and no other surface has a radio.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| a file input                                                    | Perjadin Report attaches evidence through a signed upload URL. The registry has no upload primitive to add, so the control is hand-written by [issue #30](https://github.com/mafiefa02/sugt/issues/30) against the shape that endpoint needs.                                                                                                                                                                                                                                                                                                                                                                               |
| `carousel`                                                      | Cerita (detail) carries a gallery whose first photo is the cover. Whether that reads as a carousel or a grid is [issue #38](https://github.com/mafiefa02/sugt/issues/38)'s, and a grid needs no component.                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Button vs LinkButton

`Button` is for controls that **act** — submit, cancel, open a dialog. `LinkButton` is for
controls that **navigate** but should look the same. They are not interchangeable, and the
difference is in the accessibility tree, not the pixels.

Base UI's `Button` is a button. Rendering it as a link — `render={<Link />}`, the pattern this
package uses over `asChild` — has no good setting, and this was checked in Base UI 1.7 rather
than assumed:

- `nativeButton` defaults **true**, so Base UI expects a real `<button>` and logs a warning on
  every such site because the element is an `<a>`. Its keyboard and `disabled` handling branch on
  that flag too, so both are wrong for a link.
- `nativeButton={false}` silences the warning, but Base UI then applies button semantics to the
  anchor — it reports **`role="button"`** and answers Space. A control that navigates is a
  **link**: it should report `role: link` and be driven by Enter alone. So `nativeButton={false}`,
  per call site or defaulted in the wrapper, trades the one thing that was already right for the
  warning's silence. That is why it is the **wrong** fix, and why neither option the issue
  proposed was taken.

`LinkButton` sidesteps both. It never touches Base UI's `Button`: it styles the app's own link
(injected through `render`, so this package stays free of `next/link`) with `buttonVariants`. The
result is a real anchor — `role: link`, Enter navigates, Space does not — that matches `Button`
exactly. See [#51](https://github.com/mafiefa02/sugt/issues/51).

Base UI's other button-based controls — `Dialog.Close` / `SheetClose`, and anything else built on
`use-button` — carry the same trap when handed a navigating `render`. `LinkButton` does not fit
them, because they also act on click (a `SheetClose` closes the sheet). That case is tracked
separately.

## The two Dialog sizes

`DialogContent` takes a `size` ([#417](https://github.com/sugt-itb/sugt-itb-26/issues/417)).
Staff work the internal app mostly from phones, and a popup that grew with its content jumped as
each row was added, then cropped its own title and buttons once it outgrew the screen.

- **`default`** — the small centred popup, as `shadcn add` wrote it. It grows with its content, so
  it is for content that does not grow: confirmations (Hapus, Tandai terlaksana, Batalkan Sesi),
  single-value edits (Ubah tanggal), the Story editor's link popup and the two
  QR popups.
- **`panel`** — for every popup where data is entered. A fixed panel about 900px wide and the
  screen's height less a margin on desktop, the whole screen below `sm`; **the same size from
  opening to closing** whatever is added to it. It is a column: `DialogHeader` pinned at the top,
  `DialogFooter` at the bottom, and the fields inside **`DialogBody`**, the only part that scrolls.
  `DialogBody` belongs to `panel` only — its edge-to-edge margins assume the panel's padding.
  Used by Catat Transaksi, Dokumen, the Dashboard's Persiapan card editor, the Persiapan checklist,
  Catatan Sesi, Tambah/Ubah Sesi, Ubah Group and Ubah Sesi daring.

Inside a panel, short fields may sit two or three to a row from `sm` up, and a row holding several controls
wraps rather than spilling sideways. A panel never takes its own `max-h-*` or `overflow-*` — the
body is what scrolls. `DialogHeader` keeps right padding in both sizes, so a long title never runs
under the close button.

`closeDisabled` disables the close button while a popup refuses to close — an upload to Google
Drive running ([#420](https://github.com/sugt-itb/sugt-itb-26/issues/420)). Esc and a click outside
are not buttons, so the caller's `onOpenChange` must ignore the close as well.

## The two Rating controls

A **Rating** is the score one person gives one Aspect. It is the only thing in the
system anything counts, so it gets two controls: `Rating` reads one back, and
`RatingInput` files one.

### The bounds arrive as props, with no defaults

`RATING_MIN`, `RATING_MAX` and `CONCERN_AT_OR_BELOW` live in `@sugt/domain`, which rule
4 forbids this package importing. So every call site passes them:

```tsx
import { CONCERN_AT_OR_BELOW, RATING_MAX, RATING_MIN } from "@sugt/domain";

<Rating
  min={RATING_MIN}
  max={RATING_MAX}
  concernAtOrBelow={CONCERN_AT_OR_BELOW}
  value={4}
  label="Pemahaman"
/>;
```

**There are no defaults, deliberately.** A `10` written into this package would be a
second source of truth for a number that also sits in a CHECK constraint and four index
predicates, and a default would let a caller drift from the database with nothing saying
so. The cost is verbosity at every call site, and that is what rule 4 is worth.

The same rule reaches further than the props themselves. Nothing inside either component
compares against a literal: the meter length and the cell count are `max - min + 1`, and
the severity ramp is a position between `concernAtOrBelow` and `min`. The handoff's
`Rating.jsx` keys that ramp on absolute values — `[data-value="7"]` down to
`[data-value="1"]` — and porting those selectors would have put 7 and 10 back in this
package through the stylesheet. Same numbers, derived rather than written:

| Rating | Meter opacity | Compact chip                       |
| ------ | ------------- | ---------------------------------- |
| 7      | 0.550         | `--destructive` at 92% transparent |
| 6      | 0.625         | 89%                                |
| 5      | 0.700         | 86%                                |
| 4      | 0.775         | 83%                                |
| 3      | 0.850         | 80%                                |
| 2      | 0.925         | 77%                                |
| 1      | 1.000         | 74%                                |

The chip column reproduces the handoff exactly. The opacity column is the same straight
ramp the handoff draws, and the handoff writes it rounded to two decimals — so two
values differ from the figures in `Rating.jsx` by 0.01 (it has .62 and .86 where the
ramp gives .625 and .85).

### What survived the port, and must keep surviving

- **The digit always shows.** The palette has no green and no amber, so magnitude is
  carried by the number and by the length of the meter. Colour only ever reinforces.
- **Colour marks one boundary.** At or below the threshold reads red; above it reads
  quiet grey. Good is never green — it simply stops being red. Do not band the concern
  range into mild, bad and severe: the domain has one threshold and apologises for it.
- **The compact chip's digit is `--foreground`, not `--destructive`.** Red text on a red
  tint measures 2.96:1 at the densest chip in light mode, below AA, and it gets worse as
  the chip deepens. This is measured. Don't "fix" it back to a red digit.

`RatingInput` fills the picked cell solid rather than tinting it — a filled cell states
a choice, where the chip reports one. Its cells are 28px, or 23px at `size="sm"`
for the Participant Feedback form, which is filled on a phone in a classroom rather than
at a desk. That is a prop rather than a breakpoint because the surface is phone-first,
not a desktop form at a small viewport.

Those sizes are the most a cell grows to (#417). Beside a label in a flex row the control
keeps its full width and the label wraps first, as fixed cells did; on a row of its own,
label above, the cells shrink to fit a row narrower than they are rather than spill
sideways.

It is built on native radios, so it needs no state of its own, arrow keys work, and a
`<form>` posts the value without JavaScript. Pass `value` and `onValueChange` to drive
it from a form library instead.

## What lives in an app, not here

**An app owns what only it uses.** This package owns what both use.

| Thing                                                                 | Where                                                                        | Why                                                                                                                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The internal tool's shell — 288px sidebar, collapsible to a 64px rail | `apps/internal/src/components/app-shell.tsx`                                 | Only that app is shaped this way, and the sidebar is filtered by `Role`, which comes from `@sugt/domain`.                                             |
| The public site's shell — centred 1120px column                       | `apps/public/src/components/site-shell.tsx`                                  | Only that app is centred.                                                                                                                             |
| Montserrat                                                            | each app's `src/app/layout.tsx`, via `next/font`                             | `next/font` self-hosts the family and belongs to whichever app renders `<html>`. The prototype's Google Fonts `@import` is a prototype-only shortcut. |
| The `.dark` class                                                     | each app's `<html>`, set by `next-themes` from the stored theme (#123, #126) | This package ships the token block and the `dark` variant, and stops there. The class goes on the element, and the app owns the element.              |

**Each app ships its own theme toggle — a two-state Light ⇄ Dark control**
(`src/components/theme-toggle.tsx`, with the pure rotation and its `aria-label` in
`theme-cycle.ts`), added in #123 and narrowed from a three-state System→Light→Dark cycle to
two states in #126. `next-themes` sets `.dark` on `<html>` from the stored choice; there is no
"System" state and the apps do not follow the OS preference. The toggle is an app's component,
not a `@sugt/ui` primitive, for the reason in the table: this package ships the token block and
the `dark` variant and stops there, and the app owns the element the class goes on. The internal
app's desktop sidebar uses a Mode Gelap row instead (`theme-switch-row.tsx`, #358) — an app
component built on the `switch` primitive — and keeps `theme-toggle.tsx` for the phone top bar and
the collapsed rail (#359).
