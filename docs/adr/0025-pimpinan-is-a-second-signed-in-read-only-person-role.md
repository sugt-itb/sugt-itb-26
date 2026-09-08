# Pimpinan is a second signed-in, read-only Person role

The Programme's leadership now sign in. `Pimpinan` is a **second Person role** beside `Staff` — a
signed-in principal who **reads every non-money delivery surface, writes nothing, and lands on
`/monitoring`**. This reverses the T3 decision that _every Person is Staff_, and adds the first
signed-in non-Staff principal the tool has had.

## What it was

T3 ([#153](https://github.com/mafiefa02/sugt/issues/153)) retired the `Teaching Team` Person role
once online Sessions named their teachers as free-text `session_teacher_name` (ADR-0022), leaving
`Staff` the only role — `person_role_check` pinned `'Staff'` alone, and
[ADR-0004](./0004-delivery-data-is-open-internally-money-is-not.md) held that _"the Programme's
leadership are senior Staff, not a separate role"_. Leadership therefore had no login of their own:
a Pimpinan was a **record-only** name on a Perjadin (a fixed set of three, ADR-0020) and, later, a
self-declared string on an unauthenticated Perjadin Evaluation (ADR-0024) — never a signed-in
principal.

## Why that was wrong

Leadership do have a reason to sign in: to **read** how delivery is going without touching it. The
overview at `/monitoring` (#178) is exactly that surface. Folding leadership into Staff would have
handed them the money and every write, which is more than the role is; keeping them out entirely
left them with no way in at all. The right shape is a signed-in role that reads the delivery half of
the tool and writes nothing.

## The decision

Add `Pimpinan` as the second value in `ROLES`, and **widen only `person_role_check`** to
`role in ('Staff', 'Pimpinan')`. The invite gate already admits any active `person` row regardless
of role, so adding the role is what gives a Pimpinan a login — no auth change (ADR-0003, ADR-0013).

The heart of the decision is a **read/write split**, and it is enforced by leaving things alone:

- **Reads delivery.** A Pimpinan reads every non-money delivery surface — the same open-to-everyone
  set ADR-0004 already grants any signed-in Person: Sessions, Session Records, Perjadin Evaluations,
  progress and the monitoring overview.
- **Writes nothing, and is kept out of every working position by the _untouched_ composite keys.**
  Every `(person_id, role) → person(id, role)` foreign key in the schema still pins `role = 'Staff'`
  — `group_member`, `perjadin.pic`, `session.online_pic`, `session_record` and `story`. Because the
  widened role can never satisfy a key that asks for `'Staff'`, a Pimpinan cannot be a Group member,
  a PIC, a Session-Record filer or a Story author. **This is the invariant: widen the CHECK, touch no
  other constraint.** `group_member_role_check` and the composite FKs stay exactly as they were, and
  that is what makes the role record-only rather than a policy anyone has to remember to apply.
- **Lands on `/monitoring`.** The Beranda's `staffDashboard` calls `requireStaff` and aggregates
  money, so a Pimpinan would 403 there; the landing page redirects a non-Staff Person to
  `/monitoring` (#178) before that read runs.

The role stays **write-once** (ADR-0013): the composite keys default to `NO ACTION on update`, so
once a Person is referenced anywhere their role is frozen, and a wrong role is corrected by
revoke-and-re-add — unchanged by this ticket.

## The money half, stated here and implemented later

ADR-0004's other clause is that **financial data is Staff-only**. The read/write split above says a
Pimpinan should be able to read money too — leadership monitoring a Programme want to see the
Advance and its acquittal — which is a **reversal of ADR-0004 for reads**. That reversal is
**decided here but not implemented here**: opening the money surfaces to Pimpinan is
[#180](https://github.com/mafiefa02/sugt/issues/180), and unifying the record-only
`perjadin_pimpinan` trip names onto Person rows is [#181](https://github.com/mafiefa02/sugt/issues/181).
This ticket delivers the role and its **delivery-read** access only; `requireStaff` still guards
every money read until #180 lands.

> **Now done.** [ADR-0026](./0026-money-is-open-to-read-and-staff-only-to-write.md) (#180) landed the
> money half: `perjadinAcquittal` lost its `requireStaff`, so a Pimpinan reads all money (the
> acquittal, its CSV export, the trip money strip and the `/monitoring` budget card), while every
> money _write_ stays Staff-only. The boundary is now read (any signed-in) vs write (Staff).

## Consequences

- The `Record<Role, string>` label maps (`ROLE_LABELS`, `PERJADIN_ROLE_LABELS`) now carry a second
  key by force of the type — a compile error otherwise — so the labels cannot drift from the role
  set. `Pimpinan` reads its own name on both surfaces; it is not a DITSAMA Pendamping.
- `/orang` offers a Staff | Pimpinan picker again, but the roster's add/revoke gating is unchanged —
  a Pimpinan manages nobody (`canWrite` stays `role === "Staff"`).
- Two signed-in roles to reason about where there was one, and a first case of `requireStaff` and the
  Beranda redirect actually refusing a real signed-in Person rather than standing as defense in depth.
- The `perjadin_pimpinan` trip record is still the fixed set of three names (the `PIMPINAN` CHECK),
  and a Perjadin Evaluation's `filed_by_role` is still a self-declared untrusted string (ADR-0024).
  Neither is this Person role; unifying the former is deferred to #181.
