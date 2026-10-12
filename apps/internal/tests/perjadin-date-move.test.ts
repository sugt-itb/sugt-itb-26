import { db, schema } from "@sugt/db";
import { planPerjadin, updatePerjadinDates, type PerjadinDatesInput } from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSubCluster,
  withGrant,
  resetDatabase,
} from "./support/fixtures";

/**
 * **A Perjadin's range is two typed dates** (ADR-0041), and the write side of #28's invariant lives
 * on the **Ubah tanggal** edit. Planning writes the range as given, and `updatePerjadinDates` resizes
 * it — clamping, never shifting (ADR-0021's rule, kept). An edit that would leave an **arranged**
 * Session outside the new window is refused whole (`would-strand`) and moves nothing; delivered and
 * cancelled Sessions may sit outside the window their trip now claims and do not block it.
 */

/** The Staff Person who is PIC of the trip. */
async function staff(email = "rina@ditsama.itb.ac.id") {
  // A Perjadin Editor, since these trips are planned through `planPerjadin` (ADR-0047).
  return withGrant(
    await addPerson({ fullName: "Rina Nurhayati", email, role: "Staff" }),
    "Perjadin Editor",
  );
}

/** One School to hang Sessions off — the free-standing kind, for the `addPerjadin` fixtures below. */
async function oneSchool(slug = "sman-1-bandung") {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  return addSchool({ slug, name: "SMAN 1 Bandung", clusterId: cluster.id, provinceCode: "JB" });
}

/** The `held_on` a Session actually carries, read back rather than trusted. */
async function heldOnOf(sessionId: string) {
  const [row] = await db
    .select({ heldOn: schema.session.heldOn })
    .from(schema.session)
    .where(eq(schema.session.id, sessionId));
  return row?.heldOn ?? null;
}

/** The range a Perjadin actually carries, read back rather than trusted. */
async function windowOf(perjadinId: string) {
  const [row] = await db
    .select({ startsOn: schema.perjadin.startsOn, endsOn: schema.perjadin.endsOn })
    .from(schema.perjadin)
    .where(eq(schema.perjadin.id, perjadinId));
  return row ?? null;
}

/** A `PerjadinDatesInput` from Tanggal mulai and Tanggal selesai. */
function dates(startsOn: string, endsOn: string): PerjadinDatesInput {
  return { startsOn, endsOn };
}

describe("Planning writes the typed range", () => {
  beforeEach(resetDatabase);

  it("writes starts_on/ends_on as typed", async () => {
    const pic = await staff();
    await addProvince("JB", "Jawa Barat");
    const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const subCluster = await addSubCluster({
      slug: "alpha-bandung",
      name: "Kelompok Sekolah Bandung",
      clusterId: cluster.id,
    });
    const school = await addSchool({
      slug: "sman-1",
      name: "SMAN 1 Bandung",
      clusterId: cluster.id,
      subClusterId: subCluster.id,
      provinceCode: "JB",
    });

    const planned = await planPerjadin(pic, {
      subClusterId: subCluster.id,
      picPersonId: pic.id,
      teacherNames: [],
      sessions: [
        {
          schoolId: school.id,
          heldOn: "2026-09-02",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
          pimpinanPersonIds: [],
        },
      ],
      startsOn: "2026-09-01",
      endsOn: "2026-09-04",
    });
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    expect(await windowOf(planned.perjadinId)).toEqual({
      startsOn: "2026-09-01",
      endsOn: "2026-09-04",
    });
  });
});

describe("Ubah tanggal resizes the range", () => {
  beforeEach(resetDatabase);

  it("writes the new starts_on/ends_on", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      startsOn: "2026-09-01",
      endsOn: "2026-09-05",
    });
    // A Session that stays inside the widened window, so the edit is not about stranding.
    await addOfflineSession({
      schoolId: school.id,
      heldOn: "2026-09-03",
      perjadinId: perjadin.id,
    });

    const result = await updatePerjadinDates(pic, perjadin.id, dates("2026-09-01", "2026-09-08"));

    expect(result).toEqual({ outcome: "updated", datesMoved: true });
    expect(await windowOf(perjadin.id)).toEqual({ startsOn: "2026-09-01", endsOn: "2026-09-08" });
  });

  it("refuses a date change that would strand an arranged Session, moving nothing", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      startsOn: "2026-09-01",
      endsOn: "2026-09-10",
    });
    const session = await addOfflineSession({
      schoolId: school.id,
      heldOn: "2026-09-09",
      perjadinId: perjadin.id,
    });

    // Tanggal selesai pulls in to the 5th: the arranged Session on the 9th would fall outside the new
    // window. Clamp, not shift — the whole edit is refused and the Session is left where it is.
    const result = await updatePerjadinDates(pic, perjadin.id, dates("2026-09-01", "2026-09-05"));

    expect(result).toEqual({
      outcome: "would-strand",
      strandedCount: 1,
      startsOn: "2026-09-01",
      endsOn: "2026-09-05",
    });
    // Nothing changed: not the range, and not the Session's date.
    expect(await windowOf(perjadin.id)).toEqual({ startsOn: "2026-09-01", endsOn: "2026-09-10" });
    expect(await heldOnOf(session.id)).toBe("2026-09-09");
  });

  it("lets a delivered or cancelled Session outside the new window pass — the invariant is arranged-only", async () => {
    const pic = await staff();
    await addProvince("JB", "Jawa Barat");
    const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const [delivered, cancelled] = await Promise.all([
      addSchool({ slug: "sman-1", name: "SMAN 1", clusterId: cluster.id, provinceCode: "JB" }),
      addSchool({ slug: "sman-2", name: "SMAN 2", clusterId: cluster.id, provinceCode: "JB" }),
    ]);
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      startsOn: "2026-09-01",
      endsOn: "2026-09-10",
    });
    // Both sit on the 9th — outside the window the edit shrinks to — but neither is arranged, so
    // neither blocks the resize.
    const deliveredSession = await addOfflineSession({
      schoolId: delivered.id,
      heldOn: "2026-09-09",
      status: "delivered",
      perjadinId: perjadin.id,
    });
    const cancelledSession = await addOfflineSession({
      schoolId: cancelled.id,
      heldOn: "2026-09-09",
      status: "cancelled",
      perjadinId: perjadin.id,
    });

    const result = await updatePerjadinDates(pic, perjadin.id, dates("2026-09-01", "2026-09-05"));

    expect(result).toEqual({ outcome: "updated", datesMoved: true });
    expect(await windowOf(perjadin.id)).toEqual({ startsOn: "2026-09-01", endsOn: "2026-09-05" });
    // The two out-of-window Sessions are left exactly where they were.
    expect(await heldOnOf(deliveredSession.id)).toBe("2026-09-09");
    expect(await heldOnOf(cancelledSession.id)).toBe("2026-09-09");
  });

  it("accepts a same-day trip — Tanggal mulai equal to Tanggal selesai", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      startsOn: "2026-09-01",
      endsOn: "2026-09-05",
    });
    await addOfflineSession({
      schoolId: school.id,
      heldOn: "2026-09-02",
      perjadinId: perjadin.id,
    });

    const result = await updatePerjadinDates(pic, perjadin.id, dates("2026-09-02", "2026-09-02"));

    expect(result).toEqual({ outcome: "updated", datesMoved: true });
    expect(await windowOf(perjadin.id)).toEqual({ startsOn: "2026-09-02", endsOn: "2026-09-02" });
  });

  it("refuses a Tanggal selesai earlier than the Tanggal mulai, before opening the transaction", async () => {
    const pic = await staff();
    await oneSchool();
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      startsOn: "2026-09-01",
      endsOn: "2026-09-05",
    });

    const result = await updatePerjadinDates(pic, perjadin.id, dates("2026-09-05", "2026-09-01"));

    expect(result).toEqual({ outcome: "ends-before-starts" });
    // The range is untouched: the refusal comes before any write.
    expect(await windowOf(perjadin.id)).toEqual({ startsOn: "2026-09-01", endsOn: "2026-09-05" });
  });

  it("reports no-such-perjadin for an id that names no trip", async () => {
    const pic = await staff();

    const result = await updatePerjadinDates(
      pic,
      "00000000-0000-0000-0000-000000000000",
      dates("2026-09-01", "2026-09-03"),
    );

    expect(result).toEqual({ outcome: "no-such-perjadin" });
  });
});
