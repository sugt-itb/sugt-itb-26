import { db, schema } from "@sugt/db";
import { myPerjadin, perjadinAcquittal, togglePreparationItem } from "@sugt/db/queries";
import type { Person } from "@sugt/db/queries";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSubCluster,
  addTransaction,
  COMPANY_PREPARATION_ITEMS,
  resetDatabase,
} from "./support/fixtures";

/**
 * **The caller's own trips** (#197, #396). The read is scoped *by* the caller — only trips they are
 * a `group_member` of — and split at WIB "today" into the current trips, soonest first, and the
 * previous ones, most recently ended first. Each carries its money, its Group/teachers/Pimpinan
 * and its visited Schools.
 */

/** A `Person` shaped the way the query layer takes one, from an inserted `person` row. */
function asPerson(row: { id: string; fullName: string; email: string }): Person {
  return { id: row.id, fullName: row.fullName, email: row.email, role: "Staff", grants: [] };
}

/**
 * A calendar date `offset` days from today, `YYYY-MM-DD`. Computed in UTC and used only with
 * margins of several days, so the up-to-seven-hour skew between UTC and the query's WIB "today"
 * never lands a fixture on the wrong side of the cutoff.
 */
function daysFromToday(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Today in the query's own zone (WIB), `YYYY-MM-DD` — the exact day the `ends_on >= today` cutoff
 * compares against, so a trip ending on it sits *on* the inclusive boundary. `en-CA` renders ISO.
 */
function wibToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

/** `offset` days from today in WIB, `YYYY-MM-DD` — exact, for a fixture on a boundary. */
function wibDaysFromToday(offset: number): string {
  const d = new Date(`${wibToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Put the caller on a trip whose PIC is someone else — the membership this read filters by. */
async function addGroupMember(perjadinId: string, personId: string) {
  await db.insert(schema.groupMember).values({ perjadinId, personId, role: "Staff", stream: null });
}

describe("myPerjadin returns only the caller's own trips", () => {
  beforeEach(resetDatabase);

  it("keeps trips the caller leads or merely joined, in both sections, and drops the rest", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    const other = await addPerson({
      fullName: "Budi",
      email: "budi@ditsama.itb.ac.id",
      role: "Staff",
    });

    // Led by the caller — they are a member by the deferred PIC-is-a-member FK the fixture honours.
    const led = await addPerjadin({
      picPersonId: caller.id,
      startsOn: daysFromToday(2),
      endsOn: daysFromToday(6),
    });
    // Led by someone else, but the caller is added to the Group — one current, one past.
    const joined = await addPerjadin({
      picPersonId: other.id,
      startsOn: daysFromToday(3),
      endsOn: daysFromToday(7),
    });
    await addGroupMember(joined.id, caller.id);
    const joinedPast = await addPerjadin({
      picPersonId: other.id,
      startsOn: daysFromToday(-20),
      endsOn: daysFromToday(-15),
    });
    await addGroupMember(joinedPast.id, caller.id);
    // Led by someone else and the caller is nowhere on them — excluded, current and past alike.
    await addPerjadin({
      picPersonId: other.id,
      startsOn: daysFromToday(4),
      endsOn: daysFromToday(8),
    });
    await addPerjadin({
      picPersonId: other.id,
      startsOn: daysFromToday(-30),
      endsOn: daysFromToday(-25),
    });

    const trips = await myPerjadin(caller);

    expect(trips.current.map((t) => t.id).sort()).toEqual([led.id, joined.id].sort());
    expect(trips.previous.map((t) => t.id)).toEqual([joinedPast.id]);
  });

  it("returns two empty sections for a caller on no trip", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    await expect(myPerjadin(caller)).resolves.toEqual({ current: [], previous: [] });
  });
});

describe("myPerjadin splits at today (WIB) and orders each section", () => {
  beforeEach(resetDatabase);

  it("puts current trips soonest first and previous trips most recently ended first", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    const trip = (startsOn: number, endsOn: number) =>
      addPerjadin({
        picPersonId: caller.id,
        startsOn: daysFromToday(startsOn),
        endsOn: daysFromToday(endsOn),
      });

    const future = await trip(20, 25);
    const inProgress = await trip(-5, 5);
    const longAgo = await trip(-40, -30);
    // Two that ended the same day: the one that started later comes first.
    const recentShort = await trip(-8, -6);
    const recentLong = await trip(-12, -6);

    const trips = await myPerjadin(caller);

    expect(trips.current.map((t) => t.id)).toEqual([inProgress.id, future.id]);
    expect(trips.previous.map((t) => t.id)).toEqual([recentShort.id, recentLong.id, longAgo.id]);
  });

  it("keeps a trip ending exactly today current, and one that ended yesterday previous", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    // ends_on is today in the query's own WIB zone, so the trip sits on the inclusive boundary: a
    // `> today` cutoff would drop it, `>= today` keeps it.
    const endsToday = await addPerjadin({
      picPersonId: caller.id,
      startsOn: daysFromToday(-3),
      endsOn: wibToday(),
    });
    const endedYesterday = await addPerjadin({
      picPersonId: caller.id,
      startsOn: daysFromToday(-10),
      endsOn: wibDaysFromToday(-1),
    });

    const trips = await myPerjadin(caller);

    expect(trips.current.map((t) => t.id)).toEqual([endsToday.id]);
    expect(trips.previous.map((t) => t.id)).toEqual([endedYesterday.id]);
  });
});

describe("myPerjadin gives the PIC and a member the same card", () => {
  beforeEach(resetDatabase);

  it("carries no Laporan state, so a PIC's card has nothing a member's lacks (#419)", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    const other = await addPerson({
      fullName: "Budi",
      email: "budi@ditsama.itb.ac.id",
      role: "Staff",
    });
    // Ended three days ago with nothing filed: the trip that used to carry the red overdue line.
    const led = await addPerjadin({
      picPersonId: caller.id,
      startsOn: wibDaysFromToday(-6),
      endsOn: wibDaysFromToday(-3),
    });
    const joined = await addPerjadin({
      picPersonId: other.id,
      startsOn: wibDaysFromToday(-8),
      endsOn: wibDaysFromToday(-5),
    });
    await addGroupMember(joined.id, caller.id);

    const { previous } = await myPerjadin(caller);
    const ledCard = previous.find((trip) => trip.id === led.id);
    const joinedCard = previous.find((trip) => trip.id === joined.id);

    expect(ledCard).not.toHaveProperty("report");
    expect(Object.keys(ledCard ?? {}).toSorted()).toEqual(Object.keys(joinedCard ?? {}).toSorted());
  });
});

describe("myPerjadin carries the same money as the acquittal", () => {
  beforeEach(resetDatabase);

  it("is Uang Perjalanan Terpakai: every category, the acquittal's spentIdr (ADR-0051)", async () => {
    // Konsumsi and Lainnya once drew the float down and Akomodasi did not (ADR-0029). The card now
    // counts all three, like every other screen.
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    const trip = await addPerjadin({
      picPersonId: caller.id,
      startsOn: daysFromToday(1),
      endsOn: daysFromToday(4),
    });
    for (const [amountIdr, category] of [
      [1_200_000, "Konsumsi"],
      [300_000, "Akomodasi"],
      [50_000, "Lainnya"],
    ] as const) {
      await addTransaction({
        perjadinId: trip.id,
        amountIdr,
        category,
        createdByPersonId: caller.id,
      });
    }

    const {
      current: [mine],
    } = await myPerjadin(caller);
    const acquittal = await perjadinAcquittal(caller, trip.id);
    if (!mine || !acquittal) throw new Error("expected the trip on both reads");

    expect(mine.spentIdr).toBe(1_550_000);
    expect(mine.spentIdr).toBe(acquittal.spentIdr);
  });

  it("is zero for a trip with no transactions", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    const trip = await addPerjadin({
      picPersonId: caller.id,
      startsOn: daysFromToday(1),
      endsOn: daysFromToday(4),
    });

    const {
      current: [mine],
    } = await myPerjadin(caller);
    expect(mine?.id).toBe(trip.id);
    expect(mine?.spentIdr).toBe(0);
  });
});

describe("myPerjadin lists the trip's members", () => {
  beforeEach(resetDatabase);

  it("returns staff, pengajar and pimpinan in name order with a combined total", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    // Extra Staff — name orders before the caller's "Rina".
    const anwar = await addPerson({
      fullName: "Anwar",
      email: "anwar@ditsama.itb.ac.id",
      role: "Staff",
    });
    // A record-only Pimpinan (#181), a real Person of role Pimpinan.
    const pimpinan = await addPerson({
      fullName: "Pak Joko",
      email: "joko@ditsama.itb.ac.id",
      role: "Pimpinan",
    });

    const trip = await addPerjadin({
      picPersonId: caller.id,
      startsOn: daysFromToday(1),
      endsOn: daysFromToday(4),
      pimpinan: [pimpinan.id],
    });
    await addGroupMember(trip.id, anwar.id);
    // Trip-scoped teacher names (ADR-0020), inserted out of name order to prove the sort.
    await db.insert(schema.perjadinTeacher).values([
      { perjadinId: trip.id, name: "Sri Wahyuni" },
      { perjadinId: trip.id, name: "Dr. Agus" },
    ]);

    const {
      current: [mine],
    } = await myPerjadin(caller);
    if (!mine) throw new Error("expected the trip");

    // Staff in name order; the caller is flagged PIC, the extra Staff is not.
    expect(mine.anggota.staff).toEqual([
      { personId: anwar.id, fullName: "Anwar", isPic: false },
      { personId: caller.id, fullName: "Rina", isPic: true },
    ]);
    expect(mine.anggota.pengajar.map((p) => p.name)).toEqual(["Dr. Agus", "Sri Wahyuni"]);
    expect(mine.anggota.pimpinan).toEqual([{ personId: pimpinan.id, name: "Pak Joko" }]);
    // 2 staff + 2 pengajar + 1 pimpinan.
    expect(mine.anggota.anggotaTotal).toBe(5);
  });
});

describe("myPerjadin builds the visited-Schools tree", () => {
  beforeEach(resetDatabase);

  it("groups offline Sessions by School and includes a cancelled one", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    await addProvince("SU", "Sulawesi Utara", "WITA");
    const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const subCluster = await addSubCluster({
      slug: "alpha-1",
      name: "Kelompok 1",
      clusterId: cluster.id,
    });
    // Two Schools, named so "SMAN A" sorts before "SMAN B".
    const schoolA = await addSchool({
      slug: "sman-a",
      name: "SMAN A",
      clusterId: cluster.id,
      subClusterId: subCluster.id,
      provinceCode: "SU",
      kabupatenKota: "Kota Manado",
    });
    const schoolB = await addSchool({
      slug: "sman-b",
      name: "SMAN B",
      clusterId: cluster.id,
      subClusterId: subCluster.id,
      provinceCode: "SU",
    });

    // Captured once, so an assertion cannot straddle a UTC midnight the inserts fell before.
    const [heldA1, heldA2, heldB] = [daysFromToday(2), daysFromToday(3), daysFromToday(4)];
    const trip = await addPerjadin({
      picPersonId: caller.id,
      subClusterId: subCluster.id,
      startsOn: daysFromToday(1),
      endsOn: daysFromToday(6),
    });
    // School A: an arranged Session and, later, a cancelled one — the cancelled one is included.
    const arranged = await addOfflineSession({
      schoolId: schoolA.id,
      heldOn: heldA1,
      startsAt: "09:00",
      perjadinId: trip.id,
    });
    const cancelled = await addOfflineSession({
      schoolId: schoolA.id,
      heldOn: heldA2,
      startsAt: "09:00",
      status: "cancelled",
      perjadinId: trip.id,
    });
    const atB = await addOfflineSession({
      schoolId: schoolB.id,
      heldOn: heldB,
      startsAt: "09:00",
      perjadinId: trip.id,
    });

    const {
      current: [mine],
    } = await myPerjadin(caller);
    if (!mine) throw new Error("expected the trip");

    expect(mine.schools).toEqual([
      {
        schoolId: schoolA.id,
        name: "SMAN A",
        kabupatenKota: "Kota Manado",
        timeZone: "WITA",
        sessions: [
          { sessionId: arranged.id, heldOn: heldA1, startsAt: "09:00:00", status: "arranged" },
          { sessionId: cancelled.id, heldOn: heldA2, startsAt: "09:00:00", status: "cancelled" },
        ],
      },
      {
        schoolId: schoolB.id,
        name: "SMAN B",
        kabupatenKota: "Kota Bandung",
        timeZone: "WITA",
        sessions: [{ sessionId: atB.id, heldOn: heldB, startsAt: "09:00:00", status: "arranged" }],
      },
    ]);
  });
});

describe("myPerjadin resolves the Preparation Checklist", () => {
  beforeEach(resetDatabase);

  it("returns the trip's own checklist, marking only the ticked items", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    const trip = await addPerjadin({
      picPersonId: caller.id,
      startsOn: daysFromToday(1),
      endsOn: daysFromToday(4),
    });
    const before = (await myPerjadin(caller)).current[0]?.preparation ?? [];
    const [first, , third] = before;
    for (const item of [first!, third!]) {
      await togglePreparationItem(caller, {
        perjadinId: trip.id,
        itemId: item.itemId,
        checked: true,
      });
    }

    const {
      current: [mine],
    } = await myPerjadin(caller);
    if (!mine) throw new Error("expected the trip");

    // A trip not yet over has the company's 14 (ADR-0045); the card's `x/N` is read off this list.
    expect(mine.preparation.map((item) => item.label)).toEqual(COMPANY_PREPARATION_ITEMS);
    expect(mine.preparation.filter((item) => item.checked).map((item) => item.itemId)).toEqual([
      first!.itemId,
      third!.itemId,
    ]);
  });

  it("gives a trip with no ticks every item unchecked", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    const trip = await addPerjadin({
      picPersonId: caller.id,
      startsOn: daysFromToday(1),
      endsOn: daysFromToday(4),
    });

    const {
      current: [mine],
    } = await myPerjadin(caller);
    expect(mine?.id).toBe(trip.id);
    expect(mine?.preparation).toHaveLength(COMPANY_PREPARATION_ITEMS.length);
    expect(mine?.preparation.every((item) => !item.checked)).toBe(true);
  });
});

describe("myPerjadin lists the Narasumber by School (#447)", () => {
  beforeEach(resetDatabase);

  /**
   * The ticket's Perjadin A, done PP: one trip, a School a day, each with its own "Diajar oleh".
   * Returns the caller, the trip and a way to add a School with one Session and its team.
   */
  async function perjadinA() {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    await addProvince("KT", "Kalimantan Timur", "WITA");
    const cluster = await addCluster({ slug: "kaltim", name: "Cluster Kaltim" });
    const subCluster = await addSubCluster({
      slug: "kelompok-10",
      name: "Kelompok 10",
      clusterId: cluster.id,
    });
    const trip = await addPerjadin({
      picPersonId: caller.id,
      subClusterId: subCluster.id,
      startsOn: daysFromToday(1),
      endsOn: daysFromToday(8),
    });

    const teachers = new Map<string, string>();
    /** The trip's Narasumber, by name — the `perjadin_teacher` rows, entered in no order. */
    async function narasumber(...names: string[]) {
      const rows = await db
        .insert(schema.perjadinTeacher)
        .values(names.map((name) => ({ perjadinId: trip.id, name })))
        .returning();
      for (const row of rows) teachers.set(row.name, row.id);
    }

    const schools = new Map<string, string>();
    /** One Session at a School of the trip, "Diajar oleh" the named Narasumber. */
    async function session(
      schoolName: string,
      fixture: { day: number; startsAt?: string; status?: "cancelled"; diajarOleh: string[] },
    ) {
      let schoolId = schools.get(schoolName);
      if (!schoolId) {
        schoolId = (
          await addSchool({
            slug: schoolName.toLowerCase().replaceAll(" ", "-"),
            name: schoolName,
            clusterId: cluster.id,
            subClusterId: subCluster.id,
            provinceCode: "KT",
          })
        ).id;
        schools.set(schoolName, schoolId);
      }
      const row = await addOfflineSession({
        schoolId,
        heldOn: daysFromToday(fixture.day),
        startsAt: fixture.startsAt ?? "09:00",
        status: fixture.status,
        perjadinId: trip.id,
      });
      if (fixture.diajarOleh.length > 0) {
        await db.insert(schema.sessionTeachingTeam).values(
          fixture.diajarOleh.map((name) => ({
            sessionId: row.id,
            perjadinTeacherId: teachers.get(name)!,
          })),
        );
      }
    }

    async function card() {
      const {
        current: [mine],
      } = await myPerjadin(caller);
      if (!mine) throw new Error("expected the trip");
      return mine.anggota;
    }

    /** The block as names: each School's list, and the unassigned, for a readable comparison. */
    async function names() {
      const { pengajarBySchool, pengajar } = await card();
      return {
        total: pengajar.length,
        bySchool: pengajarBySchool.bySchool.map((school) => [
          school.name,
          school.pengajar.map((person) => person.name),
        ]),
        unassigned: pengajarBySchool.unassigned.map((person) => person.name),
      };
    }

    return { narasumber, session, card, names };
  }

  const sman1 = ["Bu Ani", "Pak Budi", "Bu Citra", "Pak Dedi", "Bu Eka", "Pak Fajar"];
  const sman2 = ["Bu Ani", "Pak Gilang", "Bu Hana", "Pak Indra", "Bu Joko", "Pak Fajar"];

  it("repeats a Narasumber under each School they taught at, and counts the trip's once", async () => {
    const a = await perjadinA();
    await a.narasumber(
      "Pak Gilang",
      "Bu Ani",
      "Pak Budi",
      "Bu Citra",
      "Pak Dedi",
      "Bu Eka",
      "Pak Fajar",
      "Bu Hana",
      "Pak Indra",
      "Bu Joko",
    );
    await a.session("SMAN 1 Bontang", { day: 2, diajarOleh: sman1 });
    await a.session("SMAN 2 Bontang", { day: 4, diajarOleh: sman2 });

    expect(await a.names()).toEqual({
      total: 10,
      bySchool: [
        ["SMAN 1 Bontang", ["Bu Ani", "Bu Citra", "Bu Eka", "Pak Budi", "Pak Dedi", "Pak Fajar"]],
        [
          "SMAN 2 Bontang",
          ["Bu Ani", "Bu Hana", "Bu Joko", "Pak Fajar", "Pak Gilang", "Pak Indra"],
        ],
      ],
      unassigned: [],
    });
  });

  it("lists a School with no team and the trip's untaught Narasumber (the variant)", async () => {
    const a = await perjadinA();
    await a.narasumber(
      "Bu Ani",
      "Pak Budi",
      "Bu Citra",
      "Pak Dedi",
      "Bu Eka",
      "Pak Fajar",
      "Pak Gilang",
      "Bu Hana",
      "Pak Indra",
      "Bu Joko",
      "Pak Kurnia",
    );
    await a.session("SMAN 1 Bontang", { day: 2, diajarOleh: sman1 });
    await a.session("SMAN 2 Bontang", { day: 4, diajarOleh: sman2 });
    await a.session("SMAN 3 Bontang", { day: 5, diajarOleh: [] });

    const { total, bySchool, unassigned } = await a.names();
    expect(total).toBe(11);
    expect(bySchool.map(([school]) => school)).toEqual([
      "SMAN 1 Bontang",
      "SMAN 2 Bontang",
      "SMAN 3 Bontang",
    ]);
    expect(bySchool[2]).toEqual(["SMAN 3 Bontang", []]);
    expect(unassigned).toEqual(["Pak Kurnia"]);
  });

  it("drops a cancelled Session: its School leaves the list and its team is unassigned", async () => {
    const a = await perjadinA();
    await a.narasumber(...sman1, "Pak Kurnia");
    await a.session("SMAN 1 Bontang", { day: 2, diajarOleh: sman1 });
    await a.session("SMAN 3 Bontang", { day: 5, status: "cancelled", diajarOleh: ["Pak Kurnia"] });

    expect(await a.names()).toEqual({
      total: 7,
      bySchool: [
        ["SMAN 1 Bontang", ["Bu Ani", "Bu Citra", "Bu Eka", "Pak Budi", "Pak Dedi", "Pak Fajar"]],
      ],
      unassigned: ["Pak Kurnia"],
    });
  });

  it("lists someone who taught two of a School's Sessions once, and a cancelled one adds nobody", async () => {
    const a = await perjadinA();
    await a.narasumber("Bu Ani", "Pak Budi", "Bu Citra");
    await a.session("SMAN 1 Bontang", { day: 2, diajarOleh: ["Bu Ani", "Pak Budi"] });
    await a.session("SMAN 1 Bontang", { day: 3, diajarOleh: ["Bu Ani"] });
    await a.session("SMAN 1 Bontang", { day: 4, status: "cancelled", diajarOleh: ["Bu Citra"] });

    expect(await a.names()).toEqual({
      total: 3,
      bySchool: [["SMAN 1 Bontang", ["Bu Ani", "Pak Budi"]]],
      unassigned: ["Bu Citra"],
    });
  });

  it("orders Schools by their earliest live Session, then by name, whatever their names", async () => {
    const a = await perjadinA();
    await a.narasumber("Bu Ani");
    // SMAN 9's only live Session is first; SMAN 5's cancelled one, earlier still, does not count.
    await a.session("SMAN 5 Bontang", { day: 1, status: "cancelled", diajarOleh: [] });
    await a.session("SMAN 5 Bontang", { day: 4, diajarOleh: [] });
    await a.session("SMAN 9 Bontang", { day: 2, diajarOleh: ["Bu Ani"] });
    // Same day and time as SMAN 5's live one: the name breaks the tie.
    await a.session("SMAN 4 Bontang", { day: 4, diajarOleh: [] });
    // Same day, earlier start.
    await a.session("SMAN 7 Bontang", { day: 4, startsAt: "07:30", diajarOleh: [] });

    const { bySchool } = await a.names();
    expect(bySchool.map(([school]) => school)).toEqual([
      "SMAN 9 Bontang",
      "SMAN 7 Bontang",
      "SMAN 4 Bontang",
      "SMAN 5 Bontang",
    ]);
  });

  it("gives a trip with no Narasumber an empty block, each School unassigned", async () => {
    const a = await perjadinA();
    await a.session("SMAN 1 Bontang", { day: 2, diajarOleh: [] });

    expect(await a.names()).toEqual({
      total: 0,
      bySchool: [["SMAN 1 Bontang", []]],
      unassigned: [],
    });
  });

  it("puts every name of a freshly planned trip under belum ditugaskan", async () => {
    const a = await perjadinA();
    await a.narasumber("Bu Ani", "Pak Budi", "Bu Citra", "Pak Dedi", "Bu Eka", "Pak Fajar");
    await a.session("SMAN 1 Bontang", { day: 2, diajarOleh: [] });
    await a.session("SMAN 2 Bontang", { day: 4, diajarOleh: [] });

    expect(await a.names()).toEqual({
      total: 6,
      bySchool: [
        ["SMAN 1 Bontang", []],
        ["SMAN 2 Bontang", []],
      ],
      unassigned: ["Bu Ani", "Bu Citra", "Bu Eka", "Pak Budi", "Pak Dedi", "Pak Fajar"],
    });
  });

  it("tells two Narasumber of one name apart by their trip-scoped row", async () => {
    const a = await perjadinA();
    await a.narasumber("Dr. Sari");
    // A second `perjadin_teacher` row of the same name: a different person who taught nowhere.
    await a.narasumber("Dr. Sari");
    const [first] = (await a.card()).pengajar;
    await a.session("SMAN 1 Bontang", { day: 2, diajarOleh: [] });
    await db.insert(schema.sessionTeachingTeam).values({
      sessionId: (await db.select({ id: schema.session.id }).from(schema.session))[0]!.id,
      perjadinTeacherId: first!.id,
    });

    const { pengajar, pengajarBySchool } = await a.card();
    expect(pengajar).toHaveLength(2);
    expect(pengajarBySchool.bySchool[0]?.pengajar.map((person) => person.id)).toEqual([first!.id]);
    expect(pengajarBySchool.unassigned.map((person) => person.id)).toEqual(
      pengajar.filter((person) => person.id !== first!.id).map((person) => person.id),
    );
  });

  it("carries each School's id and each Narasumber's trip-scoped id", async () => {
    const a = await perjadinA();
    await a.narasumber("Bu Ani");
    await a.session("SMAN 1 Bontang", { day: 2, diajarOleh: ["Bu Ani"] });

    const { pengajarBySchool, pengajar } = await a.card();
    expect(pengajarBySchool.bySchool[0]?.schoolId).toEqual(expect.any(String));
    expect(pengajarBySchool.bySchool[0]?.pengajar).toEqual(pengajar);
  });
});
