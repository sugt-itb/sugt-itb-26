import { db, schema } from "@sugt/db";
import {
  addPerjadinTeacher,
  isNotStaffError,
  perjadinDetail,
  perjadinDirectory,
  removePerjadinTeacher,
  renamePerjadinTeacher,
  togglePreparationItem,
} from "@sugt/db/queries";
import type { Role } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { addPerjadin, addPerson, resetDatabase } from "./support/fixtures";

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more — but the Staff-only choke point still has to
 * reject a non-Staff caller, and `requireStaff` throws on the role alone, before it touches the
 * row. The cast through `unknown` is the only way to name a role the type no longer admits.
 */
function nonStaff() {
  return {
    id: "00000000-0000-0000-0000-000000000009",
    fullName: "Budi Santoso",
    email: "budi@gmail.com",
    role: "Teaching Team" as unknown as Role,
    grants: [],
  };
}

/**
 * **The Preparation Checklist** ([#114](https://github.com/mafiefa02/sugt/issues/114)).
 *
 * Since the amendment to ADR-0018 the *set of items* is a **flat fixed seven** — the six original
 * boxes plus `pengajar_lengkap` — derived at read time with no per-member part, so `N = 7` for every
 * Perjadin and the derivation never reads the Group. Only the ticks are stored. The interesting
 * behaviour is therefore the one automatic un-tick in the whole system: any Teaching-Team change
 * clears `pengajar_lengkap`, and that is not reachable through a test that only reads back what it
 * wrote. Each block drives the query functions against a real Postgres.
 */

async function trip() {
  const pic = await addPerson({
    fullName: "Rina Nurhayati",
    email: "rina@ditsama.itb.ac.id",
    role: "Staff",
  });
  const perjadin = await addPerjadin({ advanceIdr: 5_000_000, picPersonId: pic.id });
  return { pic, perjadinId: perjadin.id };
}

/** The stored ticks for one Perjadin, straight from the table — orphans included. */
async function ticksOf(perjadinId: string) {
  return db
    .select({
      itemKey: schema.perjadinPreparationItem.itemKey,
      checkedBy: schema.perjadinPreparationItem.checkedBy,
      checkedAt: schema.perjadinPreparationItem.checkedAt,
    })
    .from(schema.perjadinPreparationItem)
    .where(eq(schema.perjadinPreparationItem.perjadinId, perjadinId));
}

async function pillOf(caller: Parameters<typeof perjadinDirectory>[0], perjadinId: string) {
  const trips = await perjadinDirectory(caller);
  return trips.find((row) => row.id === perjadinId);
}

/** The seven fixed keys, in render order — `pengajar_lengkap` last. */
const FIXED_KEYS = [
  "sk_perjalanan",
  "tiket_keberangkatan",
  "tiket_kepulangan",
  "booking_penginapan",
  "transportasi_lokal",
  "staff",
  "pengajar_lengkap",
];

describe("the derived checklist", () => {
  beforeEach(resetDatabase);

  it("is the seven fixed items, in order, none ticked at first — regardless of team size", async () => {
    const { pic, perjadinId } = await trip();
    // A team of any size adds no boxes: the derivation no longer reads the Teaching Team.
    await addPerjadinTeacher(pic, perjadinId, "Prof. Satu");
    await addPerjadinTeacher(pic, perjadinId, "Prof. Dua");

    const items = (await perjadinDetail(pic, perjadinId))?.preparation ?? [];

    expect(items.map((item) => item.itemKey)).toEqual(FIXED_KEYS);
    expect(items.find((item) => item.itemKey === "pengajar_lengkap")?.label).toBe(
      "Pengajar sudah lengkap",
    );
    expect(items).toHaveLength(7);
    expect(items.every((item) => !item.checked)).toBe(true);
  });

  it("counts N as 7 and x as the fixed ticks, ignoring an orphan `dosen:` tick from the old model", async () => {
    const { pic, perjadinId } = await trip();

    await togglePreparationItem(pic, { perjadinId, itemKey: "staff", checked: true });
    await togglePreparationItem(pic, { perjadinId, itemKey: "pengajar_lengkap", checked: true });
    // A leftover per-teacher tick from before the redefinition. No item derives it, so it must not
    // count — and it is left in the table, not cleaned up (ADR-0018).
    await db.insert(schema.perjadinPreparationItem).values({
      perjadinId,
      itemKey: `dosen:${pic.id}`,
      checkedBy: pic.id,
    });

    const pill = await pillOf(pic, perjadinId);
    expect(pill?.preparationTotal).toBe(7);
    expect(pill?.preparationDone).toBe(2);

    const detail = await perjadinDetail(pic, perjadinId);
    expect(detail?.preparation.some((item) => item.itemKey.startsWith("dosen:"))).toBe(false);
    expect(detail?.preparation.filter((item) => item.checked).map((item) => item.itemKey)).toEqual([
      "staff",
      "pengajar_lengkap",
    ]);
    // And the orphan row is left in the table, not cleaned up (ADR-0018) — nothing ever deletes it.
    expect((await ticksOf(perjadinId)).map((tick) => tick.itemKey)).toContain(`dosen:${pic.id}`);
  });
});

describe("the one automatic un-tick — Pengajar sudah lengkap", () => {
  beforeEach(resetDatabase);

  async function tickPengajarLengkap(
    pic: Parameters<typeof togglePreparationItem>[0],
    perjadinId: string,
  ) {
    await togglePreparationItem(pic, { perjadinId, itemKey: "pengajar_lengkap", checked: true });
    expect((await ticksOf(perjadinId)).map((tick) => tick.itemKey)).toContain("pengajar_lengkap");
  }

  it("clears when a Teaching-Team name is added", async () => {
    const { pic, perjadinId } = await trip();
    await tickPengajarLengkap(pic, perjadinId);

    await addPerjadinTeacher(pic, perjadinId, "Prof. Baru");

    expect((await ticksOf(perjadinId)).map((tick) => tick.itemKey)).not.toContain(
      "pengajar_lengkap",
    );
  });

  it("clears when a Teaching-Team name is renamed", async () => {
    const { pic, perjadinId } = await trip();
    const added = await addPerjadinTeacher(pic, perjadinId, "Prof. Lama");
    if (added.outcome !== "added") throw new Error("fixture failed to add a teacher");
    await tickPengajarLengkap(pic, perjadinId);

    await renamePerjadinTeacher(pic, added.teacherId, "Prof. Baru");

    expect((await ticksOf(perjadinId)).map((tick) => tick.itemKey)).not.toContain(
      "pengajar_lengkap",
    );
  });

  it("clears when a Teaching-Team name is removed", async () => {
    const { pic, perjadinId } = await trip();
    const added = await addPerjadinTeacher(pic, perjadinId, "Prof. Pergi");
    if (added.outcome !== "added") throw new Error("fixture failed to add a teacher");
    await tickPengajarLengkap(pic, perjadinId);

    await removePerjadinTeacher(pic, added.teacherId);

    expect((await ticksOf(perjadinId)).map((tick) => tick.itemKey)).not.toContain(
      "pengajar_lengkap",
    );
  });

  it("leaves the other six boxes alone when the team changes", async () => {
    const { pic, perjadinId } = await trip();
    await togglePreparationItem(pic, { perjadinId, itemKey: "staff", checked: true });
    await togglePreparationItem(pic, { perjadinId, itemKey: "booking_penginapan", checked: true });

    await addPerjadinTeacher(pic, perjadinId, "Prof. Baru");

    // Only `pengajar_lengkap` is ever cleared automatically; the rest are untouched.
    expect((await ticksOf(perjadinId)).map((tick) => tick.itemKey).sort()).toEqual([
      "booking_penginapan",
      "staff",
    ]);
  });
});

describe("toggling a box", () => {
  beforeEach(resetDatabase);

  it("writes a row with checkedBy and checkedAt on tick, and deletes it on un-tick", async () => {
    const { pic, perjadinId } = await trip();

    await togglePreparationItem(pic, { perjadinId, itemKey: "staff", checked: true });
    const [row] = await ticksOf(perjadinId);
    expect(row?.itemKey).toBe("staff");
    expect(row?.checkedBy).toBe(pic.id);
    expect(row?.checkedAt).not.toBeNull();

    await togglePreparationItem(pic, { perjadinId, itemKey: "staff", checked: false });
    expect(await ticksOf(perjadinId)).toEqual([]);
  });

  it("is idempotent both ways — a second tick is one row, a second un-tick is a no-op", async () => {
    const { pic, perjadinId } = await trip();

    await togglePreparationItem(pic, { perjadinId, itemKey: "booking_penginapan", checked: true });
    await togglePreparationItem(pic, { perjadinId, itemKey: "booking_penginapan", checked: true });
    // The composite primary key upserts, so ticking twice is one row rather than a key violation.
    expect(await ticksOf(perjadinId)).toHaveLength(1);

    await togglePreparationItem(pic, { perjadinId, itemKey: "booking_penginapan", checked: false });
    await togglePreparationItem(pic, { perjadinId, itemKey: "booking_penginapan", checked: false });
    expect(await ticksOf(perjadinId)).toEqual([]);
  });

  it("records the Staff member who most recently ticked it", async () => {
    const { pic, perjadinId } = await trip();
    const other = await addPerson({
      fullName: "Dewi Lestari",
      email: "dewi@ditsama.itb.ac.id",
      role: "Staff",
    });

    await togglePreparationItem(pic, { perjadinId, itemKey: "staff", checked: true });
    await togglePreparationItem(other, { perjadinId, itemKey: "staff", checked: true });

    const [row] = await ticksOf(perjadinId);
    expect(row?.checkedBy).toBe(other.id);
  });

  it("refuses a non-Staff caller", async () => {
    const { perjadinId } = await trip();
    // T3 (#153) retired the Teaching Team Role, so no non-Staff Person can be invited; the
    // Staff-only gate is still proven with a hand-built non-Staff caller.
    const bagus = nonStaff();

    await expect(
      togglePreparationItem(bagus, { perjadinId, itemKey: "staff", checked: true }),
    ).rejects.toSatisfy(isNotStaffError);
    // And nothing was written, so the refusal is before the row, not after.
    expect(await ticksOf(perjadinId)).toEqual([]);
  });
});
