# Delivery data is open to everyone signed in; financial data is not

Inside the internal tool, anyone authenticated can read every Session, every internal record of one, and every progress view. Perjadin Reports and their financial detail are visible to Staff only. Write access in both cases stays with the record's owner.

There are two roles, Staff and Teaching Team. The Programme's leadership are senior Staff, not a separate role.

> **The money-read half is REVERSED by [ADR-0026](./0026-money-is-open-to-read-and-staff-only-to-write.md) (#180).** Two things this ADR wrote no longer hold. First, leadership _are_ a separate signed-in role now — `Pimpinan`, added by [ADR-0025](./0025-pimpinan-is-a-second-signed-in-read-only-person-role.md) (#179). Second, "Perjadin Reports and their financial detail are visible to Staff only" is retired: money is now open to **any signed-in Person** to read, so a Pimpinan reads the acquittal, its export and the budget. The boundary this ADR drew as delivery-vs-money is redrawn as **read (any signed-in) vs write (Staff)**. Writing money stays Staff-only, exactly as before. Everything below about _writing_, publishing and delivery-arranging is untouched.

## Why

Groups are assembled per Perjadin and no Cluster has a standing team, so the tool is the only thing carrying knowledge of a School between visits. A professor travelling to a Cluster for the first time has to be able to read what the previous group wrote about those Schools. Restricting Session Records to their authors would remove the continuity mechanism the travel model depends on.

Perjadin Reports carry per-diem amounts and personal travel claims. No delivery purpose is served by a colleague reading them, so they stay with Staff and leadership.

## Publishing

Only Staff may publish content to the public site (see [ADR-0008](./0008-public-narrative-is-authored-in-the-internal-app.md)). Every Group contains a Staff member by construction, since a Perjadin requires a PIC, so no trip's material is out of reach. Teaching Team members write internal records and nothing public.

> **Amended for the rename.** "Session Record" meant every internal account of a Session when this was written; it now means the PIC's account of the visit specifically, and the teaching account is a **Class Record**. Read the rule above as covering both — plus **Perjadin Evaluations**, which are also open to everyone signed in, because they carry no money.
>
> One sentence inverted and has been corrected rather than left standing: it read _"Teaching Team members write Session Records"_, which is now precisely backwards. Teaching Team file **Class Records**; the **PIC** files the Session Record. Both facts are enforced by composite foreign keys into `person (id, role)`, so neither is a convention.
>
> The stated reason for hiding money also got thinner: transactions are not attributed to a person, so per-diems appear as unattributed lines. The rule stands; its justification is weaker than when it was written.

> **That last sentence is no longer true, and the justification is back.** `transaction` now carries a nullable `incurred_by_person_id`, added with the acquittal because the Programme's approved budget carries per-diems as `2 orang × N hari` at different rates per role — see [#21](https://github.com/mafiefa02/sugt/issues/21). So a Perjadin Report does again show what a named colleague was paid, which is the thing this ADR gave as its reason for hiding one.
>
> **The decision itself is untouched**, and was never resting on that sentence: the Advance is one pot and the acquittal reconciles the pot, so attribution is a fact about some line items rather than a change to what a Report is. What changed is only that the reason reads as strongly now as it did when it was written.

## Consequences

- Session Record authors write knowing colleagues will read them. That is intended — it is what makes them institutional memory — and is a different thing from publication, which [ADR-0001](./0001-public-site-reads-aggregates-only.md) rules out.
- Two access rules to maintain rather than one.
