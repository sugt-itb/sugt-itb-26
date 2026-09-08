import { db, schema } from "@sugt/db";
import { myUpcomingPerjadin, perjadinAcquittal } from "@sugt/db/queries";
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
  resetDatabase,
} from "./support/fixtures";

/**
 * **Perjalanan Saya** (#197): the caller's own upcoming trips. The read is scoped *by* the caller —
 * only trips they are a `group_member` of, and only trips not yet over (WIB "today") — soonest
 * first, each carrying its money, its Group/teachers/Pimpinan and its visited Schools.
 */

/** A `Person` shaped the way the query layer takes one, from an inserted `person` row. */
function asPerson(row: { id: string; fullName: string; email: string }): Person {
  return { id: row.id, fullName: row.fullName, email: row.email, role: "Staff" };
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

/** Put the caller on a trip whose PIC is someone else — the membership this read filters by. */
async function addGroupMember(perjadinId: string, personId: string) {
  await db.insert(schema.groupMember).values({ perjadinId, personId, role: "Staff", stream: null });
}

describe("myUpcomingPerjadin returns only the caller's own trips", () => {
  beforeEach(resetDatabase);

  it("keeps a trip the caller leads and a trip they merely joined, drops one they are not on", async () => {
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
      advanceIdr: 1_000_000,
      startsOn: daysFromToday(2),
      endsOn: daysFromToday(6),
    });
    // Led by someone else, but the caller is added to the Group.
    const joined = await addPerjadin({
      picPersonId: other.id,
      advanceIdr: 1_000_000,
      startsOn: daysFromToday(3),
      endsOn: daysFromToday(7),
    });
    await addGroupMember(joined.id, caller.id);
    // Led by someone else and the caller is nowhere on it — excluded.
    await addPerjadin({
      picPersonId: other.id,
      advanceIdr: 1_000_000,
      startsOn: daysFromToday(4),
      endsOn: daysFromToday(8),
    });

    const trips = await myUpcomingPerjadin(caller);

    expect(trips.map((t) => t.id).sort()).toEqual([led.id, joined.id].sort());
  });
});

describe("myUpcomingPerjadin filters on ends_on >= today and sorts soonest first", () => {
  beforeEach(resetDatabase);

  it("drops a finished trip, keeps an in-progress and a future one, sorted by starts_on", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );

    // Already over — excluded.
    await addPerjadin({
      picPersonId: caller.id,
      advanceIdr: 1_000_000,
      startsOn: daysFromToday(-40),
      endsOn: daysFromToday(-30),
    });
    // In progress: started in the past, ends in the future — kept.
    const inProgress = await addPerjadin({
      picPersonId: caller.id,
      advanceIdr: 1_000_000,
      startsOn: daysFromToday(-5),
      endsOn: daysFromToday(5),
    });
    // Entirely in the future — kept, and sorts after the in-progress one.
    const future = await addPerjadin({
      picPersonId: caller.id,
      advanceIdr: 1_000_000,
      startsOn: daysFromToday(20),
      endsOn: daysFromToday(25),
    });

    const trips = await myUpcomingPerjadin(caller);

    // Sorted by starts_on ascending: the in-progress trip (earlier start) before the future one.
    expect(trips.map((t) => t.id)).toEqual([inProgress.id, future.id]);
  });

  it("keeps a trip ending exactly today — the cutoff is inclusive (ends_on >= today)", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    // ends_on is today in the query's own WIB zone, so the trip sits on the inclusive boundary: a
    // `> today` cutoff would drop it, `>= today` keeps it. Starts a few days back so it is otherwise
    // a plain in-progress trip.
    const endsToday = await addPerjadin({
      picPersonId: caller.id,
      advanceIdr: 1_000_000,
      startsOn: daysFromToday(-3),
      endsOn: wibToday(),
    });

    const trips = await myUpcomingPerjadin(caller);

    expect(trips.map((t) => t.id)).toEqual([endsToday.id]);
  });
});

describe("myUpcomingPerjadin carries the same money as the acquittal", () => {
  beforeEach(resetDatabase);

  it("sums the trip's transactions and agrees with perjadinAcquittal's remainder math", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    const trip = await addPerjadin({
      picPersonId: caller.id,
      advanceIdr: 5_000_000,
      startsOn: daysFromToday(1),
      endsOn: daysFromToday(4),
    });
    await addTransaction({
      perjadinId: trip.id,
      amountIdr: 1_200_000,
      createdByPersonId: caller.id,
    });
    await addTransaction({ perjadinId: trip.id, amountIdr: 300_000, createdByPersonId: caller.id });

    const [mine] = await myUpcomingPerjadin(caller);
    const acquittal = await perjadinAcquittal(caller, trip.id);
    if (!mine || !acquittal) throw new Error("expected the trip on both reads");

    expect(mine.advanceIdr).toBe(5_000_000);
    expect(mine.spentIdr).toBe(1_500_000);
    // The same figure the acquittal derives, and the UI's Tersisa matches its remainder.
    expect(mine.spentIdr).toBe(acquittal.spentIdr);
    expect(mine.advanceIdr - mine.spentIdr).toBe(acquittal.remainderIdr);
  });

  it("reports zero spend for a trip with no transactions", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    const trip = await addPerjadin({
      picPersonId: caller.id,
      advanceIdr: 2_000_000,
      startsOn: daysFromToday(1),
      endsOn: daysFromToday(4),
    });

    const [mine] = await myUpcomingPerjadin(caller);
    expect(mine?.id).toBe(trip.id);
    expect(mine?.spentIdr).toBe(0);
  });
});

describe("myUpcomingPerjadin lists the trip's members", () => {
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
      advanceIdr: 1_000_000,
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

    const [mine] = await myUpcomingPerjadin(caller);
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

describe("myUpcomingPerjadin builds the visited-Schools tree", () => {
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
      advanceIdr: 1_000_000,
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

    const [mine] = await myUpcomingPerjadin(caller);
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

describe("myUpcomingPerjadin derives the Preparation Checklist", () => {
  beforeEach(resetDatabase);

  it("returns the fixed seven, marking only the ticked ones and dropping orphans", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    const trip = await addPerjadin({
      picPersonId: caller.id,
      advanceIdr: 1_000_000,
      startsOn: daysFromToday(1),
      endsOn: daysFromToday(4),
    });
    // Two fixed items ticked, plus a `dosen:` orphan the old model left behind — the orphan matches
    // no fixed key, so it has no item here and never shows as checked.
    await db.insert(schema.perjadinPreparationItem).values([
      { perjadinId: trip.id, itemKey: "sk_perjalanan", checkedBy: caller.id },
      { perjadinId: trip.id, itemKey: "tiket_keberangkatan", checkedBy: caller.id },
      { perjadinId: trip.id, itemKey: "dosen:someone", checkedBy: caller.id },
    ]);

    const [mine] = await myUpcomingPerjadin(caller);
    if (!mine) throw new Error("expected the trip");

    // The card derives its `x/N` pill from this: N is the length (always seven), x the checked count.
    expect(mine.preparation).toHaveLength(7);
    const checked = mine.preparation.filter((item) => item.checked).map((item) => item.itemKey);
    expect(checked.sort()).toEqual(["sk_perjalanan", "tiket_keberangkatan"]);
    // Every other fixed item comes back unchecked; the `dosen:` orphan never appears at all.
    expect(mine.preparation.filter((item) => !item.checked)).toHaveLength(5);
    expect(mine.preparation.some((item) => item.itemKey.startsWith("dosen:"))).toBe(false);
  });

  it("gives a trip with no ticks all seven items unchecked", async () => {
    const caller = asPerson(
      await addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" }),
    );
    const trip = await addPerjadin({
      picPersonId: caller.id,
      advanceIdr: 1_000_000,
      startsOn: daysFromToday(1),
      endsOn: daysFromToday(4),
    });

    const [mine] = await myUpcomingPerjadin(caller);
    expect(mine?.id).toBe(trip.id);
    expect(mine?.preparation).toHaveLength(7);
    expect(mine?.preparation.every((item) => !item.checked)).toBe(true);
  });
});
