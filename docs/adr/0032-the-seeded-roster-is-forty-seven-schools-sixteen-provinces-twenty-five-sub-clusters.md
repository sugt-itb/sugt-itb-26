# The seeded roster is forty-seven Schools, sixteen Provinces, twenty-five Sub-Clusters

The reference seed (`packages/db/seed/reference-data.sql`) grew from **42 Schools / 15
Provinces / 23 Sub-Clusters** to **47 / 16 / 25** to match the two source workbooks
(`Pembagian Klaster.xlsx`, `Kelompok Perjalanan.xlsx`). This records what changed and,
more importantly, what deliberately did **not**.

## What changed

- **Five new Schools**, all Taruna Nusantara campuses: Kampus Pagaralam (Mitigasi
  Bencana), Kampus Cimahi (Smart City), Kampus Malang (Ketahanan Pangan), Kampus IKN and
  Kampus Lawongan (Waste Management). The existing Magelang campus was renamed to
  "SMA Taruna Nusantara Kampus Magelang" (its slug is unchanged).
- **A sixteenth Province** — `SW`, Sulawesi Utara (WITA) — reached by Kampus Lawongan in
  Kabupaten Minahasa.
- **Twenty-five Sub-Clusters**, split **4 / 7 / 7 / 7** across the four Clusters (was
  23, split 3 / 7 / 7 / 6). This was a **full re-group**, not an append: every School's
  Sub-Cluster was re-pointed to the new `kelompok` numbering from `Kelompok
Perjalanan.xlsx`, and three existing Sub-Clusters moved up one Cluster
  (`kelompok-04`, `-11`, `-18`). Cluster sizes are now lopsided at **7 / 18 / 12 / 10**.

## What did not change: the counts stay derived, never stored

No figure on any screen is hardcoded. The public site's scope band, `/monitoring`'s
denominators, the `/pretest` grid — all read the fetched School list and compute
`schools.length` and `new Set(province_code).size` at read time. This is the same stance
[ADR-0001](./0001-public-site-reads-aggregates-only.md) and
[ADR-0031](./0031-pretest-posttest-completion-is-tracked-as-delivery-not-outcomes.md)
already take about the `X / N` denominator: a stored copy would be a second source of
truth that could drift. **The seed data is the single source; the apps count it.** That
is why growing the roster is a data edit — one SQL file plus prose — and needs no code
change: 47 / 16 / 25 surfaced the moment the seed grew.

Prose that quoted the old figures (`CONTEXT.md`, `docs/product.md`,
`docs/data-model.md`, the design handoff, and the docstrings across `@sugt/db` and both
apps) was updated to say 47 / 16 / 25. Point-in-time records were **left as written**:
the historical ADRs (0001, 0005, 0006, 0007, 0008, 0012, 0014, 0016, 0031, …),
`docs/research/**`, and the formula tests that pass an arbitrary `42`
(`deliveryDenominator(42)`, `pretestProgress([], 42)`) — those test the arithmetic, not
the roster.

## Forward-note: this supersedes ADR-0016's seeded starting state

[ADR-0016](./0016-sub-clusters-are-editable-because-nobody-allocated-them.md) explains
that Sub-Clusters are **editable** because DITSAMA — not anyone above them — invented the
groupings, and that the seed provides only their _starting state_. The re-authored seed
**supersedes that starting allocation**: the 25-way grouping from `Kelompok
Perjalanan.xlsx` is now the state a fresh database starts in. Nothing about ADR-0016's
decision changes — Sub-Clusters remain editable through the Kelompok Sekolah screen, and
re-running the seed still overwrites Staff edits back to this authored starting state, as
that ADR already notes. Only the starting allocation itself is different.

## The re-apply caveat

Because the re-group moves three Sub-Clusters to a different Cluster, a clean re-apply
assumes a **fresh (or reset) database**. On an already-seeded database the
`sub_cluster.cluster_id` UPDATE can trip the non-deferrable composite foreign key
`school (sub_cluster_id, cluster_id) → sub_cluster (id, cluster_id)` while Schools still
point at the old pairing. This matches how migrations are applied from empty; a reorder
against a populated database would need a separate deferrable-FK change and is out of
scope. The seed remains idempotent for every case except this one-time cross-Cluster move.
