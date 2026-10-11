# Planning a Perjadin and recording online Sessions need the Editor Grant

**Rencanakan Perjadin** and **Catat Sesi Daring** — and editing or deleting an online Session — are no
longer open to every **Staff** member. They need the **Editor** Grant, which an **Administrator** holds
implicitly. Reading Perjadin, online Sessions and Schools stays open to everyone signed in.

Settled with the product owner on 2026-10-07
([#438](https://github.com/sugt-itb/sugt-itb-26/issues/438)).

## Why

Any Staff member could plan a trip and log online delivery, so who did either was an accident of who
happened to have the tool open. The company wants both to be a deliberate choice: a small set of people
it names, and can change from **/orang**, not every Staff member.

## The decision

Seven queries keep their `requireStaff` and add `requireGrant(caller, "Editor")` right after it:

| Write or read                  | Query                                                |
| ------------------------------ | ---------------------------------------------------- |
| Plan a Perjadin                | `planPerjadin`                                       |
| The plan form's read           | `perjadinPlan`                                       |
| Record an online Session       | `arrangeOnlineSession`                               |
| The online form's reads        | `arrangeOnlineSessionForm`, `arrangeOnlineSessionAt` |
| Edit, delete an online Session | `updateOnlineSession`, `deleteOnlineSession`         |

`requireStaff` stays **first**, so a Pimpinan is refused as non-Staff exactly as before.
`staffSurface()` already turns `NotGrantedError` into a 403, so `/perjadin/baru` and
`/sesi-daring/baru` answer 403 to a Staff member without the Grant. The controls — Rencanakan
Perjadin on `/perjadin`, Catat Sesi Daring on `/sesi-daring` and on `/sekolah/[slug]`, and the edit and
delete controls on `/sesi-daring/[id]` — are rendered only when `hasGrant(person, "Editor")`, absent
rather than disabled, the house rule for a control someone cannot use.

The form reads are gated with the writes for the reason the Staff-only reads already were: a page that
shows the whole form and refuses only on submit is worse than a 403.

**Editor already gives Dashboard read and Preparation Card writes**, so anyone allowed to plan a
Perjadin gets those too. That is intended.

## What it amends

[ADR-0028](./0028-grants-are-a-second-additive-access-axis.md) calls Grants **additive**: they "never
subtract from what the Role already allows". These writes **move from the Staff Role to the Editor
Grant**, so the Role alone no longer suffices for them; ADR-0028 carries a dated amendment pointing
here. What stays true of every Grant: it is Staff-only, it never reaches a Pimpinan, and it never lets a
Pimpinan write.

## Considered and rejected

- **A new "Perencana" Grant** for planning alone. Not chosen: the product owner chose Editor. The
  consequence, accepted, is that a planner also reads the Dashboard and edits Preparation Cards.
- **Gating only recording an online Session**, leaving edit and delete to every Staff member. Rejected:
  it would let someone who cannot record a Session rewrite or delete one.

## Consequences

- A Staff member with no Grant, or with Dashboard Viewer only, still runs any trip they are on — its
  Sessions, money, Dokumen and Persiapan — but cannot plan a new one.
- The legacy Tandai terlaksana and Batalkan Sesi on an `arranged` online Session sit in the same
  `/sesi-daring/[id]` write panel, so they are shown only to an Editor too, and their two online-only
  Server Actions check the Grant. Their queries, `markSessionDelivered` and `cancelSession`, are shared
  with offline Sessions and are not gated here: who writes an **existing** Perjadin and its Sessions is
  the companion decision, ADR-0048 ([#439](https://github.com/sugt-itb/sugt-itb-26/issues/439)), not
  this one.

## Amendment (2026-10-12): two Grants, not one

The Editor Grant split ([ADR-0052](./0052-editor-splits-into-perjadin-daring-and-dashboard-editor.md), #469). **Planning a Perjadin** needs **Perjadin Editor**; **recording,
editing and deleting an online Session**, Tandai terlaksana and Batalkan Sesi on one, and `/pretest`
need **Daring Editor**. Neither reads the Dashboard. An Administrator still does all of it.
