# Teaching Team members on a Perjadin are trip-scoped names, not People

A Perjadin's teaching team is now a list of **plain names entered on the trip**, capped at 20, not a
selection of **`person`** rows. They are not invited, hold no sign-in, carry no Stream, and are not
`group_member` rows. Each offline **Session** links to the _set_ of that Perjadin's teacher names who
taught it in parallel ([ADR-0019](./0019-offline-sessions-carry-a-stream-and-a-school-gets-many-per-trip.md)).

This is scoped to the **Perjadin/offline** teaching team. Online Sessions still name People through
`session_teacher`, and the `person` role `'Teaching Team'` is unchanged.

## Why

The professors and instructors who deliver offline Sessions are external to DITSAMA and will not sign
in to the tool. Modelling them as People — the invite list — required an email (`person.email` is
`NOT NULL`) and implied they could authenticate and file records, neither of which is true. Whoever
plans the trip just needs to write their names down, add more as they are confirmed, and record which
of them taught each parallel Session.

## Considered options

- **People with a synthesised or optional email.** Rejected: it breaks the invite-list semantics and
  the partial unique-email invariant to model humans who are, by definition, never invited.
- **Trip-scoped names (chosen).** A `perjadin_teacher` row is a name on a trip; a Session-to-teacher
  join records who taught in parallel.

## Consequences

- **A Group's minimum at planning is just the PIC.** Teaching team may be left empty on
  `/perjadin/baru` and filled in later on `/perjadin/[id]`; the old "at least one Teaching Team
  member per Stream" Group rule is gone, and with it `group_member.stream` for teachers. A Perjadin
  _should_ end with a teaching team, but nothing blocks it — completeness is tracked by the hand-ticked
  "Pengajar sudah lengkap" box ([ADR-0018](./0018-the-preparation-checklist-stores-ticks-and-derives-the-list.md)).
- **Offline Sessions cannot carry a Person-based `session_teacher` row**, and **offline Class Records
  have no filer**, because a name is not a `person`. Both fall out of scope for the offline half; see
  the open question in `CONTEXT.md`. Online Sessions keep both.
- **Editing is per-member.** Names are added, renamed and removed one at a time on `/perjadin/[id]`,
  not by wholesale Group replacement — and each such change un-ticks "Pengajar sudah lengkap".
- **`group_member` is now Staff-only**: the PIC plus up to ten other DITSAMA Staff. Teaching team
  leaves that table entirely.
