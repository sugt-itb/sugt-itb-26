"use server";

import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import {
  addPerson,
  assignGrant,
  revokeGrant,
  revokePerson,
  type AddPersonResult,
  type NewPerson,
  type RevokePersonResult,
  type SetGrantResult,
} from "@sugt/db/queries";
import type { Grant } from "@sugt/domain";
import { revalidatePath } from "next/cache";

/**
 * **Orang's two writes** — add a Person and revoke one. Both Staff-only, both the same three
 * lines: resolve the Person, hand it to `@sugt/db` through `staffSurface`, return what came back.
 *
 * `staffSurface` turns a Teaching Team caller's `NotStaffError` into a 403 rather than a crash —
 * the enforcement is `requireStaff` inside each write, because a layout does not run before a
 * Server Action. Every other refusal is a value the form places on a field.
 *
 * `revalidatePath` clears the client router cache for the roster the user is looking at, on the
 * outcome that changed it.
 */

export async function addPersonAction(input: NewPerson): Promise<AddPersonResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => addPerson(person, input));
  if (result.outcome === "added") revalidatePath("/orang");
  return result;
}

export async function revokePersonAction(personId: string): Promise<RevokePersonResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => revokePerson(person, personId));
  if (result.outcome === "revoked") revalidatePath("/orang");
  return result;
}

/**
 * **Orang's two Grant writes** — assign a Grant to a Staff Person and revoke one. Both are
 * Administrator-guarded, not merely Staff-only: administering Grants is itself a Grant (ADR-0028),
 * so `staffSurface` here turns a non-Administrator's `NotGrantedError` into a 403 the same way it
 * turns a non-Staff caller's `NotStaffError` into one — the enforcement is `requireGrant` inside
 * each `@sugt/db` write, because a layout does not run before a Server Action. The non-Staff-target
 * refusal is a **value** the form places on a field, not a throw: an Administrator picking a
 * Pimpinan is a reachable state, unlike a caller who lacks the Grant.
 *
 * `revalidatePath` clears the roster's client router cache on the outcome that changed a Grant.
 */
export async function assignGrantAction(personId: string, grant: Grant): Promise<SetGrantResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => assignGrant(person, personId, grant));
  if (result.outcome === "assigned") revalidatePath("/orang");
  return result;
}

export async function revokeGrantAction(personId: string, grant: Grant): Promise<SetGrantResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => revokeGrant(person, personId, grant));
  if (result.outcome === "revoked") revalidatePath("/orang");
  return result;
}
