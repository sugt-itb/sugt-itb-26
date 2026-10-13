import type { TripPimpinan } from "@sugt/db/queries";

/**
 * The trip's Pimpinan — read-only, for everyone (#492, ADR-0056). A Pimpinan is recorded on the
 * Sessions they attended, in each Session's dialog, so this list is **derived**: everyone recorded
 * on at least one non-cancelled Session, each followed by the Schools they were recorded at.
 * Nothing here writes; a Pimpinan is set or removed on a Session.
 *
 * Record-only: a Pimpinan is not a Group member, files no Evaluation and adds nothing to the
 * Preparation Checklist.
 */
function PerjadinPimpinan({ pimpinan }: { pimpinan: TripPimpinan[] }) {
  return (
    <div className="border-b border-border px-4 py-5 sm:px-7">
      <h2 className="font-heading text-sm font-medium">Pimpinan</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pimpinan DITSAMA yang ikut memantau — tercatat saja, bukan anggota Group. Dicatat per Sesi.
      </p>

      {pimpinan.length > 0 ? (
        <ul
          aria-label="Pimpinan Perjadin"
          className="mt-3 space-y-1 text-sm"
        >
          {pimpinan.map((entry) => (
            <li key={entry.personId}>
              {entry.name}
              <span className="text-muted-foreground"> — {entry.schools.join(", ")}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Tidak ada.</p>
      )}
    </div>
  );
}

export { PerjadinPimpinan };
