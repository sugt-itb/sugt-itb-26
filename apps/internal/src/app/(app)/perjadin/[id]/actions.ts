"use server";

import { requireEnv } from "-/lib/env";
import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import {
  addPerjadinSession,
  addPerjadinTeacher,
  cancelSession,
  changePerjadinPic,
  editPerjadinSession,
  issuePerjadinFeedbackToken,
  removePerjadinTeacher,
  renamePerjadinTeacher,
  setPerjadinPimpinan,
  setPerjadinStaff,
  togglePreparationItem,
  updatePerjadinAdvance,
  updatePerjadinLogistics,
  type AddPerjadinSessionResult,
  type AddPerjadinTeacherResult,
  type CancelSessionResult,
  type ChangePerjadinPicResult,
  type EditPerjadinSessionResult,
  type PerjadinLogisticsInput,
  type PerjadinSessionInput,
  type RemovePerjadinTeacherResult,
  type RenamePerjadinTeacherResult,
  type SetPerjadinPimpinanResult,
  type SetPerjadinStaffResult,
  type TogglePreparationItemResult,
  type UpdatePerjadinAdvanceResult,
  type UpdatePerjadinLogisticsResult,
} from "@sugt/db/queries";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";

/**
 * **The writes Detail Perjadin offers, each beside the page that offers it.**
 *
 * An action belongs to the route that offers it — the same rule `/sesi/[id]/actions.ts` follows —
 * which is also what keeps `revalidatePath` honest: a route's action revalidating some other route
 * is a sign it is in the wrong file. Every Staff-only write is wrapped in `staffSurface`, because the
 * query throws `NotStaffError` and a Server Action's error is sanitized on the way to the client, so
 * the translation to a 403 has to happen here on the server. Every refusal a person can reach
 * honestly comes back as a value the client renders.
 */

/** **Set the Group's extra Staff** — the PIC plus this set, and nobody else. */
export async function setPerjadinStaffAction(
  perjadinId: string,
  staffPersonIds: string[],
): Promise<SetPerjadinStaffResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => setPerjadinStaff(person, perjadinId, staffPersonIds));
  if (result.outcome === "set") revalidatePath(`/perjadin/${perjadinId}`);
  return result;
}

/** **Reassign the PIC**, keeping the Group valid in one transaction. */
export async function changePerjadinPicAction(
  perjadinId: string,
  newPicPersonId: string,
): Promise<ChangePerjadinPicResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => changePerjadinPic(person, perjadinId, newPicPersonId));
  if (result.outcome === "changed") revalidatePath(`/perjadin/${perjadinId}`);
  return result;
}

/** **Set the Pimpinan recorded on the trip** — a subset of the Pimpinan roster, by Person id (#181). */
export async function setPerjadinPimpinanAction(
  perjadinId: string,
  personIds: string[],
): Promise<SetPerjadinPimpinanResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => setPerjadinPimpinan(person, perjadinId, personIds));
  if (result.outcome === "set") revalidatePath(`/perjadin/${perjadinId}`);
  return result;
}

/**
 * **Add one trip-scoped teacher name.** The teacher writes clear the "Pengajar sudah lengkap"
 * Preparation tick, which shows on the `/perjadin` list's `Persiapan: x/N` pill — so, like
 * `togglePreparationItemAction`, this revalidates both routes.
 */
export async function addPerjadinTeacherAction(
  perjadinId: string,
  name: string,
): Promise<AddPerjadinTeacherResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => addPerjadinTeacher(person, perjadinId, name));
  if (result.outcome === "added") {
    revalidatePath(`/perjadin/${perjadinId}`);
    revalidatePath("/perjadin");
  }
  return result;
}

/**
 * **Rename one trip-scoped teacher name.** `perjadinId` is passed for revalidation only — the query
 * takes the teacher's id and reads the trip back from it.
 */
export async function renamePerjadinTeacherAction(
  perjadinId: string,
  teacherId: string,
  name: string,
): Promise<RenamePerjadinTeacherResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => renamePerjadinTeacher(person, teacherId, name));
  if (result.outcome === "renamed") {
    revalidatePath(`/perjadin/${perjadinId}`);
    revalidatePath("/perjadin");
  }
  return result;
}

/** **Remove one trip-scoped teacher name.** Cascades its Session "Diajar oleh" links away. */
export async function removePerjadinTeacherAction(
  perjadinId: string,
  teacherId: string,
): Promise<RemovePerjadinTeacherResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => removePerjadinTeacher(person, teacherId));
  if (result.outcome === "removed") {
    revalidatePath(`/perjadin/${perjadinId}`);
    revalidatePath("/perjadin");
  }
  return result;
}

/** **Add one offline Session to the trip.** */
export async function addPerjadinSessionAction(
  perjadinId: string,
  input: PerjadinSessionInput,
): Promise<AddPerjadinSessionResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => addPerjadinSession(person, perjadinId, input));
  if (result.outcome === "added") revalidatePath(`/perjadin/${perjadinId}`);
  return result;
}

/** **Edit one arranged offline Session's School, date, time, Stream and "Diajar oleh".** */
export async function editPerjadinSessionAction(
  perjadinId: string,
  sessionId: string,
  input: PerjadinSessionInput,
): Promise<EditPerjadinSessionResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => editPerjadinSession(person, sessionId, input));
  if (result.outcome === "edited") revalidatePath(`/perjadin/${perjadinId}`);
  return result;
}

/** **Cancel one offline Session** — the way a Session is removed from the trip, kept visible. */
export async function cancelPerjadinSessionAction(
  perjadinId: string,
  sessionId: string,
  reason: string,
): Promise<CancelSessionResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => cancelSession(person, sessionId, reason));
  if (result.outcome === "cancelled") revalidatePath(`/perjadin/${perjadinId}`);
  return result;
}

/**
 * What issuing a Perjadin feedback token hands back to the QR dialog: the link and its QR image.
 * The mirror of `IssueFeedbackTokenActionResult`, but with no refusal arm — `issuePerjadinFeedbackToken`
 * always issues, because a Perjadin is a real trip once it exists and there is no cancelled state to
 * bar (unlike a Session).
 */
export type IssuePerjadinFeedbackTokenActionResult = { outcome: "issued"; url: string; qr: string };

/**
 * **Issue — or reissue — the Perjadin Evaluation token, and render its QR** (ADR-0024).
 *
 * No `staffSurface` and no role check: a Perjadin Evaluation is not Staff-only (ADR-0004 — it carries
 * no money), so `issuePerjadinFeedbackToken` takes a plain `Person` and any signed-in Person may share
 * the link. The QR is generated here, server-side, colours baked into the image (black on white) so a
 * scanner reads it whatever the theme. The URL points at this app's own `/ep/{token}` — the handler
 * lives on the internal app, whose base URL is `BETTER_AUTH_URL`, exactly as `issueFeedbackTokenAction`
 * builds `/f/{token}`.
 *
 * No `revalidatePath`: nothing on the page reflects the token, so there is nothing to refresh.
 */
export async function issuePerjadinFeedbackTokenAction(
  perjadinId: string,
): Promise<IssuePerjadinFeedbackTokenActionResult> {
  const person = await requirePerson();

  const result = await issuePerjadinFeedbackToken(person, perjadinId);

  const url = `${requireEnv("BETTER_AUTH_URL")}/ep/${result.token}`;
  const qr = await QRCode.toDataURL(url, {
    color: { dark: "#000000ff", light: "#ffffffff" },
    margin: 2,
    width: 320,
  });

  return { outcome: "issued", url, qr };
}

/**
 * **Correct a Perjadin's departure/return logistics** — and, with them, its date range.
 *
 * The range is the leg dates now (ADR-0021), so this write resizes `starts_on`/`ends_on` too. It
 * clamps rather than shifting: an edit that would strand an arranged Session comes back as
 * `would-strand` and nothing moves.
 */
export async function updatePerjadinLogisticsAction(
  perjadinId: string,
  input: PerjadinLogisticsInput,
): Promise<UpdatePerjadinLogisticsResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => updatePerjadinLogistics(person, perjadinId, input));
  if (result.outcome === "updated") revalidatePath(`/perjadin/${perjadinId}`);
  return result;
}

/**
 * **Correct a Perjadin's Advance (uang muka)** — the one write that changes the amount after
 * planning (#192). Money writes stay Staff-only (ADR-0026), so it goes through `staffSurface`.
 *
 * **This revalidates two routes.** The Advance shows on the trip page's Uang muka strip *and* on
 * `/perjadin/[id]/laporan` (the acquittal derives its remainder from it), so both are stale the
 * moment it is corrected — a deliberate exception to the one-route convention, the same shape
 * `togglePreparationItemAction` above documents.
 */
export async function updatePerjadinAdvanceAction(
  perjadinId: string,
  advanceIdr: number,
): Promise<UpdatePerjadinAdvanceResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => updatePerjadinAdvance(person, perjadinId, advanceIdr));
  if (result.outcome === "updated") {
    revalidatePath(`/perjadin/${perjadinId}`);
    revalidatePath(`/perjadin/${perjadinId}/laporan`);
  }
  return result;
}

/**
 * **Tick or un-tick one Preparation Checklist box.**
 *
 * **This revalidates two routes**, which the convention otherwise forbids. The `/perjadin` list
 * carries a `Persiapan: x/N` pill genuinely derived from this write, so the list is stale the moment
 * a box is ticked from the detail page — a deliberate exception, not a route's action reaching into
 * an unrelated one.
 */
export async function togglePreparationItemAction(
  perjadinId: string,
  itemKey: string,
  checked: boolean,
): Promise<TogglePreparationItemResult> {
  const person = await requirePerson();

  const result = await staffSurface(() =>
    togglePreparationItem(person, { perjadinId, itemKey, checked }),
  );
  if (result.outcome === "toggled") {
    revalidatePath(`/perjadin/${perjadinId}`);
    revalidatePath("/perjadin");
  }
  return result;
}
