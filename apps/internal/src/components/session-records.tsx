import { SessionRecordDialog } from "-/components/record-forms";
import type { SessionDetail } from "@sugt/db/queries";

/**
 * Who still owes what against this Session — now the **PIC's Session Record**, and nothing else.
 *
 * **The online Class-Record "who owes what" machinery is gone** (T3, #153). It counted Records
 * filed against Records expected off the two `session_teacher` professors, but online teachers are
 * free-text names now (ADR-0022) who cannot sign in and file, `session_teacher` is dropped, and
 * Class Records are deferred for both modes — so there is no expected set to report and no
 * teachers list to render here. What survives is the Session Record the Staff PIC owes.
 *
 * A server component that renders a read-only list, plus one interactive leaf: beside the owed
 * Session Record, if the signed-in person is the one who owes it, the form to file it. `personId`
 * is that person's id — the form appears for their own Record and nobody else's.
 *
 * **The form is offered to the person the tool chases, which is narrower than who may file.**
 * `owed` names the PIC, empty until the Session is delivered (ADR-0009). The write is broader:
 * `fileSessionRecord` admits any member of the trip's Group — and a Perjadin Editor or an Administrator
 * (ADR-0048) — not only the PIC, because `docs/data-model.md` says any Staff who was there may file
 * one while the PIC's is the one chased. A non-PIC member's Session Record is therefore permitted by the write and has no screen here yet —
 * a stated boundary, not an oversight.
 */
function SessionRecords({ session, personId }: { session: SessionDetail; personId: string }) {
  return (
    <div className="border-b border-border px-4 py-5 sm:px-7">
      <h2 className="font-heading text-sm font-medium">Yang belum mengisi</h2>

      {/*
        Empty while the Session is arranged, and that is the criterion rather than an
        oversight: a list that did not wait for `delivered` would chase the PIC for a visit
        that has not happened. Nothing is required and nothing is blocked (ADR-0009) — naming
        who has not filed is the whole of the enforcement.
      */}
      {session.owed.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {session.status === "delivered"
            ? "Semua catatan yang diharapkan sudah masuk."
            : "Belum ada yang diharapkan sampai Sesi ini ditandai terlaksana."}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-sm">
          {session.owed.map((owed) => (
            <li
              key={`session-record:${owed.personId}`}
              className="flex items-center justify-between gap-3 text-muted-foreground"
            >
              <span>
                <span className="text-foreground">{owed.fullName}</span> · Catatan Sesi
              </span>

              {/*
                The form is offered only for the signed-in person's own Record. Everyone sees the
                list — naming who has not filed is the whole of the enforcement (ADR-0009) — but
                only the person who owes the Record can file it, and the write refuses anyone else
                regardless.
              */}
              {owed.personId === personId && <SessionRecordDialog sessionId={session.id} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { SessionRecords };
