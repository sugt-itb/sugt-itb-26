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

| Component      | From                  | A surface that needs it                                                                                                                              |
| -------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accordion`    | hand-written          | Monitoring — the "Peringatan yang diabaikan" list of set-aside warnings ([#178](https://github.com/mafiefa02/sugt/issues/178))                       |
| `alert`        | `shadcn add`          | Perjadin Report — the note that a transaction has no evidence                                                                                        |
| `avatar`       | `shadcn add`          | Rencanakan Perjadin — the Group's members; the sidebar's signed-in Person                                                                            |
| `badge`        | `shadcn add`          | Concerns — which of the four sources a row came from; Cerita — the Stream                                                                            |
| `breadcrumb`   | `shadcn add`          | Cerita (detail), Cluster (detail), the Class Record form's header — the handoff draws each as raw `a / span` markup rather than as a named component |
| `button`       | `shadcn add`          | everywhere; the package's first component                                                                                                            |
| `card`         | `shadcn add`          | both Dashboards' count tiles; Program's two Streams                                                                                                  |
| `checkbox`     | `shadcn add`          | Coverage — selecting Schools for a Perjadin or a batch of online Sessions                                                                            |
| `combobox`     | `shadcn add`          | Rencanakan Perjadin — the extra-Staff and "Diajar oleh" multi-selects; a Base UI combobox with chips                                                 |
| `dialog`       | `shadcn add`          | Tandai terlaksana, Batalkan Sesi                                                                                                                     |
| `empty`        | `shadcn add`          | Concerns — the empty state is a named surface, not an absence                                                                                        |
| `field`        | `shadcn add`          | the four evaluation forms — label, description and error as one unit                                                                                 |
| `input`        | `shadcn add`          | Rencanakan Perjadin, Orang's add form, Pencarian                                                                                                     |
| `input-group`  | `shadcn add`          | dependency of `combobox` — the chips/input shell it composes; kept because removing it breaks that import                                            |
| `label`        | `shadcn add`          | every form                                                                                                                                           |
| `link-button`  | hand-written          | every control that navigates but looks like a Button — see [Button vs LinkButton](#button-vs-linkbutton)                                             |
| `progress`     | `shadcn add`          | Coverage — delivered against ten; the Staff Dashboard's per-Cluster bars                                                                             |
| `rating`       | hand-written          | Concerns, Detail Sekolah, Detail Sesi — every Rating already filed                                                                                   |
| `rating-input` | hand-written          | Class Record, Session Record, Perjadin Evaluation, Participant Feedback                                                                              |
| `select`       | `shadcn add`          | Perjadin Report — Kategori, a closed twelve-value set; Direktori Sekolah's Cluster filter                                                            |
| `separator`    | dependency of `field` | not chosen — arrived with `field`, kept because removing it breaks that import                                                                       |
| `sheet`        | `shadcn add`          | the public site on a phone — the header's four sections behind a menu                                                                                |
| `skeleton`     | `shadcn add`          | the loading states of both apps                                                                                                                      |
| `table`        | `shadcn add`          | Perjadin Report's transactions, Direktori Sekolah, Orang                                                                                             |
| `tabs`         | `shadcn add`          | Concerns' source filter, Cerita's Semua / STEM / Research filter                                                                                     |
| `textarea`     | `shadcn add`          | Covered, Problems and Suggestions on three forms; the Participant's comment                                                                          |

### Deliberately absent

Absences look like oversights unless they are written down.

| Not added                                                                  | Why                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@shadcn/sidebar`                                                          | It is a collapsible provider block at `--sidebar-width: 16rem` (256px). The internal tool's sidebar is fixed, does not collapse, and is 240px. It is hand-written in the app against the `--sidebar-*` tokens this package already declares.                                                                                  |
| `command`, `popover`                                                       | `combobox` is now added (Rencanakan Perjadin's multi-selects, [#137](https://github.com/mafiefa02/sugt/issues/137)) — but the Base UI combobox is self-contained (its own popup and filtering), so neither `command` (a `cmdk` palette) nor a standalone `popover` was needed with it. No surface asks for either on its own. |
| `calendar`                                                                 | The same form takes two dates, and the handoff draws `<input type="date">`.                                                                                                                                                                                                                                                   |
| `toast`, `sonner`                                                          | Nothing in the thirty surfaces reports a result that way. The Class Record form shows "Menyimpan otomatis · terakhir 10:42" instead.                                                                                                                                                                                          |
| `tooltip`, `dropdown-menu`, `pagination`, `scroll-area`, `navigation-menu` | No surface asks for one. The public header is four links; forty-two Schools do not paginate.                                                                                                                                                                                                                                  |
| `chart`                                                                    | The two bar-shaped things in the design are progress against a fixed denominator, which `progress` is. There is no chart in the first iteration.                                                                                                                                                                              |
| `radio-group`                                                              | `rating-input` uses native radios, so it needs no styled one, and no other surface has a radio.                                                                                                                                                                                                                               |
| `switch`                                                                   | Orang shows three states with _"revoked behind a toggle"_ ([#9](https://github.com/mafiefa02/sugt/issues/9)). Whether that toggle is a Switch, a Checkbox or a filter on `tabs` is [issue #35](https://github.com/mafiefa02/sugt/issues/35)'s to settle, and all three already exist here or cost nothing.                    |
| a file input                                                               | Perjadin Report attaches evidence through a signed upload URL. The registry has no upload primitive to add, so the control is hand-written by [issue #30](https://github.com/mafiefa02/sugt/issues/30) against the shape that endpoint needs.                                                                                 |
| `carousel`                                                                 | Cerita (detail) carries a gallery whose first photo is the cover. Whether that reads as a carousel or a grid is [issue #38](https://github.com/mafiefa02/sugt/issues/38)'s, and a grid needs no component.                                                                                                                    |

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

It is built on native radios, so it needs no state of its own, arrow keys work, and a
`<form>` posts the value without JavaScript. Pass `value` and `onValueChange` to drive
it from a form library instead.

## What lives in an app, not here

**An app owns what only it uses.** This package owns what both use.

| Thing                                           | Where                                                                        | Why                                                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The internal tool's shell — fixed 240px sidebar | `apps/internal/src/components/app-shell.tsx`                                 | Only that app is shaped this way, and the sidebar is filtered by `Role`, which comes from `@sugt/domain`.                                             |
| The public site's shell — centred 1120px column | `apps/public/src/components/site-shell.tsx`                                  | Only that app is centred.                                                                                                                             |
| Montserrat                                      | each app's `src/app/layout.tsx`, via `next/font`                             | `next/font` self-hosts the family and belongs to whichever app renders `<html>`. The prototype's Google Fonts `@import` is a prototype-only shortcut. |
| The `.dark` class                               | each app's `<html>`, set by `next-themes` from the stored theme (#123, #126) | This package ships the token block and the `dark` variant, and stops there. The class goes on the element, and the app owns the element.              |

**Each app ships its own theme toggle — a two-state Light ⇄ Dark control**
(`src/components/theme-toggle.tsx`, with the pure rotation and its `aria-label` in
`theme-cycle.ts`), added in #123 and narrowed from a three-state System→Light→Dark cycle to
two states in #126. `next-themes` sets `.dark` on `<html>` from the stored choice; there is no
"System" state and the apps do not follow the OS preference. The toggle is an app's component,
not a `@sugt/ui` primitive, for the reason in the table: this package ships the token block and
the `dark` variant and stops there, and the app owns the element the class goes on.
