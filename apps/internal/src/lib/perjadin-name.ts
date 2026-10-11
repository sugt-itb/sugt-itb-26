import { SEPARATOR, short } from "./drive/receipt-files";

/**
 * **What a Perjadin is called** (ADR-0044) — the one place its name is put together, for every
 * screen, both Drive folders and the CSV export — a copy anywhere else is a fix that misses it.
 *
 * The name is `{Sub-Cluster name} · {dates}` and is **never stored**: it is read live from
 * `sub_cluster.name` and the trip's dates, so renaming a Sub-Cluster relabels its trips, past ones
 * included. Two trips of one Kelompok on the same dates share a name (ADR-0043), which is what the
 * **School line** — the trip's Schools, `perjadinSchoolsLine` — under it is for.
 */

/** What a Perjadin is named from: its Sub-Cluster's name and its two dates. */
export type PerjadinNameParts = { subClusterName: string; startsOn: string; endsOn: string };

const MONTH = new Intl.DateTimeFormat("id-ID", { month: "short", timeZone: "UTC" });

/** A `YYYY-MM-DD` as its day, short month and year: `[12, "Okt", 2026]`. */
function parts(isoDate: string): [number, string, number] {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return [date.getUTCDate(), MONTH.format(date), date.getUTCFullYear()];
}

/**
 * A Perjadin's dates, short: `12–15 Okt 2026`, `30 Sep – 2 Okt 2026`, `30 Des 2026 – 2 Jan 2027`,
 * or `12 Okt 2026` for a one-day trip.
 */
export function formatTripDates(startsOn: string, endsOn: string): string {
  const [startDay, startMonth, startYear] = parts(startsOn);
  const [endDay, endMonth, endYear] = parts(endsOn);
  if (startsOn === endsOn) return `${startDay} ${startMonth} ${startYear}`;
  if (startYear !== endYear) {
    return `${startDay} ${startMonth} ${startYear} – ${endDay} ${endMonth} ${endYear}`;
  }
  if (startMonth !== endMonth)
    return `${startDay} ${startMonth} – ${endDay} ${endMonth} ${endYear}`;
  return `${startDay}–${endDay} ${endMonth} ${endYear}`;
}

/** `Kelompok 10 · 12–13 Okt 2026` */
export function perjadinName({ subClusterName, startsOn, endsOn }: PerjadinNameParts): string {
  return `${subClusterName}${SEPARATOR}${formatTripDates(startsOn, endsOn)}`;
}

/**
 * `SMAN 1 Bontang, SMAN 2 Samarinda` — the trip's Schools, joined, in the order given. The order is
 * the query's (`tripSchoolNames` in `@sugt/db`, by name), the one place it is decided. Empty for a
 * trip with no live Session.
 */
export function perjadinSchoolsLine(schoolNames: readonly string[]): string {
  return schoolNames.join(", ");
}

/** The name, then the School line when there is one: what the Drive folder and the CSV both name. */
function nameWithSchools(trip: PerjadinNameParts & { schoolNames: readonly string[] }): string {
  const schools = perjadinSchoolsLine(trip.schoolNames);
  return schools ? `${perjadinName(trip)}${SEPARATOR}${schools}` : perjadinName(trip);
}

/**
 * The Perjadin's folder in Drive — its Bukti Transaksi folder and its Dokumen folder alike
 * (ADR-0040, ADR-0042):
 *
 *     Kelompok 10 · 12–13 Okt 2026 · SMAN 1 Bontang, SMAN 2 Samarinda · P-1a2b3c4d
 *     Kelompok 10 · 12–13 Okt 2026 · P-1a2b3c4d                 ← no live Session
 *
 * The `P-` id tells apart two trips whose names and Schools agree, and appears in Drive names only,
 * never on screen.
 */
export function perjadinFolderName(
  trip: PerjadinNameParts & { id: string; schoolNames: readonly string[] },
): string {
  return `${nameWithSchools(trip)}${SEPARATOR}P-${short(trip.id)}`;
}

/**
 * `laporan-perjadin-kelompok-10-12-13-okt-2026-sman-1-bontang-sman-2-samarinda.csv` — the Drive
 * folder's rule without the id, slugified. Accents fold to their letter; anything else that is not
 * a letter or digit becomes one `-`.
 */
export function perjadinCsvFileName(
  trip: PerjadinNameParts & { schoolNames: readonly string[] },
): string {
  return `laporan-perjadin-${slugify(nameWithSchools(trip)) || "perjadin"}.csv`;
}

/**
 * Text as a file-name slug: accents fold to their letter, anything else that is not a letter or digit
 * becomes one `-`, and no `-` leads or trails. `Kelompok 10 · 12–13 Okt 2026` → `kelompok-10-12-13-okt-2026`.
 */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
