# Editor splits into Perjadin, Daring and Dashboard Editor

The **Editor** Grant is gone ([#469](https://github.com/sugt-itb/sugt-itb-26/issues/469)). What it
gated is split three ways, a fourth Grant is added, and Grants no longer imply one another. Six
Grants exist:

| Grant                | Gates                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Administrator**    | Everything. It implies every other Grant, unchanged.                                                                                                                           |
| **Keuangan**         | Nothing yet. Reserved for a future `/keuangan`; it can be assigned now.                                                                                                        |
| **Perjadin Editor**  | Planning a Perjadin, and writing **every** Perjadin, not only those whose Group the Person is in (ADR-0047, ADR-0048). Pengaturan Perjadin stays Administrator-only.           |
| **Daring Editor**    | `/pretest` and its sidebar link; recording, editing and deleting online Sessions, Tandai terlaksana and Batalkan Sesi on one, and the "Sesi Daring" create buttons (ADR-0047). |
| **Dashboard Editor** | Writing the Persiapan Program tab's Preparation Cards. It **implies Dashboard Viewer**.                                                                                        |
| **Dashboard Viewer** | Reading the Dashboard `/`, unchanged (ADR-0037).                                                                                                                               |

This amends [ADR-0028](./0028-grants-are-a-second-additive-access-axis.md) (the Grant set and the
implication rule), [ADR-0037](./0037-dashboard-read-is-gated-by-a-grant.md) (who reads the
Dashboard), [ADR-0047](./0047-planning-a-perjadin-and-online-sessions-need-the-editor-grant.md)
(which Grant each write needs) and [ADR-0048](./0048-a-perjadin-is-written-by-its-group.md) (who
writes every Perjadin). Settled with the product owner when the ticket was written, on 2026-10-11.

## Why

One Editor Grant bundled three unrelated jobs: running trips, running online delivery and keeping
the Dashboard's preparation cards. Giving someone one of them gave them all three, and read access
to the Dashboard besides. The people who do each job are not the same people, so an Administrator
could not hand out the job without handing out the rest.

## The decision

- **The three Editors split Editor's reach exactly**, so nothing is newly gated and nothing newly
  opened. Keuangan is added now so a future `/keuangan` needs no Grant migration of its own.
- **A Grant no longer implies another.** The only exceptions are Administrator, which implies all of
  them, and Dashboard Editor, which implies Dashboard Viewer: whoever writes the Dashboard's cards
  reads the Dashboard. Perjadin Editor, Daring Editor and Keuangan do **not** read `/`.
- **Reading `/`** needs the Pimpinan Role, Dashboard Viewer, Dashboard Editor or Administrator. Any
  other Staff member is redirected to `/pendamping` and sees Pendamping first in the sidebar, as a
  grant-less one does (ADR-0037, #353).
- **What does not change:**
  - A Group member writes their own Perjadin with no Grant (ADR-0048).
  - Grants stay Staff-only and never reach a Pimpinan.
  - The values are stored in English, and their labels are the stored values.
- **The migration gives every Editor all three Editor Grants**, keeping when each was granted, so
  nobody gains or loses access when it deploys; an Administrator trims afterwards.

## Consequences

- **The implication rule is a table**, `GRANT_IMPLIED_BY` beside `hasGrant` in `@sugt/db`, the access rule's choke point. A
  future implication is one entry there, and a test pins every held/checked pair.
- **`canViewDashboard` is one Grant check**: Dashboard Viewer, which Dashboard Editor and
  Administrator satisfy.
- **`/orang` shows six checkboxes** until its grant dropdown lands
  ([#470](https://github.com/sugt-itb/sugt-itb-26/issues/470)).
