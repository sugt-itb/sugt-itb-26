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
  setChecklistItemJenis,
  type Person,
} from "@sugt/db/queries";
import type { Grant, PreparationJenis } from "@sugt/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { resetDatabase } from "./support/fixtures";

/**
 * **Preparation Cards — the data layer** (ticket #220, ADR-0028; Jenis moved onto each item in #292).
 * The reads and the eight guarded writes behind the Dashboard (`/`) Persiapan tab's standalone cards.
 *
 * The write callers are **hand-built** `Person`s carrying the Grant under test: the writes read
 * nothing off the caller but `role` and `grants` (that is all `requireGrant` inspects), and that
 * resolution threads a real Person's grants onto the caller is proven in `grant-foundation.test.ts`.
 * So a literal caller is a faithful stand-in here, and it is the only way to drive the guard's every
 * branch — an Editor, an Administrator (who implies it), and a plain Staff who is refused.
 */
function caller(grants: Grant[], id = "00000000-0000-0000-0000-0000000000e1"): Person {
  return { id, fullName: "Orang", email: "orang@ditsama.itb.ac.id", role: "Staff", grants };
}

const editor = () => caller(["Editor"]);

const A_CARD = { title: "Persiapan Teknis", startsOn: "2026-10-01" } as const;

/** Turn plain labels into `{ label, jenis }` items — all "Teknis" unless a case needs otherwise. */
function labeled(labels: string[], jenis: PreparationJenis = "Teknis") {
  return labels.map((label) => ({ label, jenis }));
}

describe("preparationCards read", () => {
  beforeEach(resetDatabase);

  it("returns cards with items ordered (checked, position) — unchecked first, then checked", async () => {
    const me = editor();
    const created = await createPreparationCard(me, {
      ...A_CARD,
      items: labeled(["Satu", "Dua", "Tiga", "Empat"]),
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
    // A Card carries no Jenis of its own since #292 — the category is per item.
    expect(card).not.toHaveProperty("jenis");
  });
});

describe("createPreparationCard", () => {
  beforeEach(resetDatabase);

  it("creates a card with initial items numbered from zero, each carrying its own Jenis", async () => {
    const me = editor();
    const result = await createPreparationCard(me, {
      title: "  Kurikulum  ",
      startsOn: "2026-10-01",
      endsOn: "2026-10-10",
      items: [
        { label: " A ", jenis: "Kurikulum" },
        { label: "B", jenis: "LAPI" },
      ],
    });

    expect(result.outcome).toBe("created");
    const [card] = await preparationCards(me);
    expect(card).toMatchObject({ title: "Kurikulum", endsOn: "2026-10-10" });
    expect(card).not.toHaveProperty("jenis");
    expect(card!.items.map((i) => [i.label, i.position, i.jenis])).toEqual([
      ["A", 0, "Kurikulum"],
      ["B", 1, "LAPI"],
    ]);
  });

  it("refuses a blank title and a blank item label as values", async () => {
    const me = editor();
    expect(await createPreparationCard(me, { ...A_CARD, title: "   " })).toEqual({
      outcome: "title-required",
    });
    expect(await createPreparationCard(me, { ...A_CARD, items: labeled(["ok", "  "]) })).toEqual({
      outcome: "label-required",
    });
  });

  it("refuses more than 20 initial items", async () => {
    const me = editor();
    const items = labeled(Array.from({ length: 21 }, (_, i) => `Item ${i}`));
    expect(await createPreparationCard(me, { ...A_CARD, items })).toEqual({
      outcome: "too-many-items",
      count: 21,
      limit: 20,
    });
  });
});

describe("editing and deleting a card", () => {
  beforeEach(resetDatabase);

  it("edits a card's own fields (title and dates) and reports a stale id", async () => {
    const me = editor();
    const created = await createPreparationCard(me, {
      ...A_CARD,
      items: labeled(["Undang narasumber"], "LAPI"),
    });
    if (created.outcome !== "created") throw new Error("expected created");

    const edited = await editPreparationCard(me, created.cardId, {
      title: "Baru",
      startsOn: "2026-11-01",
      endsOn: null,
    });
    expect(edited).toEqual({ outcome: "updated" });

    const [card] = await preparationCards(me);
    expect(card).toMatchObject({ title: "Baru", startsOn: "2026-11-01" });
    // Editing card fields leaves each item's Jenis untouched — the edit path never writes it.
    expect(card!.items.map((i) => i.jenis)).toEqual(["LAPI"]);

    expect(await editPreparationCard(me, "00000000-0000-0000-0000-000000000000", A_CARD)).toEqual({
      outcome: "no-such-card",
    });
  });

  it("deletes a card and cascades its items", async () => {
    const me = editor();
    const created = await createPreparationCard(me, { ...A_CARD, items: labeled(["a", "b"]) });
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
    const created = await createPreparationCard(me, { ...A_CARD, items: labeled(labels) });
    if (created.outcome !== "created") throw new Error("expected created");
    return created.cardId;
  }

  it("appends an item with its Jenis at the end and enforces the 20-item cap", async () => {
    const me = editor();
    const cardId = await aCardWith(["a"]);

    const added = await addChecklistItem(me, cardId, " b ", "Pimpinan");
    expect(added.outcome).toBe("added");
    const [card] = await preparationCards(me);
    expect(card!.items.map((i) => [i.label, i.position, i.jenis])).toEqual([
      ["a", 0, "Teknis"],
      ["b", 1, "Pimpinan"],
    ]);

    // Fill to 20, then the 21st is refused.
    for (let i = card!.items.length; i < 20; i++)
      await addChecklistItem(me, cardId, `x${i}`, "Teknis");
    expect(await addChecklistItem(me, cardId, "over", "Teknis")).toEqual({
      outcome: "too-many-items",
      count: 20,
      limit: 20,
    });
  });

  it("refuses a blank label and a stale card", async () => {
    const me = editor();
    const cardId = await aCardWith([]);
    expect(await addChecklistItem(me, cardId, "   ", "Teknis")).toEqual({
      outcome: "label-required",
    });
    expect(
      await addChecklistItem(me, "00000000-0000-0000-0000-000000000000", "x", "Teknis"),
    ).toEqual({ outcome: "no-such-card" });
  });

  it("sets an item's Jenis and reports a stale id", async () => {
    const me = editor();
    await aCardWith(["a"]);
    const [card] = await preparationCards(me);
    const item = card!.items[0]!;
    expect(item.jenis).toBe("Teknis");

    expect(await setChecklistItemJenis(me, item.id, "Kurikulum")).toEqual({ outcome: "updated" });
    expect((await preparationCards(me))[0]!.items[0]!.jenis).toBe("Kurikulum");

    expect(await setChecklistItemJenis(me, "00000000-0000-0000-0000-000000000000", "LAPI")).toEqual(
      { outcome: "no-such-item" },
    );
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

  it("leaves a checked item in place — a checked id in the order list is ignored", async () => {
    const me = editor();
    const created = await createPreparationCard(me, {
      ...A_CARD,
      items: labeled(["a", "b", "c", "d"]),
    });
    if (created.outcome !== "created") throw new Error("expected created");
    const [card] = await preparationCards(me);
    const [a, b, c, d] = card!.items;
    // Check b — it must keep its position and stay after every unchecked item.
    await setChecklistItemChecked(me, b!.id, true);

    // Reorder the unchecked items to d, c, a; b's id is passed too and must be ignored (the batched
    // UPDATE's `checked = false` guard drops it), not written to position 3.
    expect(await reorderChecklistItems(me, card!.id, [d!.id, c!.id, a!.id, b!.id])).toEqual({
      outcome: "reordered",
    });

    const [reread] = await preparationCards(me);
    expect(reread!.items.map((i) => [i.label, i.checked])).toEqual([
      ["d", false],
      ["c", false],
      ["a", false],
      ["b", true],
    ]);
  });

  it("ignores a stale id and an id belonging to another card", async () => {
    const me = editor();
    const created = await createPreparationCard(me, { ...A_CARD, items: labeled(["a", "b", "c"]) });
    if (created.outcome !== "created") throw new Error("expected created");
    // A second card whose item the first card's reorder must not touch (the `card_id` guard).
    await createPreparationCard(me, { ...A_CARD, title: "Lain", items: labeled(["x"]) });
    const cards = await preparationCards(me);
    const target = cards.find((cd) => cd.title === A_CARD.title)!;
    const other = cards.find((cd) => cd.title === "Lain")!;
    const [a, b, c] = target.items;

    // Mix a stale uuid and the other card's item id into the order — both ignored; only this card's
    // unchecked items reorder.
    expect(
      await reorderChecklistItems(me, target.id, [
        c!.id,
        "00000000-0000-0000-0000-000000000000",
        a!.id,
        other.items[0]!.id,
        b!.id,
      ]),
    ).toEqual({ outcome: "reordered" });

    const reread = await preparationCards(me);
    expect(reread.find((cd) => cd.title === A_CARD.title)!.items.map((i) => i.label)).toEqual([
      "c",
      "a",
      "b",
    ]);
    // The other card's item is untouched — same label at the same position.
    expect(
      reread.find((cd) => cd.title === "Lain")!.items.map((i) => [i.label, i.position]),
    ).toEqual([["x", 0]]);
  });
});

describe("Preparation Card writes are Editor-guarded", () => {
  beforeEach(resetDatabase);

  it("refuses a Staff Person without the Grant, with a distinguishable typed error", async () => {
    const plain = caller([]);
    const refusal = await createPreparationCard(plain, A_CARD).catch((error: unknown) => error);
    expect(isNotGrantedError(refusal)).toBe(true);
  });

  it("refuses setChecklistItemJenis to a Staff Person without the Grant", async () => {
    const me = editor();
    const created = await createPreparationCard(me, { ...A_CARD, items: labeled(["a"]) });
    if (created.outcome !== "created") throw new Error("expected created");
    const [card] = await preparationCards(me);

    const plain = caller([]);
    const refusal = await setChecklistItemJenis(plain, card!.items[0]!.id, "LAPI").catch(
      (error: unknown) => error,
    );
    expect(isNotGrantedError(refusal)).toBe(true);
  });

  it("lets an Administrator write — Administrator implies Editor", async () => {
    const admin = caller(["Administrator"]);
    expect((await createPreparationCard(admin, A_CARD)).outcome).toBe("created");
  });

  it("refuses a Pimpinan any write, whatever grants a row might carry", async () => {
    const pimpinan: Person = {
      id: "00000000-0000-0000-0000-0000000000f1",
      fullName: "Bapak",
      email: "pimpinan@ditsama.itb.ac.id",
      role: "Pimpinan",
      grants: ["Editor"],
    };
    const refusal = await createPreparationCard(pimpinan, A_CARD).catch((error: unknown) => error);
    expect(isNotGrantedError(refusal)).toBe(true);
  });
});
