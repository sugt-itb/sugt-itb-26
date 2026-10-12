# The tool generates the acquittal, and has to win adoption on merit

A PIC enters a Perjadin's transactions once, in this tool, and exports a filled template of the acquittal paperwork. Nothing requires them to do this here.

## Why

The obligation is concrete regardless of what we build. The Advance is fixed at planning, transferred to the PIC before departure, the leftover is returned to the Treasurer, and every transaction that consumed it has to be evidenced. Someone assembles that record either way. The only question is where.

This decision originally rested on the tool sitting upstream of a compulsory institutional process. That argument is void: the acquittal is DITSAMA's own, on a deadline DITSAMA sets, nothing is gated, and the Treasurer accepts any format. **No structural force pushes a PIC into this tool.**

So it has to be plainly better than the alternative — receipts photographed and uploaded from a phone at the airport, running reconciliation against the Advance, one click to the finished document. That beats a spreadsheet, a calculator and a folder of WhatsApp photos. People do adopt tools that are obviously faster without being made to.

## How it wins, concretely

A transaction can be entered whenever suits the PIC — photographed and logged on the pavement as it happens, or worked through after returning. Both are first-class paths, not a primary and a fallback. What the tool adds over a spreadsheet is that evidence attaches to the line it belongs to, the running total reconciles against the Advance without anyone doing arithmetic, and nothing is retyped to produce the final document.

**Offline support is deliberately deferred.** Capture needs connectivity, and trips cross the archipelago, so there will be moments — airports, remote Schools — where logging on the spot fails. That costs convenience rather than data, precisely because post-trip entry is fully supported: a PIC who cannot upload at the gate does it that evening and loses nothing. Worth adding later; not worth blocking on now.

## Amendment: the bet is not placed until the real template exists

The document this ADR promises to fill cannot be built yet. `CONTEXT.md` and [`data-model.md`](../data-model.md) both record that the acquittal's real paperwork — Surat Tugas, SPPD, SPJ or otherwise — is unconfirmed (SPPD no longer: see [the 2026-10-08 amendment](#amendment-2026-10-08-sppd-is-uploaded-not-generated)), and it is worse than that: **no completed example exists to confirm it against.** Nobody has filed one for this Programme and no prior trip's set is available to borrow, so the first real Perjadin is what produces one.

Waiting is not the answer either. Everything else on the acquittal screen — itemised transactions, evidence attached to the line it belongs to, the running reconciliation against the Advance, the returned-to-Treasurer mark, the receipts checklist — needs nothing from the template. So the screen ships, with a **generic export**: a plain itemisation a PIC can attach, not the real form.

**The constraint on that export is that it invents nothing.** It renders only what `transaction` and `transaction_evidence` already hold, plus the derived remainder. No category, no cost-centre, no account code, no payee — nothing added to make the output look more like official paperwork. `data-model.md` warns that designing columns for a template nobody has read produces fields that do not fit it, and that warning holds; a view over existing columns cannot be wrong when the real SPJ arrives, it is simply replaced.

> **Narrowed: `transaction` does carry a category, and it is not invented.** The clause above rules out _inventing_ fields for an unread template. The Programme's approved budget turned out to name eleven line items, repeated across all twenty-three travel groups, and those are now `transaction.category` — a closed set, in Indonesian, taken from an approved document rather than guessed at. The objection is answered rather than overridden.
>
> The same evidence brought a nullable `transaction.incurred_by_person_id`: the budget carries per-diems as `2 orang × N hari`, at different rates per role. `data-model.md` had already sanctioned that column as "a nullable column, not a migration of meaning" if evidence ever appeared.
>
> **Everything else in this amendment stands.** No cost-centre, no account code, no payee, and no `Ref Standar Biaya` — which the budget does carry on most lines and which stays out until a real form asks for it. The export still renders these columns and nothing more, and is still replaced rather than corrected when a completed SPJ exists.

**What this means for reading adoption.** Until the export is real, a PIC still retypes the figures into the actual form, which is the one thing the argument above says the tool exists to prevent. So a lukewarm reception before then is not evidence the bet failed — the bet has not been placed. The fallback in [What this decision rests on](#what-this-decision-rests-on) is only reachable after a PIC has used the real generated document and still preferred a spreadsheet.

**The unblock is a filled set, not a blank one.** A blank template shows the fields; a completed one shows which are actually mandatory, what a real line item looks like, and whether the Treasurer accepts an attached itemisation or wants everything on the form. Collect that from the first Perjadin as it is filed.

## What this decision rests on

Execution quality, not structure. If the form is mediocre, PICs keep doing what they did last time, and the largest single piece of this build serves nobody.

If that happens, the fallback is to drop the money side and keep the tool as a delivery tracker. That is a coherent smaller product rather than a mutilated one: tracking needs Perjadin and Session data, but never transaction-level detail.

## Considered and rejected

**Transactions without generation.** Recording spend for visibility while producing no document. Rejected as the worst available position — it asks for all of the work and returns none of the benefit, so PICs either enter everything twice or not at all.

## Consequences

- The build is materially larger than a form: itemised transactions with evidence, reconciled against the Advance, exported as a filled template. Mobile capture matters, because receipts are photographed in transit on poor connections.
- The templates are DITSAMA's own, so they are ours to change — no external dependency, and no external authority to point at when someone wants a different one.
- Adoption reaches PICs only, and only if the bet lands. Teaching Team members have no Advance, no transactions and nothing generated for them; they open the tool solely to write Session Record parts, with no material consequence if they don't. See [ADR-0004](./0004-delivery-data-is-open-internally-money-is-not.md) and [ADR-0009](./0009-the-tool-tracks-delivery-not-outcomes.md).

## Amendment (2026-10-08): the Advance may be set after planning

"The Advance is fixed at planning" no longer holds ([#437](https://github.com/sugt-itb/sugt-itb-26/issues/437)).
A Perjadin often has to be planned before anyone knows its Uang Perjalanan, so the plan form takes it
as optional and it is filled in later; once set it can be changed but not cleared. What this ADR
rests on is unchanged: the acquittal still reconciles against the Advance, which is why filing the
Perjadin Report is the one write that waits for it.

_Overtaken by the amendment below: the Advance is no longer tracked at all, and Laporkan no longer
waits for it._

## Amendment (2026-10-12): the Advance is not tracked

The Advance is gone from the tool ([ADR-0051](./0051-the-advance-is-not-tracked.md),
[#464](https://github.com/sugt-itb/sugt-itb-26/issues/464)): how much Uang Perjalanan a trip received
is usually unknown, so nothing asks for it. The "running reconciliation against the Advance", the
derived remainder and the returned-to-Treasurer mark above no longer describe the acquittal. It is now
every transaction on the trip, each with its evidence, summed as **Uang Perjalanan Terpakai** and split
by cohort, reconciled against nothing. The bet is unchanged in kind: an itemised, evidenced record
assembled on a phone, exported in one click, beats a spreadsheet and a folder of photos.

## Amendment (2026-10-13): the Report is neither filed nor due

The acquittal is no longer filed, and no deadline is shown for it
([ADR-0055](./0055-the-perjadin-report-is-neither-filed-nor-due.md),
[#489](https://github.com/sugt-itb/sugt-itb-26/issues/489)). "On a deadline DITSAMA sets" above
described a date the tool showed and gated nothing on; it is gone, and so is Laporkan, which froze
nothing. The bet is unchanged: the acquittal is the trip's running record, and the export is taken
whenever it is needed.

## Amendment (2026-10-08): SPPD is uploaded, not generated

**SPPD** is no longer among the unconfirmed paperwork
([#441](https://github.com/sugt-itb/sugt-itb-26/issues/441)): each School's SPPD for a Perjadin is
now a kind of Perjadin Document, uploaded as one PDF beside the attendance sheets
([ADR-0042](./0042-perjadin-documents-are-stored-in-the-company-google-drive.md)). The tool stores
the signed paper; it does not fill an SPPD template, so nothing here changes what the acquittal
export renders. Surat Tugas and SPJ stay unconfirmed, and this ADR's bet still waits on them.
