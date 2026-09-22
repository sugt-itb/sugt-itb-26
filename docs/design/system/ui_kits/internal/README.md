# Internal Tool UI kit — `@sugt/internal`

Interactive recreation of the SUGT internal tool surfaces from
`sugt/docs/product.md`. **The repo app is a placeholder**, so this kit is built to
the product specification, not copied from finished screens — see the root
`readme.md` caveat.

## Surfaces (click through them via the left nav)

- **Coverage** — the landing screen. Every School with its delivered count (`n / 10`),
  grouped by Cluster. Counts only, no health colour — as the spec insists. Select
  Schools to reveal the action bar and **Buat Perjadin**, which opens the creation
  form (the arranging: one PIC + a Teaching Team member per Stream, a fixed Advance).
- **Concerns** — every Aspect Rated **7 or below**, newest first, drawn from all four
  evaluations (Class Record, Session Record, Participant Feedback, Perjadin Evaluation)
  and showing which kind each came from. A professor scoring *Pemahaman* 4 and a student
  scoring *Pengajar* 3 are not the same claim. Internal rows always carry an explanation
  — a Rating that low cannot be filed without one — and Participant rows may not, because
  they are held to no such rule.
- **Perjadin Report (acquittal)** — the load-bearing screen. Advance / used / returned
  figures, a transaction table with attached evidence and running total. Export is
  **gated until every transaction is evidenced** (deadline may pass; the document is
  never produced from an incomplete set). Click *Lampirkan* to evidence a row and watch
  the export unlock.

## Files

- `index.html` — loads the design system + Lucide, mounts `InternalTool`.
- `InternalTool.jsx` — Sidebar, Topbar, Coverage, PerjadinForm, Concerns, Acquittal.

Composes `Button`, `Card`, `Badge`, `Rating`, `Input`. Icons are Lucide via CDN (the
canonical icon set for this design system).

Coverage and Concerns data follows the real allocation in
`packages/db/seed/reference-data.sql` — four Clusters at 7 / 18 / 12 / 10 Schools, with
real names and Topics — abridged to a few Schools each. Cluster Problems are placeholders
in the seed, so none are shown here. Everything else is fabricated for demonstration.
