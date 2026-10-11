import { SchoolBookedElsewhere } from "-/components/school-booked-elsewhere";
import { db, schema } from "@sugt/db";
import {
  addPerjadinSession,
  cancelSession,
  editPerjadinSession,
  moveSessionDate,
  planPerjadin,
  type PlanPerjadinInput,
} from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSubCluster,
  asEditor,
  refusedBy,
  resetDatabase,
} from "./support/fixtures";

/**
 * **No double-booking across Perjadins** (#408, ADR-0043): one live offline Session per School per
 * date and start time, whichever trips carry them. `session_no_duplicate_offline_per_school` holds it
 * at the database; planning, adding, editing and moving a Session check it first, so the refusal
 * names the other trip. Against the real database.
 *
 * The writes' read, `bookedOnAnotherPerjadin`, is wrapped so a test can see which path refused:
 * the read itself (`refusedByRead`), or the index after the read was made to miss
 * (`missedReads`) — the check-then-insert race the index exists to close.
 *
 * Mocked by its path, not through `@sugt/db/queries`: the writes import it from inside the package
 * (`./school-slot`), which is the module a mock must replace to reach them, and the package exports
 * only its refusal type. The index's own re-read, inside the same module, is never wrapped.
 */

const race = vi.hoisted(() => ({ missedReads: 0, refusedByRead: 0 }));

vi.mock("../../../packages/db/src/queries/school-slot", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../../../packages/db/src/queries/school-slot")>();
  return {
    ...real,
    bookedOnAnotherPerjadin: async (...args: Parameters<typeof real.bookedOnAnotherPerjadin>) => {
      if (race.missedReads > 0) {
        race.missedReads -= 1;
        return null;
      }
      const refusal = await real.bookedOnAnotherPerjadin(...args);
      if (refusal) race.refusedByRead += 1;
      return refusal;
    },
  };
});

/**
 * Kelompok 10, with SMAN 1 Bontang and SMAN 2 Samarinda in Kalimantan Timur (WITA), and two trips
 * covering it: A from the 12th to the 13th, already holding Bontang on the 12th at 08:00, and B from
 * the 12th to the 14th, empty.
 */
async function scene() {
  // An Editor: planning needs the Grant (ADR-0047).
  const pic = await asEditor(
    await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" }),
  );
  await addProvince("KT", "Kalimantan Timur", "WITA");
  const cluster = await addCluster({ slug: "kaltim", name: "Cluster Kaltim" });
  const subCluster = await addSubCluster({
    slug: "kelompok-10",
    name: "Kelompok 10",
    clusterId: cluster.id,
  });
  const [bontang, samarinda] = await Promise.all(
    [
      ["sman-1-bontang", "SMAN 1 Bontang"],
      ["sman-2-samarinda", "SMAN 2 Samarinda"],
    ].map(([slug, name]) =>
      addSchool({
        slug: slug!,
        name: name!,
        clusterId: cluster.id,
        subClusterId: subCluster.id,
        provinceCode: "KT",
      }),
    ),
  );
  const trip = (startsOn: string, endsOn: string) =>
    addPerjadin({
      subClusterId: subCluster.id,
      picPersonId: pic.id,
      startsOn,
      endsOn,
    });
  const a = await trip("2026-10-12", "2026-10-13");
  const b = await trip("2026-10-12", "2026-10-14");
  const held = await addOfflineSession({
    schoolId: bontang!.id,
    heldOn: "2026-10-12",
    startsAt: "08:00",
    perjadinId: a.id,
  });
  return { pic, subCluster, bontang: bontang!, samarinda: samarinda!, a, b, held };
}

/** The refusal naming trip A as the holder of Bontang's 12 Oct 08:00. */
function bookedOnA(a: { id: string }) {
  return {
    outcome: "school-booked-on-another-perjadin",
    schoolName: "SMAN 1 Bontang",
    heldOn: "2026-10-12",
    startsAt: "08:00:00",
    timeZone: "WITA",
    perjadin: {
      id: a.id,
      subClusterName: "Kelompok 10",
      startsOn: "2026-10-12",
      endsOn: "2026-10-13",
    },
  };
}

const at = (schoolId: string, heldOn: string, startsAt: string) => ({
  schoolId,
  heldOn,
  startsAt,
  taughtByTeacherIds: [],
});

const sessionsOn = (perjadinId: string) =>
  db.select().from(schema.session).where(eq(schema.session.perjadinId, perjadinId));

beforeEach(async () => {
  await resetDatabase();
  race.missedReads = 0;
  race.refusedByRead = 0;
});

/** The write's own read refused, before anything reached the index. */
const refusedBeforeTheIndex = () => expect(race.refusedByRead).toBe(1);

describe("the same School at the same moment on another trip", () => {
  it("is refused at planning, naming the other trip, and no trip is made", async () => {
    const { pic, subCluster, bontang, a } = await scene();
    const input: PlanPerjadinInput = {
      subClusterId: subCluster.id,
      picPersonId: pic.id,
      teacherNames: [],
      pimpinan: [],
      sessions: [{ ...at(bontang.id, "2026-10-12", "08:00"), taughtByTeacherIndexes: [] }],
      startsOn: "2026-10-12",
      endsOn: "2026-10-12",
    };

    await expect(planPerjadin(pic, input)).resolves.toEqual(bookedOnA(a));
    refusedBeforeTheIndex();
    await expect(db.select().from(schema.perjadin)).resolves.toHaveLength(2);
  });

  it("allows planning a different start time, or a different School", async () => {
    const { pic, subCluster, bontang, samarinda } = await scene();

    await expect(
      planPerjadin(pic, {
        subClusterId: subCluster.id,
        picPersonId: pic.id,
        teacherNames: [],
        pimpinan: [],
        sessions: [
          { ...at(bontang.id, "2026-10-12", "10:00"), taughtByTeacherIndexes: [] },
          { ...at(samarinda.id, "2026-10-12", "08:00"), taughtByTeacherIndexes: [] },
        ],
        startsOn: "2026-10-12",
        endsOn: "2026-10-12",
      }),
    ).resolves.toMatchObject({ outcome: "planned" });
  });

  it("is refused when a Session is added", async () => {
    const { pic, bontang, a, b } = await scene();

    await expect(
      addPerjadinSession(pic, b.id, at(bontang.id, "2026-10-12", "08:00")),
    ).resolves.toEqual(bookedOnA(a));
    refusedBeforeTheIndex();
    await expect(sessionsOn(b.id)).resolves.toHaveLength(0);
  });

  it("is refused when a Session is edited onto it", async () => {
    const { pic, bontang, a, b } = await scene();
    const moving = await addOfflineSession({
      schoolId: bontang.id,
      heldOn: "2026-10-12",
      startsAt: "13:00",
      perjadinId: b.id,
    });

    await expect(
      editPerjadinSession(pic, moving.id, at(bontang.id, "2026-10-12", "08:00")),
    ).resolves.toEqual(bookedOnA(a));
    refusedBeforeTheIndex();
  });

  it("is refused when a Session's date and time are moved onto it", async () => {
    const { pic, bontang, a, b } = await scene();
    const moving = await addOfflineSession({
      schoolId: bontang.id,
      heldOn: "2026-10-13",
      startsAt: "08:00",
      perjadinId: b.id,
    });

    await expect(moveSessionDate(pic, moving.id, "2026-10-12", "08:00")).resolves.toEqual(
      bookedOnA(a),
    );
    refusedBeforeTheIndex();
  });

  it("allows a different start time, or a different School", async () => {
    const { pic, bontang, samarinda, b } = await scene();

    await expect(
      addPerjadinSession(pic, b.id, at(bontang.id, "2026-10-12", "10:00")),
    ).resolves.toMatchObject({ outcome: "added" });
    await expect(
      addPerjadinSession(pic, b.id, at(samarinda.id, "2026-10-13", "08:00")),
    ).resolves.toMatchObject({ outcome: "added" });
  });

  it("is not blocked by a cancelled Session on the other trip", async () => {
    const { pic, bontang, b, held } = await scene();
    await cancelSession(pic, held.id, "Sekolah libur");

    await expect(
      addPerjadinSession(pic, b.id, at(bontang.id, "2026-10-12", "08:00")),
    ).resolves.toMatchObject({ outcome: "added" });
  });

  it("is still a duplicate, not a double-booking, on the same trip", async () => {
    const { pic, bontang, a } = await scene();

    await expect(
      addPerjadinSession(pic, a.id, at(bontang.id, "2026-10-12", "08:00")),
    ).resolves.toEqual({ outcome: "duplicate-session" });
  });
});

describe("the database holds it on its own", () => {
  it("refuses a raw insert that bypasses the check", async () => {
    const { bontang, b } = await scene();

    await expect(
      refusedBy(
        db.insert(schema.session).values({
          schoolId: bontang.id,
          perjadinId: b.id,
          mode: "offline",
          heldOn: "2026-10-12",
          startsAt: "08:00",
        }),
      ),
    ).resolves.toBe("session_no_duplicate_offline_per_school");
  });

  it("answers a race past the check with the same refusal, when adding", async () => {
    const { pic, bontang, a, b } = await scene();
    race.missedReads = 1;

    await expect(
      addPerjadinSession(pic, b.id, at(bontang.id, "2026-10-12", "08:00")),
    ).resolves.toEqual(bookedOnA(a));
    // The write's own read did miss: the refusal came from the index, read again.
    expect(race.missedReads).toBe(0);
  });

  it("answers a race past the check with the same refusal, when editing", async () => {
    const { pic, bontang, a, b } = await scene();
    const moving = await addOfflineSession({
      schoolId: bontang.id,
      heldOn: "2026-10-12",
      startsAt: "13:00",
      perjadinId: b.id,
    });
    race.missedReads = 1;

    await expect(
      editPerjadinSession(pic, moving.id, at(bontang.id, "2026-10-12", "08:00")),
    ).resolves.toEqual(bookedOnA(a));
    // The write's own read did miss: the refusal came from the index, read again.
    expect(race.missedReads).toBe(0);
  });

  it("answers a race past the check with the same refusal, when moving", async () => {
    const { pic, bontang, a, b } = await scene();
    const moving = await addOfflineSession({
      schoolId: bontang.id,
      heldOn: "2026-10-13",
      startsAt: "08:00",
      perjadinId: b.id,
    });
    race.missedReads = 1;

    await expect(moveSessionDate(pic, moving.id, "2026-10-12", "08:00")).resolves.toEqual(
      bookedOnA(a),
    );
    // The write's own read did miss: the refusal came from the index, read again.
    expect(race.missedReads).toBe(0);
  });

  it("answers a race past the check with the same refusal, when planning", async () => {
    const { pic, subCluster, bontang, a } = await scene();
    race.missedReads = 1;

    await expect(
      planPerjadin(pic, {
        subClusterId: subCluster.id,
        picPersonId: pic.id,
        teacherNames: [],
        pimpinan: [],
        sessions: [{ ...at(bontang.id, "2026-10-12", "08:00"), taughtByTeacherIndexes: [] }],
        startsOn: "2026-10-12",
        endsOn: "2026-10-12",
      }),
    ).resolves.toEqual(bookedOnA(a));
    await expect(db.select().from(schema.perjadin)).resolves.toHaveLength(2);
    // The write's own read did miss: the refusal came from the index, read again.
    expect(race.missedReads).toBe(0);
  });
});

describe("the sentence", () => {
  it("names the School, the moment in its zone, and links the other trip by its name", async () => {
    const { a } = await scene();
    const html = renderToStaticMarkup(
      createElement(SchoolBookedElsewhere, {
        refusal: bookedOnA(a) as Parameters<typeof SchoolBookedElsewhere>[0]["refusal"],
      }),
    );

    expect(html.replace(/<[^>]+>/g, "")).toBe(
      "SMAN 1 Bontang sudah punya Sesi luring pada 12 Okt 2026 pukul 08:00 WITA di Perjadin " +
        "Kelompok 10 · 12–13 Okt 2026.",
    );
    expect(html).toContain(`href="/perjadin/${a.id}"`);
  });
});
