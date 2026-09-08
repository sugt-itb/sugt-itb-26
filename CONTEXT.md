# SUGT — STEM & Research Track

Sekolah Unggul Garuda Transformasi, as delivered by DITSAMA ITB for the STEM & Research Track. Public-facing showcase of the Programme, plus internal tracking of delivery and travel administration.

## Language

Domain terms are English, because the codebase is English. Where a concept is specifically Indonesian and has no English equivalent that means the same thing, the Indonesian word is kept — see **Perjadin**. Website copy is Indonesian; that is a presentation concern and does not change the terms below.

### The programme

**SUGT**:
Sekolah Unggul Garuda Transformasi — the Programme commissioned by Kementerian Pendidikan Tinggi.
_Avoid_: "the event" (SUGT contains many events; it is not one)

**Programme**:
The whole of SUGT across all Tracks, Clusters and Schools, for its full duration.
_Avoid_: event, project, campaign

**Track**:
A subject-matter remit within the Programme, assigned to one organiser. DITSAMA ITB holds exactly one: STEM & Research.
_Avoid_: domain (reserved for web addresses), stream (a Track contains Streams), field, area

**Stream**:
One of the two subject-matter divisions inside the STEM & Research Track: **STEM** and **Research**.
_Avoid_: domain, track, subject, Riset (Indonesian for Research; the codebase is English)

**Kementerian Pendidikan Tinggi**:
The ministry that commissioned the Programme and appointed the organisers.

**DITSAMA ITB**:
Direktorat Persiapan Bersama ITB — the organiser appointed to deliver the STEM & Research Track.

### Delivery

**School**:
A participating school receiving teaching under the Programme. Around 42, and the set is fixed.

**Province**:
The Indonesian province a School sits in. Nothing is organised by Province — it is not a Cluster and does not group anything — but the number of them the Programme reaches is one of the figures the public site leads with, and it is what says which Time Zone a School keeps.
_Avoid_: region, area, location

**Time Zone**:
Which of Indonesia's three — **WIB**, **WITA** or **WIT** — a School keeps. A Province sits wholly in one, so a School's is its Province's and is never stated separately. It is what makes a Session's start time mean something: 09:00 at a Papua School is not 09:00 to the professor reading the screen in Bandung.
_Avoid_: timezone (one word), offset, UTC offset, region

**Kabupaten/Kota**:
The regency or city a School sits in, one level below the Province. Kept in Indonesian because the level covers both a _kabupaten_ and a _kota_ and no single English word means the same thing.
_Avoid_: city (a Kabupaten is not one), regency (a Kota is not one), district, municipality

**Cluster**:
A group of Schools sharing one Topic. Broadly regional, but not tightly so — one Cluster reaches from Kalimantan to Papua Barat Daya, so a Cluster is never a plausible single journey. There are four, and they are allocated and fixed.
_Avoid_: region (the Cluster is the unit; the island groups a spreadsheet may show are not a level the Programme is organised by)

**Sub-Cluster**:
A set of Schools inside one Cluster close enough to each other to be reached on **one journey**. It is the unit an offline Session's travel is planned around: a Cluster is never a plausible single journey and a Sub-Cluster is exactly one. Unlike the Cluster, it is not allocated to DITSAMA by anyone — it is DITSAMA's own judgement about what is near what, and so it is the one piece of reference data the tool lets Staff correct. The team says _Kelompok Sekolah_; "Sub-Cluster" says the same thing and says its relationship to the Cluster as it does so.
_Avoid_: Group (reserved for the travelling party — a Sub-Cluster is Schools, a Group is people), cluster (unqualified — it names the level above), region, area, zone (reserved against time)

**Topic**:
The subject matter assigned to a Cluster. Each Cluster carries a different one. Allocated, and fixed.

**Problem**:
The specific challenge a Cluster is directed to solve, drawn from its Topic. Both Streams work the same Problem from their own angle.
_Avoid_: challenge, case, brief

**Class**:
A cohort at one School receiving teaching under the Programme. Each School has three, and each is taught in both Streams.
_Avoid_: group (reserved for the travelling party), cohort, batch

**GTK Class**:
The School's teachers and education personnel — Guru dan Tenaga Kependidikan.
_Avoid_: teacher class, staff class (Staff means DITSAMA ITB employees)

**MS Class**:
The School's management — Manajemen Sekolah.
_Avoid_: leadership class, principal class

**Student Class**:
The School's participating students. One per School — the cohort is never divided by Stream; like the others, it receives both.

**Project Team**:
A small set of students within the Student Class who produce one Final Project together. Divided arbitrarily; a School may have anywhere from ten to thirty.
_Avoid_: group (reserved for the travelling party), sub-group, team, squad

**Session**:
A single teaching occasion at one School — one date, one start time, one mode. Its start time is local to the School, in the School's Time Zone, whichever mode it is and wherever the people teaching it are. Comes into existence when it is arranged, not before. The team says _Sesi_; it translates cleanly. **Both modes are now single-Stream** (see [ADR-0019](./docs/adr/0019-offline-sessions-carry-a-stream-and-a-school-gets-many-per-trip.md) and [ADR-0022](./docs/adr/0022-online-sessions-carry-a-stream-and-name-teachers-as-session-scoped-names.md)): every Session carries one **Stream** — STEM or Research. An **online** Session (a School still has six) is single-Stream like the rest, so its six are split across the two Streams rather than each teaching both; an **offline** Session, likewise single-Stream, may come several to one Perjadin, each on its own date and time, taught by a set of that Perjadin's Teaching Team in parallel. A School receives **two** offline Sessions and six online — **eight** in all ([#195](https://github.com/mafiefa02/sugt/issues/195), down from four offline). The **"Sesi 1/2/…"** a Session shows is not cosmetic and not a stored ordinal: it is the Session's **per-School, per-mode date rank** — order a School's live Sessions of one mode by `(held_on, starts_at)` and the earliest is Sesi 1 — computed on the fly, cancelled Sessions skipped, independent of any calendar window ([ADR-0027](./docs/adr/0027-a-sessions-sesi-is-its-per-school-date-rank.md)).
_Avoid_: visit, teaching, meeting, class (a Session is an occurrence; a Class is people)

### People and travel

**Person**:
A named human the Programme's records refer to. **A Person is Staff or Pimpinan** — the `Teaching Team` role was retired in T3 ([#153](https://github.com/mafiefa02/sugt/issues/153)), because the professors who teach are free-text names who never sign in (see **Teaching Team**), and for a while Staff stood alone; **Pimpinan** is the second signed-in role, read-only, added in [#179](https://github.com/mafiefa02/sugt/issues/179) (see **Pimpinan**). A Person is named before they ever sign in, because a Group can be formed around someone who has not.
_Avoid_: user (a sign-in identity, which a Person may or may not yet have), member, participant, resource

**Staff**:
A DITSAMA ITB employee working on the Programme. Leadership now have a signed-in role of their own — **Pimpinan** ([#179](https://github.com/mafiefa02/sugt/issues/179)) — rather than being folded into Staff, so "Staff" is the working delivery-and-money role, not a catch-all for everyone at DITSAMA.
The internal UI labels this role by context: **DITSAMA** on surfaces away from a **Perjadin**, and **Pendamping** on a Perjadin's own surfaces (see **Pendamping**). The domain term is still **Staff** (a presentation concern — the stored value stays `Staff`).
_Avoid_: admin, organiser (Staff is a working role; leadership are **Pimpinan** now, a separate signed-in role — #179)

**Pendamping**:
The on-**Perjadin** label for the **Staff** role — the DITSAMA people who **accompany** the Teaching Team on the journey. One role, two context-dependent labels: **Staff** reads **DITSAMA** away from a Perjadin and **Pendamping** on one (its Group list, the acquittal receipts, the "confirmed with the Pendamping" **Preparation Item**). Presentation only — the stored value stays `Staff`, and the **PIC** tag is orthogonal (a PIC is a Pendamping too, but is marked by the more specific fact). See [#141](https://github.com/mafiefa02/sugt/issues/141).
_Avoid_: companion, escort, chaperone; a second role (it is the Staff role seen from the trip)

**Teaching Team**:
The professors and instructors who deliver Sessions. They are **plain names**, not People — never invited, never signed in, carrying no Stream and no Group membership. On a **Perjadin** they are **trip-scoped**, entered on the trip, up to twenty (see [ADR-0020](./docs/adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md)), and an offline **Session** records the set of them who taught it in parallel. On an online **Session** they are **session-scoped**, entered on that one Session, up to ten (see [ADR-0022](./docs/adr/0022-online-sessions-carry-a-stream-and-name-teachers-as-session-scoped-names.md)). **The `Person` role `Teaching Team` is gone** (T3, [#153](https://github.com/mafiefa02/sugt/issues/153)): it was the one place professors were modelled as People, and once online Sessions named them as `session_teacher_name` (ADR-0022) it had no purpose, so the role and the old `session_teacher` table were both dropped. The concept persists — but only ever as these trip-scoped / session-scoped **names**.
_Avoid_: lecturers, trainers, facilitators; roster (the Perjadin list is per-trip, not maintained)

**Perjadin**:
An authorised duty travel — one Group, one date range, one Sub-Cluster — that must be accounted for administratively afterwards. The date range is the **departure→return span** — it is when the Group leaves and when it gets back, not entered independently ([ADR-0021](./docs/adr/0021-perjadin-date-range-is-departure-and-return.md)). The Sub-Cluster is what the Group goes to; the Schools it teaches at are that Sub-Cluster's, each with one or more offline **Sessions** on their own dates and times inside the range.
_Avoid_: trip, visit, travel, duty travel (a Perjadin is the authorisation and its accounting, not the journey; the English translations name something vaguer)

**Group**:
The **Staff** who travel on one Perjadin — the **PIC** plus up to ten other DITSAMA Staff, for that Perjadin alone. Groups are not standing teams and are not tied to a Cluster. **Teaching Team no longer belong to the Group** — they are trip-scoped names ([ADR-0020](./docs/adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md)), recorded on the Perjadin but not `group_member` rows — so a Group is now Staff and only Staff. **Pimpinan** who join a trip are recorded alongside it but are not working Group members. The team calls the travelling party _Kelompok Perjalanan_.
_Avoid_: team, squad, class

**Pimpinan**:
DITSAMA ITB's leadership, and — since [#179](https://github.com/mafiefa02/sugt/issues/179) — a **signed-in, read-only Person role** beside **Staff**. A Pimpinan is added open-endedly from **/orang** like any other Person, signs in through the ordinary invite gate, reads every delivery surface — and, since [#180](https://github.com/mafiefa02/sugt/issues/180)/[ADR-0026](./docs/adr/0026-money-is-open-to-read-and-staff-only-to-write.md), **all money** too (the acquittal, its export, the trip money strip, the **/monitoring** budget card) — writes nothing, and lands on **/monitoring** ([ADR-0025](./docs/adr/0025-pimpinan-is-a-second-signed-in-read-only-person-role.md)). The boundary is **read (any signed-in Person) vs write (Staff)**: they are kept out of every working position — **Group** member, **PIC**, **Session Record** filer, **Story** author — and every money **write** by the composite `(id, role)` foreign keys and `requireStaff` that still pin `Staff`, which is what makes the role read-only.
**Record-only on a trip** is the older, separate sense: a Pimpinan who joins a Perjadin's **Kelompok Perjalanan** to monitor the offline Sessions is _recorded_ on the Perjadin and named on the **Laporan Perjadin**, but is **not a working Group member** and adds nothing to the **Preparation Checklist** ([ADR-0020](./docs/adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md)). That trip record is now **chosen from the Pimpinan roster** — real `person` rows of role Pimpinan ([#181](https://github.com/mafiefa02/sugt/issues/181)): the fixed-three `PIMPINAN` constant is gone, a `perjadin_pimpinan` row references a Person via a composite `(person_id, 'Pimpinan')` foreign key, and that FK guarantees only a Pimpinan-Person can be recorded. It stays **record-only on a trip** — still not a working Group member. A Pimpinan **may also file a Perjadin Evaluation** — through an unauthenticated token link with a self-declared Role, `Pimpinan` being one of the three (ADR-0024) — but that is an untrusted self-declared string, unrelated to this Person role.
_Avoid_: leadership (that is the general sense; the Staff role no longer includes it), chairman, director

**PIC**:
The Staff member accountable for one piece of work being filed. A Perjadin has one, answerable for its administrative reporting; an online Session has one of its own, since it has no Group. The PIC files the Session Record — the account of the visit — and no Class Records, because they organised the Session rather than taught it.
_Avoid_: lead, owner, manager

**Preparation Checklist**:
A Perjadin's private, hand-ticked list of pre-departure to-dos — an internal-monitoring aid for Staff, shown only on the Perjadin's own screen. It carries no money, no deadline and no record. Every Perjadin has the **same seven fixed Preparation Items** — no per-member derivation any more — and its completion shows on the Perjadin list as a `Persiapan: x/N` count, `N = 7`.
_Avoid_: preparation status, readiness, onboarding, workflow (it tracks nothing but hand-ticked boxes and blocks nothing)

**Preparation Item**:
One line of a **Preparation Checklist**. Seven are fixed for every Perjadin — SK Perjalanan, the two tickets, lodging, local transport, a single "confirmed with the Pendamping" box, and **"Pengajar sudah lengkap"**. Only the ticked items are stored. Every box is ticked by hand; every box stays ticked until a hand un-ticks it — **except "Pengajar sudah lengkap"**, the one box the tool clears by itself whenever the Teaching Team changes (a name added, removed or renamed), so that each change forces a fresh manual confirmation that the team is complete (see the amendment to [ADR-0018](./docs/adr/0018-the-preparation-checklist-stores-ticks-and-derives-the-list.md)).
_Avoid_: task, step, todo (it is neither assigned nor sequenced)

### Reporting

**Advance**:
Money for a Perjadin, its amount fixed during trip planning and transferred to the PIC before departure, which the PIC must later account for in full.
_Avoid_: budget, allowance, float

**Treasurer**:
The Staff member who releases an Advance and receives whatever is left of it.
_Avoid_: finance, bendahara (the codebase is English)

**Perjadin Report**:
The acquittal of one Perjadin — every transaction that consumed the Advance, each evidenced, reconciled against what was left over — covering the whole Group and filed by its PIC against a deadline DITSAMA sets for itself.
_Avoid_: report (unqualified), expense report, reimbursement (nothing is claimed back; the money was transferred upfront)

**Session Record**:
What the PIC says about one Session as a whole — the visit rather than the teaching. Rates five Aspects: **Facilities**, **Turnout**, **School support**, **Timing** and **Coordination**. Filed by Staff, who organised the Session and taught none of it, so it asks nothing about how a cohort got on.
_Avoid_: report (unqualified), notes, minutes, evaluation (unqualified — it names none of the four)

**Class Record**:
What a Teaching Team member says about one **Class** they taught at one Session. Rates seven Aspects: **Comprehension**, **Participation**, **Readiness**, **Materials**, **Delivery**, **Facilities** and **Timing**, plus what was covered, what went wrong and what to do differently. **Deferred for both modes** (T3, [#153](https://github.com/mafiefa02/sugt/issues/153)): the filer was a signed-in `Teaching Team` **Person**, but that role is gone and teachers are free-text names now, on both sides, who cannot sign in and file — so nobody files one. The old "six per Session, two professors one per Stream" no longer describes anything; no Session expects any. The `class_record` table stands unused, and how name-taught teaching is evaluated is a later decision (see **Open questions**).
_Avoid_: Session Record (that is the PIC's, and covers the visit), part (the old six-part structure is gone), class evaluation

**Aspect**:
One of the named things an evaluation scores. Each of the four evaluations has its own list, because each asks a question only that filer can answer — the PIC never saw comprehension, a Participant cannot grade their own readiness, and nobody but the Group slept in the hotel.
_Avoid_: category, criterion, dimension, metric, section

**Rating**:
The score one person gives one Aspect, from 1 to 10. Ratings are the only thing in the system anything counts. An Aspect reaches the concerns list when any single Rating of it is 7 or below — one low score is enough and is never averaged away — and on a Class Record, a Session Record or a Perjadin Evaluation, a Rating that low cannot be filed without saying why. On a Perjadin Evaluation that "why" is per-Aspect: the explanation goes on that Aspect's own Komentar, not a shared box.
_Avoid_: grade, mark, health, RAG, status

**Perjadin Evaluation**:
How the trip went, as against how the teaching went: a Rating for each of **Lodging**, **Transport**, **Meals** and **Punctuality**, each carrying an optional comment, required only when that Aspect's own Rating is low (#163, ADR-0023). Filed **without signing in**, through a short-lived token link shared from the trip's page, by a filer who self-declares a Role (**Pengajar**, **Pendamping** or **Pimpinan**) and a Name — the same untrusted-identity pattern as **Participant Feedback** (ADR-0012, ADR-0024). No dedup: anyone with the link may file, as many times as they like. Any signed-in Person may issue the link — it carries no money.
_Avoid_: travel evaluation ("travel" is reserved against **Perjadin**), trip report, Perjadin Report (that is the acquittal — any signed-in Person may **read** it since #180/ADR-0026, and only **writing** it is Staff-only)

**Participant**:
Someone taught at a Session — a member of a GTK, MS or Student Class. The Programme's records never name Participants, except where one names themselves in Participant Feedback.
_Avoid_: attendee, student (only one of the three Classes is students), user, respondent

**Participant Feedback**:
What one Participant says about the Class they sat in: a Rating of **Materials**, **Instructor** and **Relevance**, an optional comment on each of the three Aspects, and a name they type themselves. Left without signing in, through a link live only briefly. Nothing asks them to rate themselves — Comprehension, Participation and Readiness are on the Class Record precisely because they are judgements about the room. Deliberately not part of any internal record; the two are filed by different people who expect different readers.
_Avoid_: review, survey, evaluation (unqualified), Class Record, Session Record

**Final Project**:
The artefact one Project Team produces against its Cluster's Problem, worked on across the closing stretch of the Programme.
_Avoid_: output, deliverable, capstone

### Publishing

**Story**:
A piece of narrative written by Staff for publication on the public site — prose and photographs about one **School**, written by someone who knows it is public as they write it. A Story is authored, never derived: no **Session Record**, **Class Record**, **Participant Feedback** or **Perjadin Report** is ever a source for one. The team says _Cerita_; it translates cleanly.
_Avoid_: post (imports blog assumptions — a feed, comments, an author byline — none of which apply), article, publication (that is the act), content, Session Record

**Field Story** / **Final Project Story**:
The two kinds a **Story** may be. A Field Story is an account of teaching at a **School**; a Final Project Story is a curated piece about what a **Project Team** produced. They differ in where the public site lists them and in nothing else — same author, same photographs, same rule that neither is derived from a record. A Final Project Story is how a **Final Project** reaches the public without becoming a tracked record.
_Avoid_: showcase (that is the section, not the piece), case study, portfolio item

## Relationships

- The **Programme** is divided into **Tracks**; DITSAMA ITB holds the STEM & Research **Track**
- The **Track** has exactly two **Streams**: STEM and Research
- The **Track** covers four **Clusters**
- A **Cluster** contains many **Schools** — between six and seventeen; a **School** belongs to exactly one **Cluster**
- A **Cluster** divides into **Sub-Clusters**; a **Sub-Cluster** sits in exactly one **Cluster** and a **School** belongs to exactly one **Sub-Cluster**, so the **Sub-Clusters** of a **Cluster** partition its **Schools** with none left over
- A **Sub-Cluster** of one **School** is legal — a School far from every other must still be reachable, and pairing it with a distant one to avoid a **Sub-Cluster** of one would be a lie about the journey
- A **School** sits in exactly one **Kabupaten/Kota**, which sits in exactly one **Province**
- A **Cluster** spans several **Provinces**, and a **Province** never spans **Clusters**
- A **Province** keeps exactly one **Time Zone**, and a **School**'s is its **Province**'s
- A **Cluster** has exactly one **Topic** and exactly one **Problem**; both **Streams** work that same **Problem**
- A **School** runs three **Classes**: **GTK**, **MS** and **Student**
- Each **Class** is taught in both **Streams** — six teaching threads per **School**
- The **Student Class** divides into ten to thirty **Project Teams**; each produces exactly one **Final Project**
- A **School** therefore ends the Programme with many **Final Projects**, not one
- A **Session** is held at exactly one **School** and carries one **Stream** — STEM or Research — whichever its mode ([ADR-0019](./docs/adr/0019-offline-sessions-carry-a-stream-and-a-school-gets-many-per-trip.md), [ADR-0022](./docs/adr/0022-online-sessions-carry-a-stream-and-name-teachers-as-session-scoped-names.md))
- A **School** receives **six online Sessions**, the same for every **School**, now single-**Stream** each rather than teaching both — a **School** may hold one STEM and one Research online **Session** on a date, but not two of the same **Stream**. It also receives **two offline Sessions** — the two Luring Sesi ([#195](https://github.com/mafiefa02/sugt/issues/195), down from four) — though a **Perjadin** may hold several at one **School** in a single trip, each single-**Stream** (capped at ten per **School** per trip as a safety ceiling, never reached in practice)
- A **Session** exists only once arranged, and is then either delivered or cancelled
- A **School**'s progress is delivered **Sessions** against that fixed number; a cancelled **Session** counts for nothing but stays visible as an attempt that failed
- A **Perjadin** carries exactly one **Group** and has exactly one **PIC**
- A **Group** exists for one **Perjadin** only — no **Cluster** has a standing team
- A **Group** contains one **PIC** and up to ten other **Staff**, and nothing else; its minimum is just the **PIC**. **Teaching Team** are trip-scoped names recorded on the **Perjadin**, not **Group** members, and **Pimpinan** who join are recorded but do not travel as working members
- **A Person is Staff or Pimpinan** — the `Teaching Team` **Person** role was retired in T3 ([#153](https://github.com/mafiefa02/sugt/issues/153)) once both modes named their teachers as plain names (dropping the old online `session_teacher` table), leaving Staff alone; **[#179](https://github.com/mafiefa02/sugt/issues/179)** then added **Pimpinan**, one signed-in read-only leadership role. **Pimpinan** who join a trip are recorded but do not travel as working members
- A **Session** records who taught it as **names**, filing nothing: an **online Session** carries session-scoped **Pengajar** names entered on it ([ADR-0022](./docs/adr/0022-online-sessions-carry-a-stream-and-name-teachers-as-session-scoped-names.md)); an **offline Session** records the set of the **Perjadin**'s trip-scoped **Teaching Team** names who taught it in parallel
- Offline **Sessions** happen during a **Perjadin**; online **Sessions** have no **Perjadin** at all
- A **Perjadin** goes to exactly one **Sub-Cluster**, and every **School** it teaches at belongs to that **Sub-Cluster**
- A **Perjadin** need not reach every **School** in its **Sub-Cluster** — the **Sub-Cluster** says which **Schools** are eligible, the plan says which are visited this time
- Each of those **Schools** gets one or more offline **Sessions**, each on its own date and start time inside the **Perjadin**'s range — the **Group** travels once and teaches on several days
- Two offline **Sessions** at **different Schools** cannot share a date _and_ a start time; the **Group** cannot be at two **Schools** at once. Two at the **same School** and the same moment are allowed — parallel **Streams** or split rooms ([ADR-0019](./docs/adr/0019-offline-sessions-carry-a-stream-and-a-school-gets-many-per-trip.md))
- Online **Sessions** are arranged one **School** at a time, because each is held at a moment of its own — there is nothing a batch of them would share
- A **Perjadin** is funded by an **Advance**, fixed when the trip is planned and transferred to the **PIC** before departure
- A **Perjadin** yields exactly one **Perjadin Report** covering the whole **Group**, filed by its **PIC**, itemising every transaction with evidence and reconciling them against the **Advance**
- Whatever is left of an **Advance** is returned to the **Treasurer**
- An offline **Session**'s **PIC** is its **Perjadin**'s; an online **Session** has a **PIC** of its own, drawn from **Staff**
- A **Session** is judged from the **PIC**'s vantage point — one **Session Record** about the visit — and from the **Participants**', who leave **Participant Feedback** on the **Class** they sat in. The third vantage point, the teacher's **Class Record**, is **deferred** (below)
- **Class Records are deferred for both modes** (T3, [#153](https://github.com/mafiefa02/sugt/issues/153)): the filer was a signed-in **Person**, and both modes now teach as names who cannot sign in and file — so nobody files one and no **Session** expects any. The old "two professors, one per **Stream**, six per online Session" no longer describes anything. How name-taught teaching is evaluated is a later decision (see Open questions)
- A **Rating** of 7 or below cannot be filed on a **Class Record** or a **Session Record** without saying what went wrong. A **Participant** owes nothing and is held to no such rule
- Nothing is required and nothing is blocked. The tool names who has not filed so they can be chased; **Participants** cannot be named, because nobody knows who was in the room
- **Participant Feedback** is never part of a **Session Record**, and neither is derived from the other
- A **Perjadin Evaluation** is filed through an unauthenticated token link shared from the **Perjadin**, by a filer who self-declares a Role (**Pengajar**, **Pendamping** or **Pimpinan**) and a Name — no sign-in, no Group-membership gate, and no limit on how many are filed (ADR-0024)
- One **Perjadin** may cover several **Schools**, so it sits behind many **Session Records**
- A **Story** is written by **Staff** about exactly one **School**, and is the only Programme narrative a public page ever carries — nothing filed after a **Session** or a trip is ever a source for one
- A **Story** may name a **Stream**, since a piece is usually about one; its **Cluster** is the **School**'s and is never stated separately
- A **Story** is never about a **Perjadin**. Public narrative and the trip that carries the money stay apart

## Example dialogue

> **Dev:** "School 17 had a **Session** last week — can I tick it off?"
> **Domain expert:** "Tick off the **Session**, yes — all three **Classes** get taught every time. But read the **Class Records**: the **Student Class** scored 4 on **Comprehension** from both professors."
> **Dev:** "Both? So there are two records for one **Class**."
> **Domain expert:** "Six for the **Session**. Two professors, three **Classes** each. If STEM says 8 and Research says 4 on the same cohort, that is the most useful thing on the screen."
> **Dev:** "And the **PIC** files one of those six?"
> **Domain expert:** "None of them. The **PIC** did not teach — they file a **Session Record**, about the visit: was the room usable, did people turn up, did the School help. Different questions, because they were standing at the back."
> **Dev:** "So which **Class** is in trouble at School 17?"
> **Domain expert:** "Now you can ask that. It is on the concerns list by **Class** and by **Aspect** — and a 4 always comes with an explanation, because nobody can file one without."
> **Dev:** "And the **Participant Feedback** goes in the same place?"
> **Domain expert:** "No. Never put those together. A **Class Record** gets written frankly because only colleagues read it."
> **Dev:** "So to know how much teaching has happened overall, I count **Perjadins**?"
> **Domain expert:** "No — count **Sessions**. Six of a School's ten are online and never had a **Perjadin** at all."

## Flagged ambiguities

- "domain" was used both for the STEM & Research **Track** and for the web address the site is served from (the public site versus the internal tool on its own subdomain) — resolved: **Track** for the former, "domain" only ever means the web address.
- "event" was used for the whole of SUGT — resolved: the whole is the **Programme**; "event" is free for individual occurrences.
- "the STEM and Research domain" (one thing) and "2 domains (STEM and Riset)" (two things) were both used — resolved: one **Track** containing two **Streams**.
- The team says "Riset", "Perjadin" and "Sesi"; the codebase is English — resolved: **Research** and **Session** translate cleanly and are used; **Perjadin**, **PIC**, **GTK** and **MS** do not and are kept.
- **Classes** were first described as two, split by **Stream** ("2 classes since we're handling 2 domains"), and later as three, split by audience (GTK, MS, students) — resolved: the division is by audience. **Stream** is subject matter that every **Class** receives, never a way of dividing cohorts.
- **Teaching Team** was open between "a fixed named body" and "whoever teaches" — resolved: a maintained roster. A **Group** names its **Teaching Team** members when the **Perjadin** is planned, before anyone has taught anything, so they have to be nameable in advance.
- "user" and **Person** were used interchangeably — resolved: a **Person** is a human the records name; a user is a sign-in identity that a **Person** may not have yet. A **Group** can contain a **Person** who has never signed in.
- A **Session Record** was once six parts split by **Class** and **Stream**, each owed by whoever taught that **Stream** — resolved: the unit is the person filing, not the teaching thread, and **Stream** does not divide it at all.
- What a **Rating** is attached to moved twice: first to each **Class**, then to each **Aspect** — resolved: **Aspects**. A score against a cohort said only _that_ a **Session** went badly; a score against an **Aspect** says _what_ did. Nothing counts **Classes** any more.
- "evaluation" was used for three different things — the internal **Session** form, the **Participant** one, and the travel one — resolved: they produce a **Session Record**, **Participant Feedback** and a **Perjadin Evaluation** respectively. Unqualified "evaluation" names none of them.
- The team says "evaluation form" for both the internal one and the **Participant** one — resolved: the internal form produces a **Session Record**; the **Participant** one produces **Participant Feedback**. "Evaluation" unqualified names neither, because the whole point is that they are different documents.
- The public narrative had three names and no term — "stories and photographs" in product.md, "published items" in ADR-0008, _Cerita_ in the design — while every internal record had a precise one. Resolved: one authored piece is a **Story**. "Publishing" remains the act, and names no document.
- The unit an offline **Session**'s travel is planned around was the **School** — a **Perjadin** was planned by picking Schools one by one and its destination was free text — while the thing actually being travelled to was a handful of Schools near each other. Resolved: the **Sub-Cluster** is that thing and is now named. A **Perjadin** goes to one, and the Schools follow from it rather than being assembled by hand each time.
- **Sub-Cluster** was very nearly called a "school group", which is unusable: **Group** is the travelling party, so "the group goes to the school group" names two different kinds of thing with one word in one sentence. _Kelompok Sekolah_ — what the team says — was the other candidate and was rejected on the rule stated at the top of this file: Indonesian is kept only where no English term means the same thing, and unlike **Perjadin** or **GTK**, this concept translates. "Sub-Cluster" also carries its relationship to the **Cluster**, which "Kelompok Sekolah" does not.
- A **Session** was a calendar day and nothing finer, on the ground that Indonesia spans three time zones and a date needs no zone to be unambiguous. Resolved: a **Session** now carries a start time as well, and the reasoning is preserved rather than overturned — the time is local to the **School**, and the **Time Zone** that makes it meaningful comes from the **Province**, which is a fact the Programme already held. What was rejected is storing a Session as an _instant_, which would have made every reader convert before they could read it.
- The source spreadsheet groups **Schools** by island (Sumatera, Jawa, Kalimantan, Sulawesi/Maluku/Papua) and separately by numbered **Cluster**, and the two do not agree — Jawa splits across two **Clusters** and Kalimantan merges with Sulawesi into one — resolved: only the **Cluster** is a level the Programme is organised by. The island grouping is a way of reading a spreadsheet and has no term here.
- **Stream** was a property of the **Teaching Team** — a professor was assigned to STEM or Research when a **Group** formed — and a **Session** taught both at once. Resolved: for **offline Sessions**, **Stream** is now a property of the **Session** itself, and one occasion is one Stream; the same people may teach a Research Session then a STEM one. Online Sessions are unchanged. See [ADR-0019](./docs/adr/0019-offline-sessions-carry-a-stream-and-a-school-gets-many-per-trip.md).
- **Teaching Team** was "a maintained roster of named People". Resolved: they are **names**, never People and never invited, because the professors who teach will not sign in — trip-scoped on a **Perjadin** ([ADR-0020](./docs/adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md)) and session-scoped on an online **Session** ([ADR-0022](./docs/adr/0022-online-sessions-carry-a-stream-and-name-teachers-as-session-scoped-names.md)). The **Person** role `Teaching Team`, which had survived only for online Sessions, was **retired in T3** ([#153](https://github.com/mafiefa02/sugt/issues/153)) — so "Teaching Team" now names one thing, a set of names, and every **Person** is **Staff**.
- A **Perjadin**'s date range was a **hand-typed pair of fields** ("Mulai"/"Selesai"), entered separately from the departure and return dates the trip also carried — two sources of truth for the same span. Resolved: the range **is** the departure→return dates now and is derived from them, never typed; correcting a leg date resizes the range (and is refused if that would strand a still-scheduled **Session**). See [ADR-0021](./docs/adr/0021-perjadin-date-range-is-departure-and-return.md).
- **Staff** vs **DITSAMA** vs **Pendamping**: previously only the **role label** rendered as "DITSAMA" (the stored value staying `Staff`, #116). Resolved ([#141](https://github.com/mafiefa02/sugt/issues/141)): the role now reads **by context** — **DITSAMA** on surfaces away from a **Perjadin**, and **Pendamping** on a Perjadin's own surfaces (its **Group** list, the acquittal receipts, the "confirmed with the Pendamping" **Preparation Item**). One role, two context-dependent labels. No user-visible "Staff"/"Staf" remains in the internal app; the **stored** value is still `Staff` and no data migrates.

## Open questions

- **What replaces Class Records for a Session whose teachers are names, not signed-in People?** Making both modes single-**Stream** with name-based teachers ([ADR-0019](./docs/adr/0019-offline-sessions-carry-a-stream-and-a-school-gets-many-per-trip.md), [ADR-0020](./docs/adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md), [ADR-0022](./docs/adr/0022-online-sessions-carry-a-stream-and-name-teachers-as-session-scoped-names.md)) leaves this **deliberately deferred** on both sides. Offline **Sessions** produce no **Class Records** (their teachers cannot sign in to file), and `delivered / 10` no longer describes a School whose offline count is variable. Online is now the same shape: a single-**Stream** online **Session**'s teachers are session-scoped names too, so the old "six Class Records per online Session, two professors one per Stream" no longer holds, and how online Class Records are counted and filed follows the same later decision. The **six online Sessions per School** and online progress (`delivered / TOTAL_SESSIONS_PER_SCHOOL`) are untouched. How name-taught delivery is evaluated and counted is a later decision, not an oversight.
- When is a **Final Project** due? Still unset.
- Each **Cluster**'s **Problem** — the specific challenge drawn from its **Topic**. The four **Topics** are set (Mitigasi Bencana, Smart City, Ketahanan Pangan, Waste Management). The **Problems** currently in the seed are **invented placeholders**, plausible for each **Cluster**'s geography but not DITSAMA's. They exist so screens have something real-shaped to render; treat any of them appearing in a design or a document as unconfirmed.
- No stages are defined between a **School**'s first and last **Session**, and **Final Projects** are not tracked at all. Progress is therefore delivered **Sessions** out of eight, and nothing else — this is the deliberate position, not an oversight.
- The ITB documents a **Perjadin Report** produces have no terms here yet. Their real names — Surat Tugas, SPPD, SPJ or otherwise — need confirming against actual paperwork before they enter the glossary or the code. **No completed example exists to confirm them against**: nobody has filed one for this Programme, and no prior trip's set is available to borrow. The first real Perjadin is what produces one, so these terms stay out of the glossary until then — see the amendment to [ADR-0007](./docs/adr/0007-the-tool-generates-the-acquittal.md).

  **What a transaction is spent on is no longer open.** The Programme's approved budget names eleven recurring line items across all twenty-three travel groups, and those are what a transaction is categorised by. They are Indonesian because they are what goes on the paperwork, and they live in `packages/domain` rather than here: a category is a value a column may hold, not a term this glossary defines. Each transaction also carries a **`participant_type`** — likewise a column value, not a glossary term — recording which cohort the spend served: **Siswa** (the Student Class) or **GTK-MS** (the GTK and MS Classes together). The document those categories will eventually be typed onto is still the open question above.

- **`/monitoring` renders illustrative mock figures, not the domain.** The overview page ships (#178) as a presentational scaffold: every number on it is invented. Its domain gaps are now **settled** ([#195](https://github.com/mafiefa02/sugt/issues/195)): a Session's Sesi is its per-School date **rank** ([ADR-0027](./docs/adr/0027-a-sessions-sesi-is-its-per-school-date-rank.md), no longer cosmetic), the programme budget is the constant `PROGRAMME_BUDGET_IDR` (`= 15,000,000,000`, there is no schema for it), and the two Luring Sesi windows are `LURING_SESI_WINDOWS`. What remains open is only the **wiring**: replacing the mock with real queries — the ranked Session numbering, the budget reconciliation, the timeline/overdue warnings against the windows, and the activity metric — deferred to [#196](https://github.com/mafiefa02/sugt/issues/196). Treat any of its rendered values as unconfirmed until then.
