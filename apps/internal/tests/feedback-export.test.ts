import { GET as exportPerjadin } from "-/app/(app)/feedback/ekspor/perjadin/route";
import { GET as exportPeserta } from "-/app/(app)/feedback/ekspor/peserta/route";
import { participantExportHref, perjadinExportHref } from "-/app/(app)/feedback/feedback-params";
import { formatWibDate } from "-/lib/format-wib";
import { requirePerson } from "-/lib/person";
import {
  DEFAULT_FEEDBACK_SORT,
  NO_FEEDBACK_FILTERS,
  NO_PARTICIPANT_FEEDBACK_SCOPE,
  NO_PERJADIN_FEEDBACK_FILTERS,
  NO_PERJADIN_FEEDBACK_SCOPE,
  participantFeedbackExport,
  participantFeedbackPage,
  perjadinFeedbackExport,
  perjadinFeedbackPage,
  type FeedbackFilters,
  type FeedbackSort,
  type ParticipantFeedbackScope,
  type Person,
  type PerjadinFeedbackFilters,
  type PerjadinFeedbackScope,
} from "@sugt/db/queries";
import type { ClassKind, PerjadinEvaluationRole } from "@sugt/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseCsv } from "./support/csv";
import {
  addCluster,
  addParticipantFeedback,
  addPerjadin,
  addPerjadinEvaluation,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  resetDatabase,
} from "./support/fixtures";

/**
 * **`/feedback`'s export is the screen's list, whole** (#490). For a spread of scopes, score
 * filters and sorts, each tab's export holds exactly the rows its pages hold when walked to the
 * end, in the same order — more rows than one page, so "every page" is tested, not just the first.
 * The two route handlers turn the link the tab builds into that file, named for its choices.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));

let viewer: Person;

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  viewer = (await addPerson({
    fullName: "Rina",
    email: "rina@ditsama.itb.ac.id",
    role: "Staff",
  })) as Person;
  vi.mocked(requirePerson).mockResolvedValue(viewer);
});

/** The file as sent, BOM included — `Response.text()` would strip it. */
async function body(response: Response) {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
}

/** A rating from 1 to 10 that varies with `index`, so the rows spread across both sides of 7. */
const score = (index: number, salt: number) => ((index * 7 + salt * 3) % 10) + 1;

/** Two Schools, three delivered Sessions, 27 submissions across all three Classes. */
async function participantFeedback() {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const schools = [];
  for (const [slug, name] of [
    ["sman-1", "SMAN 1 Bandung"],
    ["sman-2", "SMAN 2 Bandung"],
  ] as const) {
    schools.push(await addSchool({ slug, name, clusterId: cluster.id, provinceCode: "JB" }));
  }
  const sessions = [
    await addSession({ schoolId: schools[0]!.id, heldOn: "2026-09-10", status: "delivered" }),
    await addSession({ schoolId: schools[0]!.id, heldOn: "2026-09-17", status: "delivered" }),
    await addSession({ schoolId: schools[1]!.id, heldOn: "2026-09-11", status: "delivered" }),
  ];
  const classes: ClassKind[] = ["Student", "GTK", "MS"];
  for (let index = 0; index < 27; index += 1) {
    const classKind = classes[index % 3]!;
    await addParticipantFeedback({
      sessionId: sessions[index % 3]!.id,
      classKind,
      name: `Peserta ${index}`,
      ratings: {
        materials: score(index, 1),
        instructor: score(index, 2),
        // Every fourth pair ties on the average, so the date tiebreak orders it.
        relevance: index % 4 === 0 ? score(index, 1) : score(index, 3),
        handsOnRbl: classKind === "Student" && index % 2 === 0 ? score(index, 4) : null,
      },
      submittedAt: new Date(Date.UTC(2026, 8, 20, index)),
    });
  }
  return { schools, sessions };
}

/** Two trips, 23 evaluations from all three Peran, some with no Penginapan. */
async function perjadinEvaluations() {
  const pic = await addPerson({ fullName: "Andi", email: "andi@itb.ac.id", role: "Staff" });
  const trips = [
    await addPerjadin({ picPersonId: pic.id, startsOn: "2026-09-01", endsOn: "2026-09-03" }),
    await addPerjadin({ picPersonId: pic.id, startsOn: "2026-09-08", endsOn: "2026-09-08" }),
  ];
  const roles: PerjadinEvaluationRole[] = ["Narasumber", "Pendamping", "Pimpinan"];
  for (let index = 0; index < 23; index += 1) {
    const role = roles[index % 3]!;
    await addPerjadinEvaluation({
      perjadinId: trips[index % 2]!.id,
      role,
      name: `Pengisi ${index}`,
      lodging: index % 2 === 1 ? null : score(index, 1),
      ratings: {
        transport: score(index, 2),
        meals: score(index, 3),
        punctuality: score(index, 4),
      },
      pendampingSupport: role === "Pendamping" ? null : score(index, 5),
      createdAt: new Date(Date.UTC(2026, 8, 20, index)),
    });
  }
  return { trips };
}

/** Every Peserta page, walked to the end, as ids. */
async function allParticipantPages(view: {
  filters: FeedbackFilters;
  scope: ParticipantFeedbackScope;
  sort: FeedbackSort;
}) {
  const ids: string[] = [];
  let cursor: number | null = null;
  do {
    const page = await participantFeedbackPage(viewer, { ...view, cursor });
    ids.push(...page.rows.map((row) => row.id));
    cursor = page.nextCursor;
  } while (cursor !== null);
  return ids;
}

/** Every Perjadin page, walked to the end, as ids. */
async function allPerjadinPages(view: {
  filters: PerjadinFeedbackFilters;
  scope: PerjadinFeedbackScope;
  sort: FeedbackSort;
}) {
  const ids: string[] = [];
  let cursor: number | null = null;
  do {
    const page = await perjadinFeedbackPage(viewer, { ...view, cursor });
    ids.push(...page.rows.map((row) => row.id));
    cursor = page.nextCursor;
  } while (cursor !== null);
  return ids;
}

describe("the export holds what every page holds, in the screen's order", () => {
  it("on the Peserta tab, for each scope, filter and sort", async () => {
    const { schools, sessions } = await participantFeedback();
    const views = [
      {
        scope: NO_PARTICIPANT_FEEDBACK_SCOPE,
        filters: NO_FEEDBACK_FILTERS,
        sort: DEFAULT_FEEDBACK_SORT,
      },
      {
        scope: NO_PARTICIPANT_FEEDBACK_SCOPE,
        filters: { ...NO_FEEDBACK_FILTERS, reviewType: "le7" as const },
        sort: { score: "desc" as const, date: "asc" as const },
      },
      {
        scope: { schoolId: schools[0]!.id, sessionId: null, participantType: "Siswa" as const },
        filters: NO_FEEDBACK_FILTERS,
        sort: DEFAULT_FEEDBACK_SORT,
      },
      {
        scope: { schoolId: schools[0]!.id, sessionId: sessions[1]!.id, participantType: null },
        filters: { ...NO_FEEDBACK_FILTERS, materials: "gt7" as const },
        sort: { score: "asc" as const, date: "asc" as const },
      },
      {
        scope: { ...NO_PARTICIPANT_FEEDBACK_SCOPE, participantType: "GTK-MS" as const },
        filters: { ...NO_FEEDBACK_FILTERS, handsOnRbl: "gt7" as const },
        sort: DEFAULT_FEEDBACK_SORT,
      },
    ];

    const sizes = [];
    for (const view of views) {
      const exported = await participantFeedbackExport(viewer, view);
      expect(exported.map((row) => row.id)).toEqual(await allParticipantPages(view));
      sizes.push(exported.length);
    }
    // More than one page unfiltered, and the scopes and filters really narrow.
    expect(sizes[0]).toBe(27);
    expect(sizes.slice(1).every((size) => size < 27)).toBe(true);
    expect(sizes[4]).toBe(0);
  });

  it("on the Perjadin tab, for each scope, filter and sort", async () => {
    const { trips } = await perjadinEvaluations();
    const views = [
      {
        scope: NO_PERJADIN_FEEDBACK_SCOPE,
        filters: NO_PERJADIN_FEEDBACK_FILTERS,
        sort: DEFAULT_FEEDBACK_SORT,
      },
      {
        scope: { perjadinId: trips[0]!.id, role: null },
        filters: { ...NO_PERJADIN_FEEDBACK_FILTERS, lodging: "le7" as const },
        sort: { score: "desc" as const, date: "desc" as const },
      },
      {
        scope: { perjadinId: null, role: "Pimpinan" as const },
        filters: { ...NO_PERJADIN_FEEDBACK_FILTERS, pendampingSupport: "gt7" as const },
        sort: { score: "asc" as const, date: "asc" as const },
      },
    ];

    const sizes = [];
    for (const view of views) {
      const exported = await perjadinFeedbackExport(viewer, view);
      expect(exported.map((row) => row.id)).toEqual(await allPerjadinPages(view));
      sizes.push(exported.length);
    }
    expect(sizes[0]).toBe(23);
    expect(sizes.slice(1).every((size) => size > 0 && size < 23)).toBe(true);
  });
});

describe("the routes", () => {
  it("download the Peserta tab's choices as its CSV, named for them", async () => {
    const { schools } = await participantFeedback();
    const view = {
      scope: { schoolId: schools[1]!.id, sessionId: null, participantType: null },
      filters: { ...NO_FEEDBACK_FILTERS, reviewType: "le7" as const },
      sort: { score: "desc" as const, date: "asc" as const },
    };

    const response = await exportPeserta(
      new Request(`http://localhost${participantExportHref(view)}`),
    );

    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="feedback-peserta-sman-2-bandung-tersaring-${formatWibDate(new Date())}.csv"`,
    );
    const [header, ...lines] = parseCsv(await body(response));
    expect(header![4]).toBe("Nama");
    const expected = await participantFeedbackExport(viewer, view);
    expect(expected.length).toBeGreaterThan(0);
    expect(lines.map((line) => line[4])).toEqual(expected.map((row) => row.name));
    expect(lines.every((line) => line[1] === "SMAN 2 Bandung")).toBe(true);
  });

  it("download the Perjadin tab's choices as its CSV, and everything with no query", async () => {
    await perjadinEvaluations();

    const response = await exportPerjadin(new Request("http://localhost/feedback/ekspor/perjadin"));

    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="feedback-perjadin-semua-${formatWibDate(new Date())}.csv"`,
    );
    const [, ...lines] = parseCsv(await body(response));
    expect(lines).toHaveLength(23);
    // Lowest average first, the default sort.
    const averages = lines.map((line) => Number(line[14]));
    expect(averages).toEqual(averages.toSorted((a, b) => a - b));
    // A missing Penginapan is an empty cell, never 0.
    expect(lines.some((line) => line[4] === "")).toBe(true);
    expect(lines.some((line) => line[4] === "0")).toBe(false);

    const filtered = await exportPerjadin(
      new Request(
        `http://localhost${perjadinExportHref({
          scope: { perjadinId: null, role: "Pendamping" },
          filters: NO_PERJADIN_FEEDBACK_FILTERS,
          sort: DEFAULT_FEEDBACK_SORT,
        })}`,
      ),
    );
    const [, ...pendamping] = parseCsv(await body(filtered));
    expect(pendamping.length).toBeGreaterThan(0);
    expect(pendamping.every((line) => line[2] === "Pendamping" && line[12] === "")).toBe(true);
  });

  it("send whoever is not signed in to sign in, as the page does, and read nothing", async () => {
    vi.mocked(requirePerson).mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(
      exportPeserta(new Request("http://localhost/feedback/ekspor/peserta")),
    ).rejects.toThrow("NEXT_REDIRECT");
    await expect(
      exportPerjadin(new Request("http://localhost/feedback/ekspor/perjadin")),
    ).rejects.toThrow("NEXT_REDIRECT");
  });
});
