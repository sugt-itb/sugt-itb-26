import { onlineSessionDirectory } from "@sugt/db/queries";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  resetDatabase,
} from "./support/fixtures";

/**
 * **The online Session directory** — every online Session, newest first, open to anyone signed in.
 * The rules under test are the ones a flat `select` gets wrong: it lists *every* status (not only
 * delivered), it lists *only* online Sessions (never the offline ones that belong to a Perjadin),
 * and it orders `held_on` then `starts_at` descending.
 */

async function staff(email = "rina@ditsama.itb.ac.id") {
  return addPerson({ fullName: "Rina Nurhayati", email, role: "Staff" });
}

async function oneSchool() {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  return addSchool({
    slug: "sman-1-bandung",
    name: "SMAN 1 Bandung",
    clusterId: cluster.id,
    provinceCode: "JB",
  });
}

/** Two Schools in one Cluster — the ordering test needs two, since one School may hold only one
 * online Session per day (`session_one_online_per_school_per_day`, by day not time). */
async function twoSchools() {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const a = await addSchool({
    slug: "sman-1-bandung",
    name: "SMAN 1 Bandung",
    clusterId: cluster.id,
    provinceCode: "JB",
  });
  const b = await addSchool({
    slug: "sman-2-bandung",
    name: "SMAN 2 Bandung",
    clusterId: cluster.id,
    provinceCode: "JB",
  });
  return { a, b };
}

describe("onlineSessionDirectory", () => {
  beforeEach(resetDatabase);

  it("lists online Sessions newest-first, by held-on then start time", async () => {
    const pic = await staff();
    const { a, b } = await twoSchools();
    // Insert out of order; the query is what sorts them. The two 09-12 Sessions are at different
    // Schools, since one School may hold only one online Session per day.
    await addSession({
      schoolId: a.id,
      heldOn: "2026-09-10",
      startsAt: "09:00",
    });
    await addSession({
      schoolId: b.id,
      heldOn: "2026-09-12",
      startsAt: "08:00",
    });
    await addSession({
      schoolId: a.id,
      heldOn: "2026-09-12",
      startsAt: "13:00",
    });

    const rows = await onlineSessionDirectory(pic);

    expect(rows.map((row) => `${row.heldOn} ${row.startsAt}`)).toEqual([
      "2026-09-12 13:00:00",
      "2026-09-12 08:00:00",
      "2026-09-10 09:00:00",
    ]);
  });

  it("carries the School and the status on each row (no PIC, no Peserta; #284, #318)", async () => {
    const pic = await staff();
    const school = await oneSchool();
    await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      startsAt: "09:00",
      status: "delivered",
    });

    const [row] = await onlineSessionDirectory(pic);

    expect(row?.schoolName).toBe("SMAN 1 Bandung");
    expect(row?.schoolSlug).toBe("sman-1-bandung");
    expect(row?.status).toBe("delivered");
    // No PIC on an online row any more (#284), and no Peserta (#318).
    expect(row).not.toHaveProperty("picFullName");
    expect(row).not.toHaveProperty("participantType");
  });

  /**
   * Online Sessions are always WIB (#283), not derived from the School's Province — so a School in a
   * WIT Province still reports WIB. A hardcoded-anywhere `WIB` passes the WIB-Province test above by
   * accident; this one proves the row does not read `province.time_zone`.
   */
  it("reports WIB even for a School in a non-WIB Province", async () => {
    const pic = await staff();
    await addProvince("PA", "Papua", "WIT");
    const papua = await addCluster({ slug: "cluster-papua", name: "Cluster Papua" });
    const school = await addSchool({
      slug: "sman-jayapura",
      name: "SMAN Jayapura",
      clusterId: papua.id,
      provinceCode: "PA",
    });
    await addSession({ schoolId: school.id, heldOn: "2026-09-10" });

    const [row] = await onlineSessionDirectory(pic);

    expect(row?.timeZone).toBe("WIB");
  });

  it("lists every status, including cancelled — this is the calendar, not a count", async () => {
    const pic = await staff();
    const school = await oneSchool();
    await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      status: "cancelled",
    });

    const rows = await onlineSessionDirectory(pic);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("cancelled");
  });

  it("never lists an offline Session — those belong to a Perjadin", async () => {
    const pic = await staff();
    const school = await oneSchool();
    await addSession({ schoolId: school.id, heldOn: "2026-09-10" });
    const trip = await addPerjadin({ advanceIdr: 5_000_000, picPersonId: pic.id });
    await addOfflineSession({ schoolId: school.id, heldOn: "2026-09-02", perjadinId: trip.id });

    const rows = await onlineSessionDirectory(pic);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.heldOn).toBe("2026-09-10");
  });

  it("is empty when no online Session has been scheduled", async () => {
    const pic = await staff();

    expect(await onlineSessionDirectory(pic)).toEqual([]);
  });
});
