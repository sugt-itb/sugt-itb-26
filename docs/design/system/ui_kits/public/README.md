# Public Site UI kit — `@sugt/public`

Recreation of the SUGT public homepage (`Beranda`) as described in
`sugt/docs/product.md`. **The repo app is a placeholder** (`page.tsx` renders a
single `<Button>Tes</Button>`), so this kit is built to the product specification
rather than copied from finished screens — see the caveat in the root `readme.md`.

## What it shows

The launch homepage, which **leads with scope, not delivery** (per the spec):

- Sticky header — SUGT wordmark, Indonesian nav, "Portal Internal" link.
- Hero — Programme framing, commissioned by Kementerian Pendidikan Tinggi.
- **Cakupan Program** — scope figures true on day one (47 Sekolah, 2 Stream, 3 Kelas, 10 Sesi).
- **Delivery strip** — accruing figures (Sesi terlaksana, Sekolah terjangkau), explicitly labelled as updating.
- Streams (STEM / Research), field stories teaser, footer.

Copy is Indonesian; imagery is placeholder ("Foto lapangan") — never invented.

## Files

- `index.html` — loads the design system + Lucide, mounts `PublicSite`.
- `PublicSite.jsx` — all sections, composing `Button`, `Card`, `Badge`.

Icons are Lucide via CDN — the canonical icon set for this design system (see root readme ICONOGRAPHY).
