# Online Sessions track no PIC and file no Session Record

An **online Session** no longer has a **PIC**, and therefore no longer produces a **Session Record**.
The `online_pic_person_id` and `online_pic_role` columns are dropped from `session`, along with the
CHECKs and composite foreign key that governed them. The **PIC of a Session is now simply its
Perjadin's** — which only an **offline** Session has. Session Records stay exactly as they are for
offline Sessions.

## Why

Online delivery is now run by a **third-party LMS provider**, and the Zoom host is in WIB. DITSAMA no
longer staffs a PIC for an online Session, so there is no one who "organised the visit" to file a
Session Record about it, and the LMS owns whatever delivery evidence there is. The online PIC existed
([ADR-0006](./0006-sessions-are-created-when-arranged.md)-era, and carried through ADR-0022) so that
the six-in-ten online Sessions had somebody who owed the Session Record; once that record is not
expected online, the PIC has nothing left to be.

This is the companion of [ADR-0034](./0034-online-sessions-are-no-longer-single-stream.md) (online
Sessions are no longer single-Stream); together they are the **subtractive** half of the
`/sesi-daring/baru` rework (#284), following the additive #283.

## The decision

- **Drop the online PIC columns and their constraints.** `online_pic_person_id`, `online_pic_role`,
  the CHECKs `session_online_iff_pic` / `session_online_pic_role_check` / `session_pic_pair_check`, and
  the composite FK `session_online_pic_is_staff` are all removed. The offline invariant
  `session_offline_iff_perjadin` stays and is now the whole of "which Sessions have a PIC".
- **The PIC of a Session is `perjadin.pic_person_id`.** `sessionDetail` resolves it with a **left
  join** on the Perjadin's PIC (not the old `coalesce(online_pic, perjadin.pic)` inner join), so an
  online Session comes back with a **null PIC** rather than being dropped from the read — the offline
  `/sesi/[id]` surface needs the online row back so it can redirect it to `/sesi-daring/[id]`.
- **Online Sessions owe no Session Record.** `sessionDetail`'s `owed` list is populated only for a
  delivered Session that has a PIC (i.e. offline). The filing form lives on the offline `/sesi/[id]`
  route; `/sesi-daring/[id]` renders none, so no UI is lost — only the data dependency.
- **`session_record` is unchanged.** Offline Sessions still file Session Records exactly as before,
  filed by the Perjadin's Staff PIC.
- **The roster "still referenced" check drops its online-PIC clause.** `person`-in-use no longer looks
  at `session.online_pic_person_id`, which is gone.

## Consequences

- The load-bearing correctness point: before this change, dropping the online PIC column would have
  made the offline detail read's `coalesce(...)` inner join NULL for online rows and **404 every online
  Session**. Restructuring to the left join is what makes the drop safe.
- The migration is a pure drop of columns/constraints and applies cleanly against populated data.
- It is **hard to reverse**: SUGT keeps no record of its own for online delivery from here — the
  trade-off accepted because the LMS provider owns it. Reinstating an online PIC and Session Record
  would need new columns, a backfill with no correct historical value, and the coalesce read restored.
