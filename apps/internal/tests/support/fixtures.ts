import { randomUUID } from "node:crypto";

import { db, schema } from "@sugt/db";
import type {
  ClassKind,
  ParticipantFeedbackAspect,
  PerjadinAspect,
  PerjadinEvaluationRole,
  SessionStatus,
  Stream,
  Role,
  TimeZone,
  TransactionCategory,
  TransactionParticipantType,
} from "@sugt/domain";
import { eq, sql } from "drizzle-orm";

export type PersonFixture = {
  fullName: string;
  email: string;
  role: Role;
  active?: boolean;
};

/** Put a Person on the invite list. A row **is** the invitation. */
export async function addPerson(fixture: PersonFixture) {
  const [person] = await db
    .insert(schema.person)
    .values({
      fullName: fixture.fullName,
      email: fixture.email,
      role: fixture.role,
      active: fixture.active ?? true,
    })
    .returning();
  return person!;
}

/** Revoke a Person. One write — this is the whole revocation mechanism. */
export async function revokePerson(id: string) {
  await db.update(schema.person).set({ active: false }).where(eq(schema.person.id, id));
}

/** Every `better_auth.user` row. The invite gate's job is to leave this empty. */
export async function authUsers() {
  return db.select().from(schema.user);
}

/** Every `better_auth.session` row. */
export async function authSessions() {
  return db.select().from(schema.authSession);
}

/**
 * Reference data: a Province, then a Cluster, then Schools in it.
 *
 * **The test database has none of the real forty-two.** `migrate-from-empty.ts`
 * applies the migrations and stops; `reference-data.sql` is a separate `db:seed`
 * against `$DIRECT_URL`. That is the right split — seeding the real roster here would
 * make every count assertion depend on a file nobody edits for a test — so a test
 * that needs Schools builds the handful it is about.
 */
export async function addProvince(code: string, name: string, timeZone: TimeZone = "WIB") {
  const [province] = await db
    .insert(schema.province)
    .values({ code, name, timeZone })
    .onConflictDoNothing()
    .returning();
  return province ?? { code, name, timeZone };
}

export type SubClusterFixture = { slug: string; name: string; clusterId: string };

/** A Sub-Cluster inside one Cluster. `addPerjadin` builds a throwaway one when given none. */
export async function addSubCluster(fixture: SubClusterFixture) {
  const [subCluster] = await db
    .insert(schema.subCluster)
    .values({ slug: fixture.slug, name: fixture.name, clusterId: fixture.clusterId })
    .returning();
  return subCluster!;
}

export type ClusterFixture = { slug: string; name: string; topic?: string; problem?: string };

export async function addCluster(fixture: ClusterFixture) {
  const [cluster] = await db
    .insert(schema.cluster)
    .values({
      slug: fixture.slug,
      name: fixture.name,
      topic: fixture.topic ?? "Mitigasi Bencana",
      problem: fixture.problem ?? "Peringatan dini banjir",
    })
    .returning();
  return cluster!;
}

export type SchoolFixture = {
  slug: string;
  name: string;
  clusterId: string;
  provinceCode: string;
  kabupatenKota?: string;
  /**
   * Every School belongs to exactly one Sub-Cluster (NOT NULL). A test that asserts on the
   * link supplies one; otherwise `addSchool` builds a throwaway Sub-Cluster in the School's
   * own Cluster, so the composite `(sub_cluster_id, cluster_id)` key still holds.
   */
  subClusterId?: string;
};

export async function addSchool(fixture: SchoolFixture) {
  const subClusterId =
    fixture.subClusterId ??
    (
      await addSubCluster({
        slug: `${fixture.slug}-kelompok`,
        name: `${fixture.name} Kelompok`,
        clusterId: fixture.clusterId,
      })
    ).id;
  const [school] = await db
    .insert(schema.school)
    .values({
      slug: fixture.slug,
      name: fixture.name,
      clusterId: fixture.clusterId,
      subClusterId,
      provinceCode: fixture.provinceCode,
      kabupatenKota: fixture.kabupatenKota ?? "Kota Bandung",
    })
    .returning();
  return school!;
}

export type SessionFixture = {
  schoolId: string;
  heldOn: string;
  /** Local wall-clock start time, in the School's Time Zone. Defaults to a mid-morning hour. */
  startsAt?: string;
  /**
   * The Session's Stream — STEM or Research. An online Session is single-Stream now (ADR-0022) and
   * `session_stream_not_null` refuses a null, so this defaults to STEM to keep tests that do not
   * care about the Stream terse, and is overridable — a School may hold one STEM and one Research
   * online Session on a date, so a test wanting two on one day varies it.
   */
  stream?: Stream;
  status?: SessionStatus;
  /** A Staff Person. An online Session carries its own PIC, since it has no Perjadin. */
  onlinePicPersonId: string;
};

/**
 * An **online** Session, which is the cheap one to build: `mode = 'online'` means no
 * Perjadin, so it needs nothing but a School, a Stream and a Staff PIC. The Perjadin CHECKs are
 * exact mirrors — an offline Session has a Perjadin and an online one has none — so
 * an offline fixture would have to build a whole Perjadin first.
 *
 * A cancelled Session needs its reason in the same statement, by CHECK.
 */
export async function addSession(fixture: SessionFixture) {
  const status: SessionStatus = fixture.status ?? "arranged";
  const [session] = await db
    .insert(schema.session)
    .values({
      schoolId: fixture.schoolId,
      mode: "online",
      stream: fixture.stream ?? "STEM",
      heldOn: fixture.heldOn,
      startsAt: fixture.startsAt ?? "09:00",
      status,
      cancelledReason: status === "cancelled" ? "Sekolah meminta penjadwalan ulang" : null,
      onlinePicPersonId: fixture.onlinePicPersonId,
      onlinePicRole: "Staff",
    })
    .returning();
  return session!;
}

export type OfflineSessionFixture = {
  schoolId: string;
  heldOn: string;
  /**
   * Local wall-clock start time. Defaults to a mid-morning hour. Two offline Sessions at
   * *different* Schools on one Perjadin must differ here — the Group cannot be at two Schools at
   * once — but that rule now lives in the application (ADR-0019), not a unique index. What the DB
   * still forbids is an *exact* duplicate: same School, date, time **and** Stream.
   */
  startsAt?: string;
  /**
   * The Session's Stream — STEM or Research (ADR-0019). An offline Session must carry one
   * (`session_offline_iff_stream`); defaults to STEM so tests that do not care about the Stream
   * stay terse, and is overridable for the ones that do.
   */
  stream?: Stream;
  status?: SessionStatus;
  /** The Perjadin the Session happens on. `addPerjadin` builds one. */
  perjadinId: string;
};

/**
 * An **offline** Session, which needs a Perjadin first — the two CHECKs are exact
 * mirrors, so `mode = 'offline'` and a null `perjadin_id` cannot coexist.
 *
 * A sibling of `addSession` rather than an option on it. The two differ in every
 * column that is not the School and the date, and a fixture that took either shape
 * would spend its body deciding which one it was.
 *
 * Keep `heldOn` inside the Perjadin's date range. Nothing enforces that here — the
 * rule is the application's, and `docs/data-model.md` lists it under what the database
 * does not hold — so a fixture outside the range would model a state the app exists to
 * prevent.
 */
export async function addOfflineSession(fixture: OfflineSessionFixture) {
  const status: SessionStatus = fixture.status ?? "arranged";
  const [session] = await db
    .insert(schema.session)
    .values({
      schoolId: fixture.schoolId,
      mode: "offline",
      stream: fixture.stream ?? "STEM",
      heldOn: fixture.heldOn,
      startsAt: fixture.startsAt ?? "09:00",
      status,
      cancelledReason: status === "cancelled" ? "Sekolah meminta penjadwalan ulang" : null,
      perjadinId: fixture.perjadinId,
    })
    .returning();
  return session!;
}

/**
 * A Rating that is comfortably above `CONCERN_AT_OR_BELOW`, so a fixture reaches the
 * concerns list only where it says so. Every Rating column is NOT NULL, so each of the
 * three record fixtures below fills its whole rubric and takes overrides for the
 * Aspects a test is actually about.
 */
const FINE = 9;

/** Whether a filed record owes an explanation, which is a CHECK on two of the three tables. */
const needsProse = (ratings: number[]) => Math.min(...ratings) <= 7;

const WENT_WRONG = "Proyektor mati sepanjang sesi";

// No `addClassRecord` here any more. `class_record.filed_by_role` is pinned to `'Teaching Team'`
// by its composite foreign key into `person (id, role)`, and T3 (#153) retired that Role — no
// Person can be Teaching Team, so no Class Record can ever be filed. Class Records are deferred
// for both modes; the table survives only as the dead surface the `concerns` union still reads
// (and now finds empty). The other record fixtures below stay: their filers are Staff.

export type SessionRecordFixture = {
  sessionId: string;
  /** The PIC, who is Staff. The mirror composite foreign key refuses a professor. */
  filedByPersonId: string;
  ratings?: Partial<
    Record<"facilities" | "turnout" | "schoolSupport" | "timing" | "coordination", number>
  >;
};

/** What the PIC says about the visit as a whole. Five Aspects, none about teaching. */
export async function addSessionRecord(fixture: SessionRecordFixture) {
  const ratings = {
    facilities: FINE,
    turnout: FINE,
    schoolSupport: FINE,
    timing: FINE,
    coordination: FINE,
    ...fixture.ratings,
  };
  const [record] = await db
    .insert(schema.sessionRecord)
    .values({
      sessionId: fixture.sessionId,
      filedByPersonId: fixture.filedByPersonId,
      filedByRole: "Staff",
      ...ratings,
      problems: needsProse(Object.values(ratings)) ? WENT_WRONG : null,
    })
    .returning();
  return record!;
}

export type ParticipantFeedbackFixture = {
  sessionId: string;
  classKind: ClassKind;
  name?: string;
  /** Optional comment per Aspect, as the form is — a Participant owes no prose. Null by default. */
  comments?: Partial<Record<ParticipantFeedbackAspect, string>>;
  ratings?: Partial<Record<"materials" | "instructor" | "relevance", number>>;
  /**
   * When it was submitted. Defaults to the schema's `now()`. The Feedback list orders on this
   * and pages by it, so a test that asserts on the order supplies distinct values; existing
   * callers pass none and keep the default.
   */
  submittedAt?: Date;
};

/**
 * What one Participant says about the Class they sat in. Three Aspects, no Person and
 * **no elaboration rule** — a Participant owes nothing — which makes this the cheapest
 * way to put a low Rating on a Session.
 */
export async function addParticipantFeedback(fixture: ParticipantFeedbackFixture) {
  const [feedback] = await db
    .insert(schema.participantFeedback)
    .values({
      sessionId: fixture.sessionId,
      classKind: fixture.classKind,
      name: fixture.name ?? "Siti",
      materialsComment: fixture.comments?.materials ?? null,
      instructorComment: fixture.comments?.instructor ?? null,
      relevanceComment: fixture.comments?.relevance ?? null,
      materials: FINE,
      instructor: FINE,
      relevance: FINE,
      ...fixture.ratings,
      ...(fixture.submittedAt ? { submittedAt: fixture.submittedAt } : {}),
    })
    .returning();
  return feedback!;
}

export type PerjadinEvaluationFixture = {
  perjadinId: string;
  /**
   * The self-declared filer (ADR-0024). `filed_by_role` is one of `PERJADIN_EVALUATION_ROLES` and
   * `filed_by_name` is free text — neither references `person` any more. Both default so a test
   * that does not care about identity stays terse.
   */
  role?: PerjadinEvaluationRole;
  name?: string;
  /** The one nullable Rating — pass `null` for a day trip with no hotel. Defaults to a fine Rating. */
  lodging?: number | null;
  ratings?: Partial<Record<"transport" | "meals" | "punctuality", number>>;
  /**
   * Optional Komentar per Aspect, as the form is (#163). A low Aspect with none supplied gets
   * `WENT_WRONG` on its OWN comment so `perjadin_evaluation_low_rating_needs_prose` is satisfied —
   * so a caller passing FINE Ratings needs no comments at all.
   */
  comments?: Partial<Record<PerjadinAspect, string>>;
  /**
   * When it was filed. Defaults to the schema's `now()`. The Feedback list's Perjadin tab orders on
   * this and pages by it, so a test that asserts on the order supplies distinct values; existing
   * callers pass none and keep the default.
   */
  createdAt?: Date;
};

/** How the trip went. Four Aspects, `lodging` nullable, the elaboration rule now per-Aspect. */
export async function addPerjadinEvaluation(fixture: PerjadinEvaluationFixture) {
  const ratings = { transport: FINE, meals: FINE, punctuality: FINE, ...fixture.ratings };
  const lodging = fixture.lodging === undefined ? FINE : fixture.lodging;
  const ratingByAspect: Record<PerjadinAspect, number | null> = { lodging, ...ratings };
  // A low Aspect owes ITS OWN Komentar (#163) — fill it with WENT_WRONG unless the test supplied
  // one; a null (skipped) lodging is never low and needs none.
  const commentFor = (aspect: PerjadinAspect): string | null => {
    const supplied = fixture.comments?.[aspect];
    if (supplied !== undefined) return supplied;
    const rating = ratingByAspect[aspect];
    return rating !== null && needsProse([rating]) ? WENT_WRONG : null;
  };
  const [evaluation] = await db
    .insert(schema.perjadinEvaluation)
    .values({
      perjadinId: fixture.perjadinId,
      filedByRole: fixture.role ?? "Pendamping",
      filedByName: fixture.name ?? "Dewi Lestari",
      lodging,
      ...ratings,
      lodgingComment: commentFor("lodging"),
      transportComment: commentFor("transport"),
      mealsComment: commentFor("meals"),
      punctualityComment: commentFor("punctuality"),
      ...(fixture.createdAt ? { createdAt: fixture.createdAt } : {}),
    })
    .returning();
  return evaluation!;
}

export type PerjadinFeedbackTokenFixture = {
  perjadinId: string;
  /** Any signed-in Person issued it. `perjadin_feedback_token.issued_by_person_id` references one. */
  issuedByPersonId: string;
  /** Defaults to a fresh random token. Pass one to drive the resolver at a known value. */
  token?: string;
  /**
   * When the token was issued. Defaults to the schema's `now()`. Pass a past `Date` **with** a past
   * `expiresAt` to build an already-expired token — `perjadin_feedback_token_expiry_check` refuses
   * `expires_at <= issued_at`, so an expired token needs both in the past.
   */
  issuedAt?: Date;
  /**
   * When the token dies. Defaults to the schema's 14-days-from-now. Pass a past `Date` to build an
   * already-expired token — the resolver enforces expiry itself, so a test needs a real one.
   */
  expiresAt?: Date;
};

/**
 * One Perjadin's feedback token — the link's target (ADR-0024). The primary key is `perjadin_id`,
 * so a second one for the same trip replaces the first, which is how a reissue kills the old link.
 * The sibling of `addFeedbackToken`.
 */
export async function addPerjadinFeedbackToken(fixture: PerjadinFeedbackTokenFixture) {
  const [token] = await db
    .insert(schema.perjadinFeedbackToken)
    .values({
      perjadinId: fixture.perjadinId,
      token: fixture.token ?? randomUUID(),
      issuedByPersonId: fixture.issuedByPersonId,
      ...(fixture.issuedAt ? { issuedAt: fixture.issuedAt } : {}),
      ...(fixture.expiresAt ? { expiresAt: fixture.expiresAt } : {}),
    })
    .returning();
  return token!;
}

export type FeedbackTokenFixture = {
  sessionId: string;
  /** Any signed-in Person issued it. `session_feedback_token.issued_by_person_id` references one. */
  issuedByPersonId: string;
  /** Defaults to a fresh random token. Pass one to drive the resolver at a known value. */
  token?: string;
  /**
   * When the token was issued. Defaults to the schema's `now()`. Pass a past `Date` **with** a
   * past `expiresAt` to build an already-expired token — `session_feedback_token_expiry_check`
   * refuses `expires_at <= issued_at`, so an expired token needs both in the past.
   */
  issuedAt?: Date;
  /**
   * When the token dies. Defaults to the schema's 24-hours-from-now. Pass a past `Date` to build
   * an already-expired token — the resolver enforces expiry itself, so a test needs a real one.
   */
  expiresAt?: Date;
};

/**
 * One Session's feedback token — the QR's target. The primary key is `session_id`, so a second
 * one for the same Session replaces the first, which is how a reissue kills the old link.
 */
export async function addFeedbackToken(fixture: FeedbackTokenFixture) {
  const [token] = await db
    .insert(schema.sessionFeedbackToken)
    .values({
      sessionId: fixture.sessionId,
      token: fixture.token ?? randomUUID(),
      issuedByPersonId: fixture.issuedByPersonId,
      ...(fixture.issuedAt ? { issuedAt: fixture.issuedAt } : {}),
      ...(fixture.expiresAt ? { expiresAt: fixture.expiresAt } : {}),
    })
    .returning();
  return token!;
}

export type PerjadinFixture = {
  destination?: string;
  startsOn?: string;
  endsOn?: string;
  advanceIdr: number;
  /**
   * Where the trip goes. A Perjadin needs one, so `addPerjadin` builds a throwaway Cluster
   * and Sub-Cluster when a test does not supply this — the Schools-belong-to-the-Sub-Cluster
   * rule is the application's, not the database's, so an unrelated Sub-Cluster is a legal row.
   */
  subClusterId?: string;
  /** Staff. They are the PIC and, by the deferred foreign key, a member of their own Group. */
  picPersonId: string;
  /**
   * The Pimpinan recorded on the trip — record-only rows referencing real People of role Pimpinan
   * (#181). Pass the `person.id`s; the composite `perjadin_pimpinan_is_pimpinan` FK refuses any id
   * that is not a Pimpinan. Empty or absent by default.
   */
  pimpinan?: string[];
};

/**
 * A Perjadin and its Group, **in one transaction** — which is not a stylistic choice.
 * `perjadin_pic_is_a_group_member` is `DEFERRABLE INITIALLY DEFERRED` precisely
 * because neither row can go first: the Perjadin names its PIC, and the PIC's
 * membership row names the Perjadin. Checked at COMMIT the pair is consistent;
 * checked per statement no valid ordering exists, so two separate inserts fail.
 */
export async function addPerjadin(fixture: PerjadinFixture) {
  return db.transaction(async (tx) => {
    let subClusterId = fixture.subClusterId;
    if (!subClusterId) {
      const [cluster] = await tx
        .insert(schema.cluster)
        .values({
          slug: `cluster-${randomUUID()}`,
          name: "Cluster Perjalanan",
          topic: "Mitigasi Bencana",
          problem: "Peringatan dini banjir",
        })
        .returning();
      const [subCluster] = await tx
        .insert(schema.subCluster)
        .values({
          slug: `sub-cluster-${randomUUID()}`,
          name: "Kelompok Sekolah Bandung",
          clusterId: cluster!.id,
        })
        .returning();
      subClusterId = subCluster!.id;
    }

    const [perjadin] = await tx
      .insert(schema.perjadin)
      .values({
        subClusterId,
        destination: fixture.destination ?? "Bandung",
        startsOn: fixture.startsOn ?? "2026-09-01",
        endsOn: fixture.endsOn ?? "2026-09-03",
        advanceIdr: fixture.advanceIdr,
        picPersonId: fixture.picPersonId,
        picRole: "Staff",
      })
      .returning();

    // The Group is the PIC alone. T3 (#153) retired the Teaching Team Role and replaced
    // `group_member_stream_iff_teaching` with `group_member_stream_null` — every member is Staff
    // and no member carries a Stream — so there is no teacher row to add here. The online
    // Session's Pengajar are session-scoped free-text names on `session_teacher_name` (ADR-0022),
    // and an offline trip's teachers are trip-scoped names on `perjadin_teacher`; neither is a
    // Group member.
    await tx.insert(schema.groupMember).values({
      perjadinId: perjadin!.id,
      personId: fixture.picPersonId,
      role: "Staff",
      stream: null,
    });

    if (fixture.pimpinan && fixture.pimpinan.length > 0) {
      await tx
        .insert(schema.perjadinPimpinan)
        .values(fixture.pimpinan.map((personId) => ({ perjadinId: perjadin!.id, personId })));
    }

    return perjadin!;
  });
}

export type TransactionFixture = {
  perjadinId: string;
  amountIdr: number;
  description?: string;
  spentOn?: string;
  category?: TransactionCategory;
  /** Which cohort the spend served. Required on the column; defaults to `Siswa`, overridable. */
  participantType?: TransactionParticipantType;
  createdByPersonId: string;
};

/**
 * One line item against the Advance.
 *
 * The default category matches the default description — a taxi is
 * `Transport Lokal Dalam Provinsi` — so a test that cares about neither still reads as a
 * plausible row rather than as `Lainnya` standing in for "unset".
 */
export async function addTransaction(fixture: TransactionFixture) {
  const [transaction] = await db
    .insert(schema.transaction)
    .values({
      perjadinId: fixture.perjadinId,
      spentOn: fixture.spentOn ?? "2026-09-02",
      description: fixture.description ?? "Transport lokal",
      amountIdr: fixture.amountIdr,
      category: fixture.category ?? "Transport Lokal Dalam Provinsi",
      participantType: fixture.participantType ?? "Siswa",
      createdByPersonId: fixture.createdByPersonId,
    })
    .returning();
  return transaction!;
}

export type EvidenceFixture = {
  transactionId: string;
  uploadedByPersonId: string;
  /** Opaque by construction, so a test supplies one only when it asserts on the value. */
  storagePath?: string;
};

/**
 * One receipt against a line item.
 *
 * The bytes are not part of this: `storage_path` names an object in the private `receipts`
 * bucket and the row is the only thing the query layer reads, so a unique string is all a
 * test of the acquittal needs — the same shape `cerita.test.ts` uses for a Story photograph.
 */
export async function addTransactionEvidence(fixture: EvidenceFixture) {
  const [evidence] = await db
    .insert(schema.transactionEvidence)
    .values({
      transactionId: fixture.transactionId,
      storagePath: fixture.storagePath ?? randomUUID(),
      contentType: "image/jpeg",
      byteSize: 120_000,
      uploadedByPersonId: fixture.uploadedByPersonId,
    })
    .returning();
  return evidence!;
}

/**
 * Each test starts from a known set of rows and leaves none behind.
 *
 * The list names the tables a fixture writes directly. Several of them are already
 * reachable by `cascade` from another entry — `school` from `cluster`, `transaction`
 * from `perjadin` — and they are named anyway, because a truncate list that reads as
 * "what the tests populate" survives a fixture being deleted, while one pruned to the
 * cascade minimum quietly stops covering a table the day its parent leaves.
 *
 * Every table a fixture writes is named here. `session_feedback_token` was the last one
 * `cascade` reached without a fixture of its own; `addFeedbackToken` now writes it, so it is
 * named below like `transaction_evidence` — a fixture writes it, so the rule above names it even
 * though `cascade` from `public."session"` already reaches it. A new table that nothing
 * references and no fixture writes needs no entry; one a fixture writes does. The other three
 * evaluation tables are named below because fixtures write them directly.
 *
 * `session_teacher_name` is a table here that **no fixture writes and the tests populate
 * anyway** — `arrangeOnlineSession` and the online-detail per-item writes do, and the
 * online-detail tests assert on it, so it is named even though `cascade` from
 * `public."session"` reaches it too. (Its predecessor `session_teacher` was dropped whole in
 * T3 (#153) — the online-session Teaching Team it carried is gone — so it leaves this list with
 * the table.) `perjadin_evaluation` sits beside it for the same reason: no fixture writes one,
 * but the Perjadin Evaluation write-path tests file them directly, and `cascade` from
 * `public."perjadin"` reaches it, so naming it is for the same reason and not for a fixture.
 * `perjadin_feedback_token` is named for the fixture reason `session_feedback_token` is:
 * `addPerjadinFeedbackToken` writes it (ADR-0024), even though `cascade` from `public."perjadin"`
 * already reaches it.
 *
 * `public."session"` and `better_auth."session"` are both here and both qualified.
 * That collision is the whole reason Better Auth was given a Postgres schema of its
 * own — `session` is a teaching occasion at one School.
 */
export async function resetDatabase() {
  await db.execute(sql`
    truncate
      better_auth."user",
      better_auth."session",
      better_auth."account",
      better_auth."verification",
      public."person",
      public."province",
      public."cluster",
      public."sub_cluster",
      public."school",
      public."session",
      public."session_teacher_name",
      public."class_record",
      public."session_record",
      public."participant_feedback",
      public."session_feedback_token",
      public."perjadin_evaluation",
      public."perjadin_feedback_token",
      public."perjadin",
      public."group_member",
      public."transaction",
      public."transaction_evidence"
    restart identity cascade
  `);
}

/**
 * Which constraint refused a write, or `null` if nothing did.
 *
 * **Named rather than asserted as "it threw"**, because *some* constraint firing proves
 * nothing: the rows these tests insert satisfy several CHECKs and a composite foreign key
 * each, so a test that only knew it was rejected would pass against the wrong rule.
 *
 * **Two places to look, and both are needed.** Drizzle wraps a failed *statement*, so the
 * driver's error sits one level down under `cause`. A DEFERRED constraint fails at
 * **COMMIT** instead — which is not a statement — so that error arrives unwrapped. Reading
 * only `cause` makes a deferred refusal indistinguishable from no refusal at all, which is
 * a test that passes while proving the opposite of what it claims.
 */
export function constraintOf(error: unknown): string | null {
  const wrapped = error as { constraint_name?: string; cause?: { constraint_name?: string } };
  return wrapped.cause?.constraint_name ?? wrapped.constraint_name ?? null;
}

/** `constraintOf` against a write in flight: the name that refused it, or `null`. */
export async function refusedBy(write: Promise<unknown>): Promise<string | null> {
  return write.then(() => null, constraintOf);
}
