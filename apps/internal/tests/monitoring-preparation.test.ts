import {
  addChecklistItem,
  createPreparationCard,
  deletePreparationCard,
  editPreparationCard,
  isNotGrantedError,
  preparationCards,
  removeChecklistItem,
  reorderChecklistItems,
  setChecklistItemChecked,
  type Person,
} from "@sugt/db/queries";
import type { Grant } from "@sugt/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { resetDatabase } from "./support/fixtures";

/**
 * **Monitoring Preparation — the data layer** (ticket #220, ADR-0028). The reads and the seven
 * guarded writes behind the `/monitoring` Persiapan tab's standalone Preparation Cards.
 *
 * The write callers are **hand-built** `Person`s carrying the Grant under test: the writes read
 * nothing off the caller but `role` and `grants` (that is all `requireGrant` inspects), and that
 * resolution threads a real Person's grants onto the caller is proven in `grant-foundation.test.ts`.
 * So a literal caller is a faithful stand-in here, and it is the only way to drive the guard's every
 * branch — a Monitoring Editor, an Administrator (who implies it), and a plain Staff who is refused.
 */
function caller(grants: Grant[], id = "00000000-0000-0000-0000-0000000000e1"): Person {
  return { id, fullName: "Orang", email: "orang@ditsama.itb.ac.id", role: "Staff", grants };
}

const editor = () => caller(["Monitoring Editor"]);

const A_CARD = { title: "Persiapan Teknis", jenis: "Teknis", startsOn: "2026-10-01" } as const;

describe("preparationCards read", () => {
  beforeEach(resetDatabase);

  it("returns cards with items ordered (checked, position) — unchecked first, then checked", async () => {
    const me = editor();
    const created = await createPreparationCard(me, {
      ...A_CARD,
      items: ["Satu", "Dua", "Tiga", "Empat"],
    });
    if (created.outcome !== "created") throw new Error("expected created");

    // Check the 2nd and 4th items (positions 1 and 3).
    const [card] = await preparationCards(me);
    await setChecklistItemChecked(me, card!.items[1]!.id, true);
    await setChecklistItemChecked(me, card!.items[3]!.id, true);

    const [reread] = await preparationCards(me);
    // Unchecked (positions 0, 2) first in position order, then checked (positions 1, 3) in order.
    expect(reread!.items.map((i) => [i.label, i.checked])).toEqual([
      ["Satu", false],
      ["Tiga", false],
      ["Dua", true],
      ["Empat", true],
    ]);
  });

  it("returns an empty item list for a card with no checklist", async () => {
    const me = editor();
    await createPreparationCard(me, A_CARD);
    const [card] = await preparationCards(me);
    expect(card?.items).toEqual([]);
    expect(card?.endsOn).toBeNull();
  });
});

describe("createPreparationCard", () => {
  beforeEach(resetDatabase);

  it("creates a card with initial items numbered from zero", async () => {
    const me = editor();
    const result = await createPreparationCard(me, {
      title: "  Kurikulum  ",
      jenis: "Kurikulum",
      startsOn: "2026-10-01",
      endsOn: "2026-10-10",
      items: [" A ", "B"],
    });

    expect(result.outcome).toBe("created");
    const [card] = await preparationCards(me);
    expect(card).toMatchObject({ title: "Kurikulum", jenis: "Kurikulum", endsOn: "2026-10-10" });
    expect(card!.items.map((i) => [i.label, i.position])).toEqual([
      ["A", 0],
      ["B", 1],
    ]);
  });

  it("refuses a blank title and a blank item label as values", async () => {
    const me = editor();
    expect(await createPreparationCard(me, { ...A_CARD, title: "   " })).toEqual({
      outcome: "title-required",
    });
    expect(await createPreparationCard(me, { ...A_CARD, items: ["ok", "  "] })).toEqual({
      outcome: "label-required",
    });
  });

  it("refuses more than 20 initial items", async () => {
    const me = editor();
    const items = Array.from({ length: 21 }, (_, i) => `Item ${i}`);
    expect(await createPreparationCard(me, { ...A_CARD, items })).toEqual({
      outcome: "too-many-items",
      count: 21,
      limit: 20,
    });
  });
});

describe("editing and deleting a card", () => {
  beforeEach(resetDatabase);

  it("edits a card's own fields and reports a stale id", async () => {
    const me = editor();
    const created = await createPreparationCard(me, A_CARD);
    if (created.outcome !== "created") throw new Error("expected created");

    const edited = await editPreparationCard(me, created.cardId, {
      title: "Baru",
      jenis: "LAPI",
      startsOn: "2026-11-01",
      endsOn: null,
    });
    expect(edited).toEqual({ outcome: "updated" });

    const [card] = await preparationCards(me);
    expect(card).toMatchObject({ title: "Baru", jenis: "LAPI", startsOn: "2026-11-01" });

    expect(await editPreparationCard(me, "00000000-0000-0000-0000-000000000000", A_CARD)).toEqual({
      outcome: "no-such-card",
    });
  });

  it("deletes a card and cascades its items", async () => {
    const me = editor();
    const created = await createPreparationCard(me, { ...A_CARD, items: ["a", "b"] });
    if (created.outcome !== "created") throw new Error("expected created");

    expect(await deletePreparationCard(me, created.cardId)).toEqual({ outcome: "deleted" });
    expect(await preparationCards(me)).toEqual([]);
    expect(await deletePreparationCard(me, created.cardId)).toEqual({ outcome: "no-such-card" });
  });
});

describe("checklist item writes", () => {
  beforeEach(resetDatabase);

  async function aCardWith(labels: string[]) {
    const me = editor();
    const created = await createPreparationCard(me, { ...A_CARD, items: labels });
    if (created.outcome !== "created") throw new Error("expected created");
    return created.cardId;
  }

  it("appends an item at the end and enforces the 20-item cap", async () => {
    const me = editor();
    const cardId = await aCardWith(["a"]);

    const added = await addChecklistItem(me, cardId, " b ");
    expect(added.outcome).toBe("added");
    const [card] = await preparationCards(me);
    expect(card!.items.map((i) => [i.label, i.position])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);

    // Fill to 20, then the 21st is refused.
    for (let i = card!.items.length; i < 20; i++) await addChecklistItem(me, cardId, `x${i}`);
    expect(await addChecklistItem(me, cardId, "over")).toEqual({
      outcome: "too-many-items",
      count: 20,
      limit: 20,
    });
  });

  it("refuses a blank label and a stale card", async () => {
    const me = editor();
    const cardId = await aCardWith([]);
    expect(await addChecklistItem(me, cardId, "   ")).toEqual({ outcome: "label-required" });
    expect(await addChecklistItem(me, "00000000-0000-0000-0000-000000000000", "x")).toEqual({
      outcome: "no-such-card",
    });
  });

  it("removes an item and reports a stale id", async () => {
    const me = editor();
    await aCardWith(["a", "b"]);
    const [card] = await preparationCards(me);
    const target = card!.items[0]!;

    expect(await removeChecklistItem(me, target.id)).toEqual({ outcome: "removed" });
    const [after] = await preparationCards(me);
    expect(after!.items.map((i) => i.label)).toEqual(["b"]);
    expect(await removeChecklistItem(me, target.id)).toEqual({ outcome: "no-such-item" });
  });

  it("ticks and unticks an item — both directions", async () => {
    const me = editor();
    await aCardWith(["a"]);
    const [card] = await preparationCards(me);
    const item = card!.items[0]!;

    expect(await setChecklistItemChecked(me, item.id, true)).toEqual({ outcome: "updated" });
    expect((await preparationCards(me))[0]!.items[0]!.checked).toBe(true);

    expect(await setChecklistItemChecked(me, item.id, false)).toEqual({ outcome: "updated" });
    expect((await preparationCards(me))[0]!.items[0]!.checked).toBe(false);

    expect(await setChecklistItemChecked(me, "00000000-0000-0000-0000-000000000000", true)).toEqual(
      { outcome: "no-such-item" },
    );
  });

  it("reorders the unchecked items to the given order", async () => {
    const me = editor();
    await aCardWith(["a", "b", "c"]);
    const [card] = await preparationCards(me);
    const [a, b, c] = card!.items;

    // New order c, a, b.
    expect(await reorderChecklistItems(me, card!.id, [c!.id, a!.id, b!.id])).toEqual({
      outcome: "reordered",
    });
    const [reread] = await preparationCards(me);
    expect(reread!.items.map((i) => i.label)).toEqual(["c", "a", "b"]);
  });
});

describe("Monitoring Preparation writes are Monitoring-Editor-guarded", () => {
  beforeEach(resetDatabase);

  it("refuses a Staff Person without the Grant, with a distinguishable typed error", async () => {
    const plain = caller([]);
    const refusal = await createPreparationCard(plain, A_CARD).catch((error: unknown) => error);
    expect(isNotGrantedError(refusal)).toBe(true);
  });

  it("lets an Administrator write — Administrator implies Monitoring Editor", async () => {
    const admin = caller(["Administrator"]);
    expect((await createPreparationCard(admin, A_CARD)).outcome).toBe("created");
  });

  it("refuses a Pimpinan any write, whatever grants a row might carry", async () => {
    const pimpinan: Person = {
      id: "00000000-0000-0000-0000-0000000000f1",
      fullName: "Bapak",
      email: "pimpinan@ditsama.itb.ac.id",
      role: "Pimpinan",
      grants: ["Monitoring Editor"],
    };
    const refusal = await createPreparationCard(pimpinan, A_CARD).catch((error: unknown) => error);
    expect(isNotGrantedError(refusal)).toBe(true);
  });
});
