# Online sessions carry two cohort-named Pengajar and are recorded delivered

An **online Session** now carries **exactly two Pengajar as cohort-named columns** — one for the
**Siswa** cohort and one for the **GTK-MS** cohort, one free-text name each, both required — instead of
the variable-length `session_teacher_name` list [ADR-0022](./0022-online-sessions-carry-a-stream-and-name-teachers-as-session-scoped-names.md)
gave it. And it is **recorded `delivered` in one step**: `/sesi-daring/baru` logs a Session that has
already happened, rather than arranging one and marking it delivered later. The `session_teacher_name`
table and the `session.participant_type` column (with `MAX_TEACHING_TEAM_PER_ONLINE_SESSION`) are
dropped; `session` gains `pengajar_siswa_name` and `pengajar_gtk_ms_name`.

This supersedes the **online half of ADR-0022** (session-scoped teacher _names_) and the
delivery-status shape of an online Session for the purposes of [ADR-0006](./0006-sessions-are-created-when-arranged.md)
(a Session exists once arranged). The offline half of ADR-0022 — trip-scoped `session_teaching_team`
names — is untouched.

## Why

A **third-party LMS provider** runs online delivery (the same fact behind
[ADR-0034](./0034-online-sessions-are-no-longer-single-stream.md) and
[ADR-0035](./0035-online-sessions-track-no-pic-and-file-no-session-record.md)). SUGT does not schedule
an online Session and then confirm it happened — it **logs one that already did**. Keeping the
arrange→deliver two-step for a Session the tool only ever records after the fact was a ceremony with no
referent: there is no "arranged but not yet delivered" online Session in the real workflow.

The Pengajar model was likewise looser than the world it describes. An online Session teaches both
cohorts — Siswa and GTK-MS — with **one named professor each**. A variable-length name list (capped at
two by an app-layer ceiling) could express "zero names", "one name", "the same person twice", or "two
names with no cohort" — none of which is a real online Session. Two cohort-named columns say exactly
what is true, let a NOT-NULL-for-online CHECK enforce "both present", and retire both the side table
and its cap.

There is **no production data for online Sessions**, so the schema change is a clean cut rather than a
backfill.

## The decision

- **Schema.** Add `session.pengajar_siswa_name` and `session.pengajar_gtk_ms_name` (`text`, nullable at
  the column so offline rows leave them null). Add the CHECK `session_online_pengajar_not_null`:
  `mode <> 'online' or (pengajar_siswa_name is not null and pengajar_gtk_ms_name is not null)` — the
  clean implication direction, since no online data exists to violate it. **Drop**
  `session.participant_type` and `session_participant_type_check`, and **drop the
  `session_teacher_name` table** (its FK and cascade with it). The one-online-Session-per-School-per-day
  partial unique index is unchanged.
- **Domain.** `MAX_TEACHING_TEAM_PER_ONLINE_SESSION` is removed — the number is fixed by the schema now,
  not an app-layer cap. `PRETEST_PARTICIPANT_TYPES` stays (it still governs `assessment_completion`).
- **Write.** `arrangeOnlineSession` takes `{ schoolId, heldOn, startsAt, endsAt, pengajarSiswaName,
pengajarGtkMsName }`, validates both Pengajar non-empty, `endsAt > startsAt`, and `heldOn <= today`
  (**no future dates** — a recorded Session happened), and inserts **`status: 'delivered'`** in a single
  statement (no transaction — there is no side table). It is now a `recorded` / `collided` /
  `pengajar-required` / `end-time-required` / `end-before-start` / `future-date` result.
- **Edit and delete.** `updateOnlineSession` edits School, date, times and both Pengajar, offered on an
  `arranged` **or** `delivered` Session (a born-`delivered` Session is the norm, so its fields stay
  correctable); a `cancelled` legacy Session is settled and refuses. `deleteOnlineSession` **hard-
  deletes** an online row — the correction for one recorded in error, replacing cancellation for
  born-`delivered` Sessions. The per-name add/rename/remove trio is gone.
- **UI.** `/sesi-daring/baru` (and the Detail Sekolah embed) uses the searchable school combobox
  ([#317](https://github.com/sugt-itb/sugt-itb-26/issues/317)), a Tanggal capped at today, side-by-side
  Jam Mulai / Jam Selesai and Pengajar Siswa / Pengajar GTK-MS, and a **"Tandai Terlaksana"** button;
  on success it leaves the form (standalone → `/sesi-daring`, embed → refresh). No Peserta selector.
  `/sesi-daring/[id]` shows the two Pengajar, an Edit dialog over the same fields, and a Staff-only
  hard **Delete** behind a confirm dialog; Tandai terlaksana / Batalkan remain for legacy `arranged`
  Sessions only.

## Consequences

- **`markSessionDelivered` / `cancelSession` are legacy for online.** A born-`delivered` online Session
  never passes through them; they remain for offline Sessions and any online Session arranged before
  this change (of which there are none in production).
- **The future-date guard is measured in WIB**, the zone an online Session's `held_on` is a day in, so
  it does not flip early against a UTC reading.
- **It is a clean, one-pass migration** — drops and adds only — that applies from empty, which the test
  suite proves by rebuilding `TEST_DATABASE_URL` from the migrations on every run.
- **Reversing it is costly**: the `session_teacher_name` list, the `participant_type` column and the
  arrange→deliver step would all have to come back, and the two Pengajar columns collapse to a list
  with no correct historical split — but there is no online data to preserve either way.
