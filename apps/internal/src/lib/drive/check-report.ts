import type {
  DocumentSweepFailure,
  DriveCheckReport,
  ExposableFolder,
  FolderCheck,
  FolderNameFailure,
  FootageSweepFailure,
  SweepFailure,
} from "./check";

/**
 * **What Periksa koneksi says** (#375) — the report as sentences, kept apart from both the check
 * (server) and the card (client) so one test reads exactly what an Administrator reads. Types only
 * cross from `check.ts`; nothing server-only reaches the browser through here.
 */

const FOLDER_NAMES: Record<FolderCheck["folder"], string> = {
  root: "Folder utama",
  staging: "Folder _staging",
  "bukti-transaksi": "Folder Bukti Transaksi",
  "pelaksanaan-offline": "Folder Pelaksanaan Offline",
};

const FOLDER_STATES: Record<FolderCheck["state"], string> = {
  ok: "ada",
  trashed: "ada di Sampah Google Drive",
  missing: "tidak ditemukan",
};

const FAILURE_REASONS: Record<SweepFailure["reason"], string> = {
  "folder-trashed": "folder ada di Sampah Google Drive",
  "folder-missing": "folder tidak ditemukan",
  "drive-failed": "Google Drive gagal menjawab",
  "newer-receipts": "ada bukti baru yang masih diproses",
  "no-such-transaction": "transaksi sudah tidak ada",
};

/**
 * A document as a failure line names it: `{date} · {kind}`, or `SPPD · {School}`, since an SPPD
 * has no date (#441).
 */
function documentLabel(failure: DocumentSweepFailure): string {
  if (failure.kind === "SPPD") return `${failure.kind} · ${failure.schoolName}`;
  return `${failure.documentDate} · ${failure.kind}`;
}

const DOCUMENT_FAILURE_REASONS: Record<DocumentSweepFailure["reason"], string> = {
  "folder-trashed": "folder ada di Sampah Google Drive",
  "folder-missing": "folder tidak ditemukan",
  "file-trashed": "berkas ada di Sampah Google Drive",
  "file-missing": "berkas tidak ditemukan",
  "dokumen-folders-busy": "folder Dokumen sedang disiapkan proses lain",
  "drive-failed": "Google Drive gagal menjawab",
  "no-such-document": "dokumen sudah tidak ada",
};

const FOOTAGE_FAILURE_REASONS: Record<FootageSweepFailure["reason"], string> = {
  "folder-trashed": "folder ada di Sampah Google Drive",
  "folder-missing": "folder tidak ditemukan",
  "file-trashed": "berkas ada di Sampah Google Drive",
  "file-missing": "berkas tidak ditemukan",
  "footage-folders-busy": "folder Foto & Video sedang disiapkan proses lain",
  "drive-failed": "Google Drive gagal menjawab",
  "no-such-footage": "foto/video sudah tidak ada",
};

const NAME_FAILURE_REASONS: Record<FolderNameFailure["reason"], string> = {
  "folder-trashed": "folder ada di Sampah Google Drive",
  "folder-missing": "folder tidak ditemukan",
  "drive-failed": "Google Drive gagal menjawab",
};

const PERJADIN_FOLDER_LABELS: Record<FolderNameFailure["folder"], string> = {
  "bukti-transaksi": "Bukti Transaksi",
  dokumen: "Dokumen",
  "foto-video": "Foto & Video",
  "sesi-foto-video": "Foto & Video Sesi",
};

const DOKUMEN_LINES: Record<"ok" | "created" | "busy", string> = {
  ok: "Folder Dokumen: ada.",
  created: "Folder Dokumen: dibuat.",
  busy: "Folder Dokumen: sedang disiapkan proses lain — periksa lagi.",
};

const FOOTAGE_LINES: Record<"ok" | "created" | "busy", string> = {
  ok: "Folder Foto & Video: ada.",
  created: "Folder Foto & Video: dibuat.",
  busy: "Folder Foto & Video: sedang disiapkan proses lain — periksa lagi.",
};

/** The prominent warning when a link-shared folder reaches the root or `_staging`. */
export function exposureWarning(folder: ExposableFolder): string {
  return `${FOLDER_NAMES[folder]} dapat dibuka siapa saja yang punya link — pindahkan keluar dari folder yang dibagikan.`;
}

export type DriveCheckSentences = {
  /** One line per finding, in the order the check ran. */
  lines: string[];
  /** Said prominently: a folder anyone with a link can open. */
  warnings: string[];
  /**
   * Each line the sweep could not finish, and each Perjadin folder whose name could not be put
   * right, and why.
   */
  failures: string[];
};

export function describeDriveCheck(report: DriveCheckReport): DriveCheckSentences {
  switch (report.token) {
    case "not-connected":
      return { lines: ["Google Drive belum terhubung."], warnings: [], failures: [] };
    case "broken":
      return {
        lines: ["Google menolak token — koneksi ditandai terputus. Hubungkan ulang."],
        warnings: [],
        failures: [],
      };
    case "already-broken":
      return {
        lines: ["Koneksi sudah terputus — Hubungkan ulang."],
        warnings: [],
        failures: [],
      };
    case "unreachable":
      return {
        lines: ["Google Drive tidak dapat dihubungi — coba lagi."],
        warnings: [],
        failures: [],
      };
    case "ok": {
      const { sweep, names } = report;
      const lines = [
        "Token Google Drive berfungsi.",
        ...report.folders.map(
          (check) => `${FOLDER_NAMES[check.folder]}: ${FOLDER_STATES[check.state]}.`,
        ),
        ...(report.dokumen === "skipped" ? [] : [DOKUMEN_LINES[report.dokumen]]),
        ...(report.footage === "skipped" ? [] : [FOOTAGE_LINES[report.footage]]),
        ...(sweep.ran
          ? [
              `${sweep.synced} transaksi disinkronkan, ${sweep.waiting} masih menunggu.`,
              `${sweep.documents.synced} dokumen disinkronkan, ${sweep.documents.waiting} masih menunggu.`,
              `${sweep.footage.synced} foto/video disinkronkan, ${sweep.footage.waiting} masih menunggu.`,
            ]
          : [
              `Sinkronisasi dilewati sampai folder di atas beres; ${sweep.waiting} transaksi, ${sweep.documentsWaiting} dokumen dan ${sweep.footageWaiting} foto/video masih menunggu.`,
            ]),
        ...(names.ran
          ? [`${names.renamed} nama folder dan berkas diganti, ${names.remaining} folder tersisa.`]
          : []),
      ];
      return {
        lines,
        warnings: report.exposed.map(exposureWarning),
        failures: sweep.ran
          ? [
              ...sweep.failures.map(
                (failure) =>
                  `${failure.spentOn} · ${failure.description}: ${FAILURE_REASONS[failure.reason]}.`,
              ),
              ...sweep.documents.failures.map(
                (failure) =>
                  `${documentLabel(failure)}: ${DOCUMENT_FAILURE_REASONS[failure.reason]}.`,
              ),
              ...sweep.footage.failures.map(
                (failure) =>
                  `${failure.originalFilename}: ${FOOTAGE_FAILURE_REASONS[failure.reason]}.`,
              ),
              ...(names.ran ? names.failures : []).map(
                (failure) =>
                  `${failure.name} (${PERJADIN_FOLDER_LABELS[failure.folder]}): ${NAME_FAILURE_REASONS[failure.reason]}.`,
              ),
            ]
          : [],
      };
    }
  }
}
