import { authorizeCron } from "-/lib/cron";
import { driveAccessToken } from "-/lib/drive/access-token";
import { copyFootageToArchive } from "-/lib/drive/copy-footage";
import { isDriveFailure, openDrive } from "-/lib/drive/google";
import { NextResponse } from "next/server";

/** The pass's own budget is well inside this; past it, Vercel stops the function and the lease expires. */
export const maxDuration = 60;

/**
 * **The daily Foto & Video copy** (#562, ADR-0063): Vercel Cron calls this once a day, at night
 * WIB (`vercel.json`), with `Authorization: Bearer ${CRON_SECRET}`. Anything else gets a 401 before
 * anything is read. It copies every Staff upload not yet in its Session's archive into the archive,
 * as the company account (`copyFootageToArchive`), and answers what it did as JSON for Vercel's log.
 * When Drive is not usable it copies nothing and says why; the next day, or a Periksa koneksi press,
 * tries again.
 */
export async function GET(request: Request) {
  const cron = authorizeCron(request);
  if (!cron) return new NextResponse("Unauthorized", { status: 401 });

  const access = await driveAccessToken(cron);
  if (access.outcome !== "ok") return NextResponse.json({ ran: false, reason: access.outcome });

  try {
    const report = await copyFootageToArchive(cron, openDrive(access.accessToken), access.folders, {
      scope: access.scope,
    });
    return NextResponse.json(report);
  } catch (error) {
    if (!isDriveFailure(error)) throw error;
    console.error("The daily Foto & Video copy could not reach Google Drive.", error);
    return NextResponse.json({ ran: false, reason: "drive-unreachable" });
  }
}
