import { staffSurface } from "-/lib/staff-surface";
import { filePerjadinReport, isNotStaffError, perjadinAcquittal } from "@sugt/db/queries";
import type { Role } from "@sugt/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addPerjadin, addTransaction, resetDatabase } from "./support/fixtures";
import { signInAsPerson } from "./support/sign-in";

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more — but the choke point must still reject a
 * non-Staff caller from a money **write**, which is the whole of what this file proves. `requireStaff`
 * throws on the role alone, before the write query touches a row, so a cast object is a faithful
 * stand-in; the cast through `unknown` is the only way to name a role the type no longer admits.
 */
function nonStaff() {
  return {
    id: "00000000-0000-0000-0000-000000000009",
    fullName: "Budi Santoso",
    email: "budi@gmail.com",
    role: "Teaching Team" as unknown as Role,
  };
}

/**
 * **The Staff-only choke point**, driven at the seam
 * [#24](https://github.com/mafiefa02/sugt/issues/24) established.
 *
 * The `Person` handed to the money query is a real one, and that is the point of
 * running this here rather than as a unit test on the guard: sign in through seam 1,
 * take the `Set-Cookie`, resolve it through seam 2, hand the result to the query.
 * Nothing asserts that a particular helper ran — that is the kind of test a Better
 * Auth upgrade breaks without breaking the product.
 *
 * The boundary the choke point now holds is **read (any signed-in Person) vs write (Staff)**:
 * ADR-0004 kept money reads to Staff, and [ADR-0026](../../../docs/adr/0026-money-is-open-to-read-and-staff-only-to-write.md)
 * (#180) reversed that half, so what this file drives at the seam is a money **write** —
 * `filePerjadinReport` — while `perjadinAcquittal` reads open to everyone.
 */
describe("money writes are Staff-only", () => {
  beforeEach(resetDatabase);
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** A Perjadin with an Advance and one line item against it. */
  async function aPerjadinWithSpending() {
    const pic = await signInAsPerson("Staff", "rina@ditsama.itb.ac.id", "Rina Nurhayati");
    const perjadin = await addPerjadin({ advanceIdr: 5_000_000, picPersonId: pic.id });
    await addTransaction({
      perjadinId: perjadin.id,
      amountIdr: 1_250_000,
      createdByPersonId: pic.id,
    });
    return { pic, perjadin };
  }

  it("refuses a non-Staff Person a money write with a distinguishable typed error", async () => {
    const { perjadin } = await aPerjadinWithSpending();
    const teacher = nonStaff();

    const refusal = await filePerjadinReport(teacher, perjadin.id).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
  });

  it("refuses a write with a throw rather than a value outcome", async () => {
    /**
     * A refused caller is a bug or an attack, never a user state, so `requireStaff` throws
     * before the write can return one of its reachable value outcomes (`filed`,
     * `no-such-perjadin`, …). This asserts the refusal is not quietly one of those.
     */
    const { perjadin } = await aPerjadinWithSpending();
    const teacher = nonStaff();

    await expect(filePerjadinReport(teacher, perjadin.id)).rejects.toThrow();
  });

  it("opens the money READ to any signed-in Person now (ADR-0026, #180)", async () => {
    /**
     * The other half of the read/write split. `perjadinAcquittal` lost its `requireStaff`, so a
     * non-Staff caller reads the acquittal rather than being refused it — the read is open, and
     * only the write above stays Staff-only.
     */
    const { perjadin } = await aPerjadinWithSpending();

    await expect(perjadinAcquittal(nonStaff(), perjadin.id)).resolves.toMatchObject({
      spentIdr: 1_250_000,
    });
  });

  it("gives Staff the reconciliation, derived rather than stored", async () => {
    const { pic, perjadin } = await aPerjadinWithSpending();

    await expect(perjadinAcquittal(pic, perjadin.id)).resolves.toMatchObject({
      perjadinId: perjadin.id,
      advanceIdr: 5_000_000,
      spentIdr: 1_250_000,
      remainderIdr: 3_750_000,
      returnedToTreasurerIdr: null,
    });
  });

  it("reads a Perjadin that has spent nothing as zero, not as unknown", async () => {
    const pic = await signInAsPerson("Staff", "rina@ditsama.itb.ac.id", "Rina Nurhayati");
    const perjadin = await addPerjadin({ advanceIdr: 2_000_000, picPersonId: pic.id });

    await expect(perjadinAcquittal(pic, perjadin.id)).resolves.toMatchObject({
      spentIdr: 0,
      remainderIdr: 2_000_000,
    });
  });

  it("reaches the browser as a 403, not as a crash page", async () => {
    /**
     * The product half of the refusal: what a non-Staff member who somehow
     * reached a money surface actually gets back.
     *
     * `forbidden()` throws an error carrying `NEXT_HTTP_ERROR_FALLBACK;403` as its
     * digest, and that digest is what Next reads to pick the status and render
     * `forbidden.tsx`. It is the closest observable to "the status of the response"
     * reachable without standing up a Next server, and it is the property that
     * actually matters — the alternative is the default error boundary and a 500.
     *
     * The environment variable is what `experimental.authInterrupts` in
     * `next.config.ts` sets during a build. Setting it here asserts the behaviour
     * under the deployed condition; asserting the config file itself would be
     * testing it against itself.
     */
    vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
    const { perjadin } = await aPerjadinWithSpending();
    const teacher = nonStaff();

    const thrown = await staffSurface(() => filePerjadinReport(teacher, perjadin.id)).catch(
      (error: unknown) => error,
    );

    expect((thrown as { digest?: string }).digest).toBe("NEXT_HTTP_ERROR_FALLBACK;403");
  });

  it("lets every other failure through untouched", async () => {
    /**
     * The other half of the translation, and the one a bug would silently break: only
     * the Staff-only refusal becomes a 403. A connection failure or a programming
     * error must reach the error boundary as itself, not be dressed up as an
     * authorisation problem nobody can then diagnose.
     */
    vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
    const boom = new Error("the database went away");

    await expect(staffSurface(() => Promise.reject(boom))).rejects.toBe(boom);
  });

  it("tells a missing Perjadin apart from a refusal", async () => {
    /**
     * Both are absences and only one is a bug. A stale link to a deleted Perjadin is a
     * state a Staff member genuinely reaches, so it is a `null` rather than a throw.
     */
    const pic = await signInAsPerson("Staff", "rina@ditsama.itb.ac.id", "Rina Nurhayati");

    await expect(
      perjadinAcquittal(pic, "00000000-0000-0000-0000-000000000000"),
    ).resolves.toBeNull();
  });
});
