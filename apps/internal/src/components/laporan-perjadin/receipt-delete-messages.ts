import type { DeleteReceiptActionResult } from "-/app/(app)/perjadin/[id]/laporan/action-types";
import { driveRefusalText } from "-/lib/drive/upload-messages";

/**
 * **What Hapus bukti says** (#462, ADR-0050), apart from its dialog so the words are tested as the
 * ticket set them: the confirmation, and the refusal of a line's only receipt.
 */

export const RECEIPT_DELETE_CONFIRM =
  "Hapus bukti ini? File akan dipindahkan ke Sampah Google Drive.";

/** Why the line's only receipt cannot go (ADR-0039): a line keeps one to five. */
export const ONLY_RECEIPT =
  "Satu-satunya bukti tidak bisa dihapus. Unggah bukti yang benar dulu, atau hapus transaksinya.";

/** What a refused Hapus bukti says. */
export function receiptDeleteRefusalText(
  result: Exclude<DeleteReceiptActionResult, { outcome: "deleted" | "no-such-receipt" }>,
): string {
  if (result.outcome === "only-receipt") return ONLY_RECEIPT;
  return driveRefusalText(result);
}
