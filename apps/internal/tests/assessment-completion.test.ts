import {
  assessmentCompletions,
  isNotGrantedError,
  setAssessmentCompletion,
  type Person,
} from "@sugt/db/queries";
import type { Grant } from "@sugt/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { addCluster, addProvince, addSchool, resetDatabase } from "./support/fixtures";

/**
 * **Pretest/Posttest completion — the data layer** (ticket #246, ADR-0031). The open read and the
 * one Editor-guarded write behind the Dashboard (`/`) Pretest tracker.
 *
 * A completion is a bare tuple **(School × Stream × participant-type × kind)** whose *presence* means
 * "administered"; there is no `done` column. The write callers are **hand-built** `Person`s carrying
 * the Grant under test, for the reason `preparation-cards.test.ts` spells out: the write reads
 * nothing off the caller but `role` and `grants`, which is all `requireGrant` inspects, and
 * `grant-foundation.test.ts` proves resolution threads a real Person's grants onto the caller.
 */
function caller(grants: Grant[], id = "00000000-0000-0000-0000-0000000000e1"): Person {
  return { id, fullName: "Orang", email: "orang@ditsama.itb.ac.id", role: "Staff", grants };
}

const editor = () => caller(["Editor"]);

/** Build one School to hang completions off — its id is the only thing these tests need. */
async function aSchool(slug = "sekolah-satu") {
  const province = await addProvince("32", "Jawa Barat");
  const cluster = await addCluster({ slug: `${slug}-klaster`, name: "Klaster Satu" });
  const school = await addSchool({
    slug,
    name: "SMA Negeri 1",
    clusterId: cluster.id,
    provinceCode: province.code,
  });
  return school.id;
}

describe("assessmentCompletions read", () => {
  beforeEach(resetDatabase);

  it("returns no completions before any box is ticked", async () => {
    await aSchool();
    expect(await assessmentCompletions(editor())).toEqual([]);
  });

  it("returns each ticked box as its tuple, in a stable order", async () => {
    const me = editor();
    const schoolId = await aSchool();

    await setAssessmentCompletion(me, {
      schoolId,
      stream: "STEM",
      participantType: "Siswa",
      kind: "pretest",
      done: true,
    });
    await setAssessmentCompletion(me, {
      schoolId,
      stream: "Research",
      participantType: "GTK-MS",
      kind: "posttest",
      done: true,
    });

    expect(await assessmentCompletions(me)).toEqual([
      { schoolId, stream: "Research", participantType: "GTK-MS", kind: "posttest" },
      { schoolId, stream: "STEM", participantType: "Siswa", kind: "pretest" },
    ]);
  });
});

describe("setAssessmentCompletion toggles a box", () => {
  beforeEach(resetDatabase);

  const box = {
    stream: "STEM",
    participantType: "Siswa",
    kind: "pretest",
  } as const;

  it("ticking inserts the row; re-ticking is idempotent, never a duplicate", async () => {
    const me = editor();
    const schoolId = await aSchool();

    expect(await setAssessmentCompletion(me, { schoolId, ...box, done: true })).toEqual({
      outcome: "ticked",
    });
    // A stale screen re-ticks the same box: the unique constraint holds, still one row.
    expect(await setAssessmentCompletion(me, { schoolId, ...box, done: true })).toEqual({
      outcome: "ticked",
    });

    expect(await assessmentCompletions(me)).toEqual([{ schoolId, ...box }]);
  });

  it("un-ticking removes the row; re-unticking removes nothing", async () => {
    const me = editor();
    const schoolId = await aSchool();

    await setAssessmentCompletion(me, { schoolId, ...box, done: true });
    expect(await setAssessmentCompletion(me, { schoolId, ...box, done: false })).toEqual({
      outcome: "unticked",
    });
    expect(await assessmentCompletions(me)).toEqual([]);

    // Un-ticking an already-absent box is a no-op, still reported as unticked.
    expect(await setAssessmentCompletion(me, { schoolId, ...box, done: false })).toEqual({
      outcome: "unticked",
    });
    expect(await assessmentCompletions(me)).toEqual([]);
  });

  it("re-ticking after un-ticking re-creates the row", async () => {
    const me = editor();
    const schoolId = await aSchool();

    await setAssessmentCompletion(me, { schoolId, ...box, done: true });
    await setAssessmentCompletion(me, { schoolId, ...box, done: false });
    await setAssessmentCompletion(me, { schoolId, ...box, done: true });

    expect(await assessmentCompletions(me)).toEqual([{ schoolId, ...box }]);
  });

  it("keeps boxes that differ in any axis as separate rows", async () => {
    const me = editor();
    const schoolId = await aSchool();

    await setAssessmentCompletion(me, { schoolId, ...box, done: true });
    await setAssessmentCompletion(me, {
      schoolId,
      stream: "STEM",
      participantType: "GTK-MS",
      kind: "pretest",
      done: true,
    });

    expect(await assessmentCompletions(me)).toHaveLength(2);
  });
});

describe("setAssessmentCompletion is Editor-guarded", () => {
  beforeEach(resetDatabase);

  const box = {
    stream: "STEM",
    participantType: "Siswa",
    kind: "pretest",
    done: true,
  } as const;

  it("refuses a Staff Person without the Grant, with a distinguishable typed error", async () => {
    const schoolId = await aSchool();
    const refusal = await setAssessmentCompletion(caller([]), { schoolId, ...box }).catch(
      (error: unknown) => error,
    );
    expect(isNotGrantedError(refusal)).toBe(true);
  });

  it("lets an Administrator write — Administrator implies Editor", async () => {
    const schoolId = await aSchool();
    expect(
      (await setAssessmentCompletion(caller(["Administrator"]), { schoolId, ...box })).outcome,
    ).toBe("ticked");
  });

  it("refuses a Pimpinan any write, whatever grants a row might carry", async () => {
    const schoolId = await aSchool();
    const pimpinan: Person = {
      id: "00000000-0000-0000-0000-0000000000f1",
      fullName: "Bapak",
      email: "pimpinan@ditsama.itb.ac.id",
      role: "Pimpinan",
      grants: ["Editor"],
    };
    const refusal = await setAssessmentCompletion(pimpinan, { schoolId, ...box }).catch(
      (error: unknown) => error,
    );
    expect(isNotGrantedError(refusal)).toBe(true);
  });
});
