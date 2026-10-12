"use client";

import { filePerjadinReportAction } from "-/app/(app)/perjadin/[id]/laporan/actions";
import { formatWibDate } from "-/lib/format-wib";
import { Alert, AlertDescription, AlertTitle } from "@sugt/ui/components/alert";
import { Button } from "@sugt/ui/components/button";
import { useState, useTransition } from "react";

/**
 * **Filing the Perjadin Report.**
 *
 * Named in full, never as "Report": `CONTEXT.md` reserves the unqualified word, because a
 * Perjadin Report is the acquittal and the tool holds several other things a reader would
 * otherwise call a report.
 *
 * "Every transaction has at least one piece of evidence" is checked here as a backstop. Since
 * ADR-0039 a line is recorded with its receipts or not at all, so a line entered through the app
 * always has one; what this still catches is a line from before that rule, which no migration
 * touched. The refusal counts those lines — the list below marks each — and each is fixed through
 * its own "Unggah bukti".
 *
 * **Nothing else is gated** — not the Advance, which is no longer tracked (ADR-0051), and not the
 * deadline. DITSAMA sets that deadline for itself, and the
 * tool is never stricter than the process it serves — invented friction has the same escape route
 * as duplicated work.
 */
function FilePerjadinReport({
  perjadinId,
  filedAt,
  canWrite,
}: {
  perjadinId: string;
  filedAt: Date | null;
  /** Laporkan is the trip's writers' (ADR-0048); anyone else sees only when it was filed. */
  canWrite: boolean;
}) {
  const [refusal, setRefusal] = useState<{ title: string; body: string } | null>(null);
  const [filing, startFiling] = useTransition();

  if (filedAt !== null) {
    return (
      <span className="text-sm text-muted-foreground">
        Dilaporkan <span className="tabular-nums">{formatWibDate(filedAt)}</span>
      </span>
    );
  }
  if (!canWrite) return null;

  function file() {
    startFiling(async () => {
      setRefusal(null);
      const result = await filePerjadinReportAction(perjadinId);
      // Every arm of the union is answered. Two of them describe a page that has gone stale
      // rather than anything the PIC did, and a button that does nothing visible on either
      // is worse than one that says which.
      switch (result.outcome) {
        case "filed":
          return;
        case "evidence-missing":
          // The count, rather than the ids: the rows are on the screen below and marked
          // "Belum ada bukti" already, so naming how many is what this adds.
          setRefusal({
            title: "Laporan belum bisa dikirim.",
            body: `${result.transactionIds.length} transaksi belum punya bukti. Lampirkan bukti pada setiap transaksi terlebih dahulu.`,
          });
          return;
        case "already-filed":
          setRefusal({
            title: "Laporan ini sudah dikirim.",
            body: `Dilaporkan ${result.filedAt.toISOString().slice(0, 10)}. Muat ulang halaman untuk melihat keadaannya.`,
          });
          return;
        case "no-such-perjadin":
          setRefusal({
            title: "Perjadin ini sudah tidak ada.",
            body: "Muat ulang halaman untuk melihat keadaannya.",
          });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        size="sm"
        disabled={filing}
        onClick={file}
      >
        {filing ? "Melaporkan…" : "Laporkan"}
      </Button>
      {refusal !== null && (
        <Alert variant="destructive">
          <AlertTitle>{refusal.title}</AlertTitle>
          <AlertDescription>{refusal.body}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export { FilePerjadinReport };
