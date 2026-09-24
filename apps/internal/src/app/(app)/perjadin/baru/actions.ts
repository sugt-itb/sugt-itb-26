"use server";

import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import { planPerjadin, type PlanPerjadinInput, type PlanPerjadinResult } from "@sugt/db/queries";

/**
 * **Rencanakan Perjadin's write.**
 *
 * It opens no transaction: the boundary is convention 5's and lives in `planPerjadin`,
 * where the Perjadin, its Group and its Sessions commit together. It re-checks no role
 * either — `requireStaff` inside the query is what closes the path, since a layout does not
 * run before a Server Action.
 *
 * Every refusal comes back as a value. A return date before the departure date (the range is the
 * departure→return span now, ADR-0021), a Session dated outside the trip: each is something a
 * person can type honestly,
 * and by the rule settled on the query layer each earns a field-level message rather than
 * an error page.
 *
 * **It revalidates nothing**, unlike the Group substitution beside `/perjadin/[id]`: the
 * form navigates to the trip it just created, so there is no cached payload of this page to
 * drop.
 */

export async function planPerjadinAction(input: PlanPerjadinInput): Promise<PlanPerjadinResult> {
  const person = await requirePerson();

  return staffSurface(() => planPerjadin(person, input));
}
