# What we're building

Two applications for the STEM & Research Track of SUGT: a public site that shows the
Programme to the world, and an internal tool that tracks its delivery and travel
administration.

This document describes their **surfaces** — what exists on screen and how it behaves.
It assumes the vocabulary in [`CONTEXT.md`](../CONTEXT.md) and does not repeat it. Why
any given decision was made is in [`docs/adr/`](./adr); this file links out rather than
re-arguing.

Where something here is proposed but not yet ratified, it says so.

---

## The public site

`@sugt/public`. Audience: the ministry, participating Schools, and anyone who goes
looking for the Programme. It doubles as DITSAMA ITB's portfolio, which is the reason
it exists at all.

**At launch it leads with scope, not delivery.** Schools committed, Clusters, Topics,
provinces covered, who is involved. Those are true on day one and impressive from the
start. Delivery figures — Sessions delivered, Schools reached — appear as they accrue.
Conflating the two means publishing "0 of 42 Schools reached" at launch, which is worse
than publishing nothing.

**Scope figures are reference data.** Schools are fixed, and Clusters and Topics are
fixed now they are allocated. They change rarely enough to be seeded by migration rather
than edited — but the database is still their single source of truth, not a static file
in this repository. Two authored copies of the same 42 Schools drift silently, and this
is the portfolio site.

**Both scope and delivery figures come from an aggregates endpoint** served by the
internal app, so the public site launches after the internal app rather than before it —
see the amendments to
[ADR-0008](./adr/0008-public-narrative-is-authored-in-the-internal-app.md). The public
app holds no database credentials and no Supabase client of its own; it reads the
endpoint and caches. That is what makes
[ADR-0001](./adr/0001-public-site-reads-aggregates-only.md) and
[ADR-0002](./adr/0002-two-apps-in-a-pnpm-workspace.md) constraints rather than
conventions.

**Not everything on the scope band is a figure from the database.** Four stats lead the
page, and only the first is fetched: 42 Schools across 15 provinces. Two Streams, three
Classes per School and eight Sessions per School are `@sugt/domain` constants both apps
already hold. Serving those over the endpoint would put the same fixed set in two places,
which is the duplication the ADR-0008 amendment exists to remove — just pointing the
other way.

**The delivery band is absent until there is delivery to report.** It renders only once at
least one Session has been delivered, so launch day is scope → Streams → Clusters with no
gap, and the band appears by itself after the first trip. "0 Sesi terlaksana · 0 Sekolah
terjangkau" under a caption promising the figures will grow is the screen
[ADR-0001](./adr/0001-public-site-reads-aggregates-only.md) names as worse than publishing
nothing.

**A failed fetch never degrades to zeros.** At build time it fails the deploy; at runtime
the last good payload keeps being served. The internal app being down is invisible to
visitors, and a zero on the page is always a real zero. That holds until the next deploy and no
further — caches do not survive one — and it is a measured property of one caching model rather
than a setting, which is why it has an ADR of its own:
[ADR-0014](./adr/0014-the-public-site-uses-the-pre-cache-components-caching-model.md).

**There is a search page, and it queries nothing.** Schools, Clusters and Story titles are
already on the page in the payloads the site fetched; searching them is a filter in the browser.
Forty-two Schools and four Clusters is a browsable set, and a search box that reaches the
database would be the one hole in an app that deliberately holds no credentials. Story bodies
are not searched — that would mean shipping every Story's full text to every visitor.

**Narrative is authored for publication, never harvested.** A **Story** is written
deliberately by Staff, in the internal tool. Class Records, Session Records and Perjadin
Reports never reach a public page — not filtered, not flagged, not summarised. An internal
record is only worth keeping if its author is certain it will never be public.

Content is in Indonesian. Published material may name Schools and show students and
their work; the Programme's enrolment terms cover media consent, so nothing needs
building around permissions.

---

## The internal tool

`@sugt/internal`. Two roles, and no third: **Staff** (DITSAMA employees, leadership
included) and **Teaching Team** (the professors who deliver Sessions). Sign-in is Google,
restricted to an invite list — Staff with a DITSAMA account, Teaching Team with whatever Google
account they have, and a `person` row required either way. See
[ADR-0003](./adr/0003-google-sign-in-with-an-invite-list.md).

**Nothing is approved.** There is no approver, no queue, no submitted-and-returned state on an
Advance or an acquittal, and no lifecycle on a Perjadin beyond its dates. Whatever sign-off
DITSAMA does happens where it happens today; the tool records that an Advance exists and what it
was spent on. This is said plainly because the shape is so common that its absence reads as an
omission, and because an early design drew it in full.

Access splits along one line: **delivery data is open, money is not.** Anyone signed in
can read every Session, every Class Record and Session Record, and every progress view — with
Groups assembled per
Perjadin and no standing team per Cluster, that openness _is_ the continuity mechanism.
Perjadin Reports and their financial detail are Staff-only. Writing stays with the
record's owner throughout. Publishing to the public site is Staff-only; every Group
contains a Staff member by construction, so no trip's material is unreachable.

### Coverage view — the landing screen

Every School with its delivered count, grouped by Cluster. Answers "where are we
overall" at a glance.

It shows counts, and nothing else. No health indicator, no flagging, no colour. Nothing
is ever "overdue" either — no Session ever asserted a due date — so a School behind on
pace shows a low delivered count and noticing that is a human reading the number. See
[ADR-0006](./adr/0006-sessions-are-created-when-arranged.md).

**It is a read surface and nothing else.** It used to be where both kinds of arranging
started, by selecting Schools and acting on the selection. Neither starts here now: a trip
is planned around a **Sub-Cluster** rather than a hand-assembled set of Schools, and an
online Session is arranged one School at a time. Nothing is left for a multi-selection to
mean, so there is no selection.

What that costs is the thing the old design was proudest of — planning in front of the
delivered counts rather than from memory. It is a real loss and it is accepted: the counts
decide _which Sub-Cluster is next_, and that reading now happens before you leave this
screen instead of inside the form you launched from it.

### Concerns list

A plain list of **Aspects Rated 7 or below**, across all Schools and all trips, newest first,
each linking to what it came from — and naming the Class where the Rating had one.

**Any single low Rating surfaces an Aspect — never an average.** Nothing is required, so a
Class may carry one Rating or four; and where several people did file, a lone 2 among three 9s
is the most informative number in the set, which is exactly what an average destroys.

Because the score is against an Aspect of a named Class, the list says _which cohort_ and _what
about it_ — "SMAN 8 · Student Class · Comprehension 4" is a different instruction from "SMAN 8 ·
Facilities 3". Internal entries always carry prose, because a Rating that low cannot be filed
without an explanation; Participant entries may not, since they are held to no such rule.

It draws on four sources — Class Records, Session Records, Participant Feedback and Perjadin
Evaluations — and **shows which kind each came from**. A professor scoring Delivery 3 and a
student scoring Instructor 3 are not the same claim, and a screen that flattens them invites
the wrong response. The rubrics do not collide: Comprehension only ever comes from a professor,
Instructor only from the room, Turnout only from the PIC.

This is the only place Ratings are aggregated, and the only reason they are worth collecting
at all. Deliberately a separate screen rather than a column on the coverage view: pace and
health are different questions and get different surfaces.

Seven is a wide net — roughly the bottom two-thirds of the scale — and it is a guess. It is
also what makes prose mandatory on internal records, so it costs writing as well as screen
space, and it lives in four index predicates, so moving it is a migration. Read the first month
of this list before settling it.

### Sessions

A School receives **eight**: two offline, six online. Each teaches all three of its
Classes.

**A Session has a date and a start time, and the time is the School's.** 09:00 at a School in
Papua is not 09:00 to the professor reading the screen in Bandung, so a time is only
meaningful with its zone attached and is always shown that way — "09:00 WIT". Which zone comes
from the School's Province, since no Indonesian province straddles a boundary. Screens read
from Bandung show the WIB equivalent alongside it. This holds for online Sessions too: the
stored time is the School's, so it means one thing whichever mode a Session is.

A Session comes into existence **when it is arranged** — when a Perjadin is planned or an
online meeting scheduled — never before. The full eight are not laid out in advance with
target dates, because those dates would be invented and a schedule nobody maintains
displays confident wrong information. Progress reads "3 of 8 delivered" without any
planned rows existing.

An arranged Session is then delivered or **cancelled**. A cancelled Session persists,
flagged with a reason. It counts for nothing, but a School that was planned for and
missed looks different from one nobody has reached yet — which is the actionable
difference.

**Every Session has a PIC.** An offline Session's is its Perjadin's. An online Session has
no Perjadin, so scheduling one means naming a Staff member as its PIC — otherwise six of
every eight Sessions would have nobody to file the Session Record.

**Online Sessions are arranged one School at a time.** Each is held at a moment of its own —
its own date, its own start time, its own PIC — so there is nothing for a batch to share.
They were once scheduled across a multi-selection from the coverage view, with one date and
one PIC stamped across the rows and each editable afterwards; the shared fields were doing
no work that per-School arranging does not do more plainly, and a screen that can write
seventeen rows at once fails seventeen rows at once.

The screen stands on its own with a School picker, and the same action appears on a School's
own page, which is where you already are when you are thinking about one School. Six of every
eight Sessions are online, so this is not a secondary path.

**Marking a Session delivered is also how it records who taught.** The form asks for the
Teaching Team member on each Stream — pre-filled from the Group on an offline Session, empty on
an online one — and will not submit with a Stream unnamed. This is deliberately one act rather
than two: the list of who still owes a Class Record is computed from who taught, so a Session
marked delivered with nobody recorded owes nothing, and the chase list is silently empty. That
is the worst failure available to a tool whose only enforcement is naming who has not filed.

**Cancelling happens on the Session, and only while it is arranged.** The reason is required in
the same dialog, because it is required by the database — a Session that was delivered and then
went wrong is a correction, not a cancellation.

### Perjadin

Created inside the tool, because the Group rule is enforced at creation: **one PIC, and
at least one Teaching Team member assigned to each Stream.** Roles are exclusive, so a
valid Group is always at least three people, around four in practice. Two professors
genuinely cover all six teaching threads, because each covers their Stream across all
three Classes.

Creation is a plain validated form — pick a **Sub-Cluster**, dates and people. It is not a
planning aid: no ranking, no suggestions, no coverage data inside the form itself.

**A trip goes to one Sub-Cluster.** That is what a journey is: a set of Schools near enough
to reach on one trip. Choosing it is what decides which Schools may appear on the trip at
all, so the form no longer asks anyone to assemble that set by hand — which was the old
design asking a planner to remember geography the tool could have held.

**Its Schools default to all of the Sub-Cluster's, and any of them can be dropped.** The
Sub-Cluster says which Schools are eligible; the plan says which are visited this time. A
School sitting exams that week is a School left off the trip, not a reason to abandon it.

**Each School gets its own date and its own start time**, inside the trip's range. The Group
travels once and teaches across several days, so one date for the whole Perjadin was never
the right shape. Two Schools may share a date — morning at one, afternoon at another — but
not a date _and_ a time, because the Group cannot be in two places.

**Creating a Perjadin is what brings its Sessions into existence** — one per School kept on
the trip. This form is the arranging.

The **Advance** is fixed during trip planning and transferred to the PIC before
departure, so a Perjadin is never in an unfunded state.

Offline Sessions happen during a Perjadin. **Online Sessions have no Perjadin at all** —
which is why counting trips never tells you how much teaching has happened, and why six
of every eight Sessions are invisible to anything trip-shaped.

**A Perjadin's screen carries a Preparation Checklist** — a private, hand-ticked list of
pre-departure to-dos, shown under `Persiapan`. It is an internal-monitoring aid and nothing more:
no money, no deadline, not a record, and **nothing ever ticks a box automatically**. Every trip has
the same six fixed boxes — SK Perjalanan, the two tickets, lodging, local transport and one
"confirmed with the Staff" — plus one per Teaching Team member of the Group. Any Staff member may
tick any box; the boxes flip optimistically. On the Perjadin list each trip shows a
`Persiapan: x/N` pill that greys at zero, ambers part-way and greens when everything is done — the
one place the checklist's state leaves the trip's own screen.

### The acquittal — the most important screen

The PIC accounts for the whole Group. They enter each transaction that consumed the
Advance, attach its evidence, and export a filled template of the acquittal paperwork.
Whatever is left is returned to the Treasurer.

**Each transaction carries a category**, from a closed list of eleven plus _Lainnya_ —
_Tiket Pesawat/Kereta PP_, _Uang Harian_, _Honorarium Narasumber_, _Akomodasi_,
_Transport Bandara/Stasiun_, _Transport Lokal Dalam Provinsi_, _Konsumsi_, _Modul_, _ATK_,
_Alat dan Bahan Research Project_, _Seminar kit_. They are the line items the Programme's
approved budget repeats across every travel group, so they are what DITSAMA already itemises
rather than a scheme invented here, and they are in Indonesian because that is what goes on the
paperwork. Each transaction also carries a **participant type** — _Siswa_ or _GTK-MS_ — an axis
orthogonal to the category that records which cohort the spend served, so the acquittal can split
how much of the Advance went to the Student cohort versus the GTK and MS cohorts (#182). The
Advance is still one pot and the acquittal still reconciles the pot.

**The export is generic until the real paperwork exists.** Nobody has filed an acquittal
for this Programme yet and no prior trip's completed set is available to borrow, so the
first version exports a plain itemisation the PIC attaches rather than the real SPJ. It
**invents no fields beyond those** — no cost-centre, no account code, no payee — so it is
replaced rather than corrected when a filled example arrives. Until then a PIC still retypes the figures into
the real form, which is the one thing this screen exists to stop; see the amendment to
[ADR-0007](./adr/0007-the-tool-generates-the-acquittal.md) for why that means the bet is
not yet placed.

Transactions can be entered **as they happen or after returning** — whichever suits.
Both are first-class paths. There is no offline support; capture needs connectivity, and
where it fails the PIC enters it later, losing convenience but never data. Offline is
worth adding eventually, not worth blocking on.

**The Report is due two days after the Group gets back**, and the screen shows days
remaining. Nothing enters that date — it follows from the Perjadin's end date, so it
cannot be typed wrong and it moves by itself if the trip's dates are corrected.

**Nothing is gated.** DITSAMA sets that deadline itself, and the tool is never stricter
than the process it serves — invented friction has the same escape route as duplicated
work.

This screen is load-bearing in a way the others are not. Nothing structurally compels a
PIC to use this tool: the Treasurer accepts any format. So it has to be plainly better
than a spreadsheet, a calculator and a folder of WhatsApp photos — evidence attached to
the line it belongs to, arithmetic done for you, nothing retyped to produce the document.
See [ADR-0007](./adr/0007-the-tool-generates-the-acquittal.md), including what to do if
that bet does not land.

### Session Record — the PIC's

**The PIC files one per Session**, about the visit rather than the teaching. They organised it
and taught none of it, so they are asked only what an organiser can see from the back of the
room:

| Aspect             | What a low score means                            |
| ------------------ | ------------------------------------------------- |
| **Facilities**     | The room, equipment or — online — the connection. |
| **Turnout**        | The people expected did not come.                 |
| **School support** | The School hosted badly.                          |
| **Timing**         | The day did not run to schedule.                  |
| **Coordination**   | The logistics on the day did not work.            |

Then **Problems** and **Suggestions**. No Covered field — they taught nothing.

Coordination is the PIC rating their own planning, which people do generously. It stays because
a low one is then very informative, and nobody else was in a position to judge it.

### Class Record — the Teaching Team's

**One per Class, per professor.** Both Stream professors teach all three Classes, so a Session
expects **six**: 2 × 3. Each carries seven Ratings.

| Aspect            | What a low score means                  |
| ----------------- | --------------------------------------- |
| **Comprehension** | They did not follow it.                 |
| **Participation** | They did not take part.                 |
| **Readiness**     | They arrived unprepared.                |
| **Materials**     | The material was wrong for this cohort. |
| **Delivery**      | How it was taught did not land.         |
| **Facilities**    | The room or equipment for this Class.   |
| **Timing**        | This Class's slot did not run to plan.  |

The first three are judgements only the person at the front can make — which is exactly why the
Participant form does not ask them.

Then **Covered** (what was taught), **Problems** and **Suggestions**. With no standing team per
Cluster, Suggestions _is_ the institutional memory.

**Stream is not a field.** It follows from who filed. Two Class Records on the same Class from
different professors is not duplication — STEM saying 8 and Research saying 4 about the same
cohort is the most useful thing on the screen.

**A Rating of 7 or below cannot be filed without saying what went wrong.** Prose is otherwise
optional, so a Class that went well costs seven taps.

That is twenty-one Ratings per professor per Session. It is the largest ask in the system and
it was chosen rather than stumbled into — see
[ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md), which is where to look first
if Records stop arriving.

### Who still owes what

**Nothing is required and nothing is blocked.** No deadlines, no gating. What the tool does is
name who has not filed, so they can be chased in the group chat.

For a Session that is a simple subtraction: `session_teacher` names the two professors, the
three Class kinds are a constant, so six Class Records are expected and whatever is missing is
listed with the name of whoever owes it. The PIC's Session Record is one more row on the same
list.

**Participants cannot be listed.** Nobody knows who was in the room, so "4 of ? responded" is a
count with no denominator — which is precisely the half-figure
[ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md) warns reads as a system of
record and is not one. Their form is chased in the room, not by the tool.

### Participant feedback

Separate from every internal record, deliberately and permanently — see
[ADR-0012](./adr/0012-participants-write-through-a-short-lived-session-token.md).

At the end of a Session a link or QR code is shown, live for **24 hours**. Anyone taught there
can open it without signing in, say which Class they sat in, Rate three things, leave a comment
and type their name:

| Aspect         | What a low score means  |
| -------------- | ----------------------- |
| **Materials**  | It was not clear.       |
| **Instructor** | It was not well taught. |
| **Relevance**  | It will not help us.    |

**Nothing asks them to rate themselves.** Comprehension, Participation and Readiness sit on the
Class Record precisely because they are judgements about the room, and a room grading its own
readiness is not evidence. Materials and Instructor overlap with the Class Record on purpose —
that overlap is what lets the professor's view be set against the room's on the same cohort.

No elaboration rule applies. A Participant owes nothing and is not signed in; refusing their 3
because they did not justify it would simply lose the 3.

It is **indicative, not a census**. Nothing stops one person submitting twice or the link being
forwarded, and the names are self-reported. Anything stricter needs an attendee list, which
ADR-0009 decided against building.

Internal records are written frankly because only colleagues read them. That is why these never
share a table, a screen or a query.

### Perjadin evaluation

How the trip went, as against how the teaching went. **Only the Group that travelled can file
one**, and each of them files at most one.

Four Aspects, same 1–10 scale, same rule that 7 or below needs an explanation:
**Lodging**, **Transport**, **Meals** and **Punctuality**. Transport is the ground transport
generally rather than the shuttle specifically; Punctuality is whether the schedule held.
They are separate because they fail independently — a good car an hour late is a different
complaint from a bad car that was prompt, and one is the vendor's fault while the other is
the plan's.

Then **Problems** and **Suggestions**. There is no Covered field; nothing was taught on a
journey.

**It is not Staff-only.** A Perjadin Evaluation carries no money, so it follows the
open-delivery rule rather than the Perjadin Report's — anyone signed in can read one. Worth
saying plainly because it hangs off a Perjadin, and Teaching Team members are the ones who
slept in the hotel.

Which means **the Perjadin screens have a money-free variant**, and Teaching Team see it: the
same trip, its dates, its Group, its Schools, with the Advance, the transactions and the Report
absent rather than disabled. They need it to find the trip they are filing about, and a greyed
box saying they may not look is worse than no box.

**Lodging is the one Aspect a Group may leave blank**, because not every Perjadin involves a
night away — a School close enough for a day trip has no hotel to rate, and asking for a Rating
anyway would produce an invented one.

The form deliberately matches the Session Record's shape. Two evaluation forms that behaved
differently would be two things to learn.

### Publishing

Staff write **Stories** here — prose and photographs about **exactly one School** — and the
public app fetches the published ones through the same mechanism as
the figures. Staff-only, per
[ADR-0004](./adr/0004-delivery-data-is-open-internally-money-is-not.md); every Group
contains a Staff member by construction, so no trip's material is unreachable.

**No longer deferred.** The authoring UI was left out of the first release partly because
the public site shipped alone, and it no longer does. That deferral was re-examined rather
than inherited and dropped: the alternative is launch narrative committed to the repo and
then migrated into rows once the UI lands, so the material the portfolio leads with gets
written twice and is meanwhile the one thing on the site a Staff member cannot change.
**Nothing narrative is hand-seeded, at any point** — the same rule scope figures already
follow. See the second amendment to
[ADR-0008](./adr/0008-public-narrative-is-authored-in-the-internal-app.md).

The public site therefore launches with real Stories in the database, which makes the
launch gate Better Auth, the invite list, the `public-media` bucket, the publishing tables
and this editor — not the aggregates endpoint alone.

**A Story is about exactly one School**, carries a cover photograph and any number of
others, and may name a Stream. Its Cluster is the School's and is never chosen separately.
It is never about a Perjadin; public narrative and the trip that carries the money stay
apart.

**A Story is either field narrative or a Final Project piece**, and that is the only thing that
differs between them — same editor, same photographs, same rule that neither is derived from an
internal record. The distinction exists because the public site gives Final Projects their own
section rather than a filter on the stories feed. It is also how a Final Project reaches the
public at all: [ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md) still refuses to
track them, and a curated piece about one is not tracking.

**Prose is written in a visual editor and stored as Markdown.** Staff are describing a school
visit, not learning syntax. What the editor can produce and what the public site will render are
one list rather than two — see
[ADR-0015](./adr/0015-story-bodies-are-markdown-and-the-editor-schema-is-the-allowlist.md), which
is where that constraint is argued, because the failure it prevents is silent.

**A formatting toolbar sits above the body.** A writer who does not know `##` can still make a
subheading, and a link — which had no keyboard shortcut and no input rule — becomes reachable at
all. Seven controls: the paragraph or heading level (Judul 1 is left off, because the Story's title
is the page's one H1), bold, italic, a bullet and a numbered list, a quote, and a link. Each button
lights up to show what the caret already carries. The bar is bound to the same one list the editor
and the public renderer share, so it can never offer a format the body is not allowed to hold.

**A Story is a draft until it is published, and comes down immediately when withdrawn.**
Publishing or unpublishing tells the public site to refresh rather than waiting for its next
scheduled one — the site otherwise serves its last good copy indefinitely, which is right for
a figure and wrong for a photograph someone has asked to have removed.

### Sub-Clusters — which Schools are one journey

Staff group a Cluster's Schools into **Sub-Clusters**: sets close enough to reach on a single
trip. This is what offline planning is built on, so it is the one piece of reference data the
tool lets anyone edit — create a Sub-Cluster, rename one, move Schools between them.

**Every School is in exactly one, always.** There is no unassigned state to represent, because
an unassigned School would be a School no trip could be planned for and nothing on any screen
would say so. The initial grouping is seeded for that reason; the screen is for correcting it.

**It exists because the grouping is a guess until somebody has made the journey.** Clusters and
Topics were allocated to DITSAMA and the tool only reflects them. Nobody allocated the
Sub-Clusters — they are DITSAMA's own reading of roads, flights and distances, and the first
Perjadin is what teaches you two Schools are not as close as the map suggested. Behind a deploy,
that lesson does not get recorded. See
[ADR-0016](./adr/0016-sub-clusters-are-editable-because-nobody-allocated-them.md).

Two things the screen refuses, both saying why rather than failing quietly:

- **Deleting a Sub-Cluster that still holds Schools.** Empty it first — there is nowhere for
  the Schools to go.
- **Moving a School that a planned trip is still going to visit**, naming the Perjadins in the
  way so somebody can re-plan or cancel them. Only trips that have not happened block a move:
  Sessions already delivered record where the Programme went, and a grouping that could not be
  corrected after the first trip would be a grouping nobody could fix.

### People — the invite list

Staff add and revoke People here. This is the invite list from
[ADR-0003](./adr/0003-google-sign-in-with-an-invite-list.md): a `person` row **is** an
invitation, and nobody whose email has no row can sign in at all.

Writes are Staff-only; reads follow the open-delivery rule, since a Group is assembled
from the roster. Schools, Clusters and Topics have no admin screen because they are fixed
reference data — People are not, so they do.

**A Person's role cannot be changed once they have been used.** The database refuses it,
and correcting a wrong one means revoking that Person and adding a new one, which keeps
every historical reference truthful. The screen says so rather than offering an edit that
will be rejected.

**Revoking is one write.** `active = false` is the whole of it. The invite list on its own
gates _signup_ — it stops an email that has never signed in from creating an account — and
somebody who has already signed in holds a session it cannot see, so `active` is read on every
request as well. A revoked Person is refused the next thing they do, mid-session, and there is
no second switch to throw. Nothing here can half-succeed, so the screen never has to show a
revocation that partly landed.

The founding Staff rows are seeded, because nothing else can be: without a Person, nobody
can sign in to reach this screen. See
[ADR-0013](./adr/0013-people-are-added-in-the-tool-and-their-role-is-write-once.md).

---

## What it deliberately does not do

Absences look like oversights unless they are written down. These are decisions.

- **No stages** between a School's first and last Session. Progress is delivered
  Sessions out of eight, and nothing else.
- **No Project Teams and no Final Projects.** Several hundred exist across the Programme;
  none are tracked. They reach the public as curated Stories, never as records — a piece
  written about one is not a record of it.
- **No approvals.** No approver role, no queue, no submitted/returned/approved states, no
  Perjadin lifecycle. Nothing in this tool waits on a decision by somebody else, and the two
  roles are the only two. An early design drew the whole apparatus and it is not being built.
- **No search inside the internal tool.** Coverage groups every School by Cluster and the
  directory filters; a third way to find a School is a screen to maintain and nothing more.
- **No outcome tracking beyond the Ratings.** Every further outcome field
  competes with the six that already exist, and data that will not be entered is worse
  than data that is absent — a half-filled field looks like a system of record and is not
  one.
- **No admin screens for Schools, Clusters or Topics.** They are fixed reference data,
  seeded by migration. **This does not extend to People** — the roster grows and
  revocations happen, so there is a People screen; see
  [ADR-0013](./adr/0013-people-are-added-in-the-tool-and-their-role-is-write-once.md).
  **Nor to Sub-Clusters**, which do have one. The three nouns above were allocated to
  DITSAMA by somebody else and the tool's job is to reflect them; a Sub-Cluster is
  DITSAMA's own judgement about which Schools are one journey, and the first trip is what
  teaches you it was wrong. See
  [ADR-0016](./adr/0016-sub-clusters-are-editable-because-nobody-allocated-them.md).
- **No scheduling, no overdue, no alerts.**

The consequence, stated plainly so nobody builds against the opposite: _"has this School
had all its Sessions?"_ is answerable. _"Is this School finished?"_ is not. See
[ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md).

---

## Still undecided

- When a Final Project is due.
