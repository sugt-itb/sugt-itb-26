import { connectDriveAction } from "-/app/(app)/pengaturan/actions";
import Page from "-/app/(app)/pengaturan/page";
import { GET } from "-/app/api/drive/callback/route";
import { driveAccessToken } from "-/lib/drive/access-token";
import { completeDriveConnection, DRIVE_STATE_COOKIE } from "-/lib/drive/connect";
import {
  DOKUMEN_FOLDER_NAME,
  FOOTAGE_FOLDER_NAME,
  FOOTAGE_UPLOAD_FOLDER_NAME,
} from "-/lib/drive/dokumen-folders";
import { FakeDrive, MY_DRIVE } from "-/lib/drive/fake-drive";
import {
  BUKTI_TRANSAKSI_FOLDER_NAME,
  PELAKSANAAN_OFFLINE_FOLDER_NAME,
  README_NAME,
  README_TEXT,
  ROOT_FOLDER_NAME,
  STAGING_FOLDER_NAME,
} from "-/lib/drive/fixed-folders";
import { DRIVE_FILE_SCOPE, DRIVE_SCOPE, DriveRequestError, openDrive } from "-/lib/drive/google";
import { decryptRefreshToken } from "-/lib/drive/token-crypto";
import { requirePerson, resolvePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import { markDriveConnectionBroken, touchDriveConnection, type Person } from "@sugt/db/queries";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addGrant, addPerson, resetDatabase } from "./support/fixtures";

/**
 * **Connecting the company Google Drive** (#372, ADR-0040), against the real database.
 *
 * Three things are faked, each because no test can reach it: Google's **token endpoint**, stubbed at
 * the network boundary the way `support/google.ts` stubs sign-in; **Drive** itself, the in-memory
 * `FakeDrive` swapped in for `openDrive`; and the signed-in **Person** and the action's cookie jar
 * (`next/headers`). The seven callback checks, the encryption and the folder logic are the real code.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn(), resolvePerson: vi.fn() }));
vi.mock("-/lib/drive/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("-/lib/drive/google")>()),
  openDrive: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const FORBIDDEN = "NEXT_HTTP_ERROR_FALLBACK;403";
const ACCOUNT = "bukti@perusahaan.test";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

async function digestOf(call: Promise<unknown>) {
  const thrown = await call.then(
    () => null,
    (error: unknown) => error,
  );
  return (thrown as { digest?: string } | null)?.digest;
}

/** An id_token as Google's token endpoint returns it. The callback decodes it; nothing verifies it. */
function idToken(email: string) {
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "RS256" })}.${segment({ email, email_verified: true })}.c2ln`;
}

type TokenReply = { status?: number; body: Record<string, unknown> };

/**
 * Google's token endpoint. `exchange` answers the authorization-code grant, `refresh` the
 * refresh-token grant; anything else leaving the process throws, so an unexpected call is loud.
 */
function stubTokenEndpoint(replies: { exchange?: TokenReply; refresh?: TokenReply }) {
  const seen = { exchanges: 0, refreshes: [] as string[] };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== TOKEN_ENDPOINT) throw new Error(`Unexpected outbound request: ${url}`);
    const form = new URLSearchParams(String(init?.body));
    const reply = form.get("grant_type") === "refresh_token" ? replies.refresh : replies.exchange;
    if (form.get("grant_type") === "refresh_token") seen.refreshes.push(form.get("refresh_token")!);
    else seen.exchanges += 1;
    if (!reply) throw new Error(`No stubbed reply for ${form.get("grant_type")}`);
    return Response.json(reply.body, { status: reply.status ?? 200 });
  });
  return seen;
}

/** What Google returns for a consent that ticked everything, on the company account. */
function goodExchange(overrides: Record<string, unknown> = {}): TokenReply {
  return {
    body: {
      access_token: "access-from-exchange",
      refresh_token: "refresh-token-plaintext",
      scope: `openid https://www.googleapis.com/auth/userinfo.email ${DRIVE_SCOPE}`,
      id_token: idToken(ACCOUNT),
      ...overrides,
    },
  };
}

const callback = (person: Person | null, params: Record<string, string>, cookie = "state-1") =>
  completeDriveConnection({
    params: new URLSearchParams({ state: "state-1", code: "auth-code", ...params }),
    stateCookie: cookie,
    person,
  });

let drive: FakeDrive;

async function people() {
  const admin = await addPerson({ fullName: "Admin", email: "admin@itb.ac.id", role: "Staff" });
  await addGrant(admin.id, "Administrator");
  const staff = await addPerson({ fullName: "Staf", email: "staf@itb.ac.id", role: "Staff" });
  const pimpinan = await addPerson({ fullName: "Pim", email: "pim@itb.ac.id", role: "Pimpinan" });
  return { admin: { ...admin, grants: ["Administrator"] } as Person, staff, pimpinan };
}

const rows = () => db.select().from(schema.driveConnection);

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
  drive = new FakeDrive();
  vi.mocked(openDrive).mockReturnValue(drive);
});

describe("only an Administrator reaches the connection", () => {
  it("refuses a non-Administrator Staff member and a Pimpinan at the page, the action and the callback", async () => {
    const { staff, pimpinan } = await people();
    const cookieJar = { set: vi.fn() };
    vi.mocked(cookies).mockResolvedValue(cookieJar as never);

    for (const person of [staff, pimpinan]) {
      vi.mocked(requirePerson).mockResolvedValue(person);
      vi.mocked(resolvePerson).mockResolvedValue(person);

      await expect(digestOf(Page({ searchParams: Promise.resolve({}) } as never))).resolves.toBe(
        FORBIDDEN,
      );
      await expect(digestOf(connectDriveAction())).resolves.toBe(FORBIDDEN);

      const response = await GET(
        new NextRequest("http://localhost:3001/api/drive/callback?state=s&code=c", {
          headers: { cookie: `${DRIVE_STATE_COOKIE}=s` },
        }),
      );
      expect(response.status).toBe(403);
      await expect(response.text()).resolves.toBe(
        "Hanya Administrator yang dapat menghubungkan Google Drive.",
      );
    }

    expect(cookieJar.set).not.toHaveBeenCalled();
    await expect(rows()).resolves.toHaveLength(0);
  });

  it("sends an Administrator to Google's consent screen with a state cookie", async () => {
    const { admin } = await people();
    vi.mocked(requirePerson).mockResolvedValue(admin);
    const cookieJar = { set: vi.fn() };
    vi.mocked(cookies).mockResolvedValue(cookieJar as never);

    const digest = await digestOf(connectDriveAction());

    const [name, state, options] = cookieJar.set.mock.calls[0]!;
    expect(name).toBe(DRIVE_STATE_COOKIE);
    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/api/drive/callback",
    });
    const url = new URL(digest!.split(";")[2]!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "test-drive-client-id",
      redirect_uri: "http://localhost:3001/api/drive/callback",
      response_type: "code",
      scope: `openid email ${DRIVE_SCOPE}`,
      access_type: "offline",
      prompt: "consent",
      login_hint: ACCOUNT,
      state,
    });
  });
});

describe("the callback's checks, in order", () => {
  it.each([
    ["access-denied", { error: "access_denied" }, goodExchange()],
    ["exchange-failed", { error: "server_error" }, goodExchange()],
    ["state-mismatch", { state: "forged" }, goodExchange()],
    ["exchange-failed", {}, { status: 400, body: { error: "invalid_grant" } }],
    ["wrong-account", {}, goodExchange({ id_token: idToken("someone@gmail.com") })],
    ["scope-missing", {}, goodExchange({ scope: "openid email" })],
    // A connect granting only `drive.file`, as every connect did before #562, is not enough now.
    ["scope-missing", {}, goodExchange({ scope: `openid email ${DRIVE_FILE_SCOPE}` })],
    ["no-refresh-token", {}, goodExchange({ refresh_token: undefined })],
  ] as const)("stops at %s and stores nothing", async (outcome, params, exchange) => {
    const { admin } = await people();
    stubTokenEndpoint({ exchange });

    await expect(callback(admin, params)).resolves.toBe(outcome);

    await expect(rows()).resolves.toHaveLength(0);
    expect(drive.calls).toBe(0);
  });

  it("stops at not-administrator before exchanging the code", async () => {
    const { staff } = await people();
    const seen = stubTokenEndpoint({ exchange: goodExchange() });

    await expect(callback(staff, {})).resolves.toBe("not-administrator");
    await expect(callback(null, {})).resolves.toBe("not-administrator");

    expect(seen.exchanges).toBe(0);
    await expect(rows()).resolves.toHaveLength(0);
  });

  it("checks the state before the caller, so a forged state never reaches the role check", async () => {
    const { admin, staff } = await people();
    const seen = stubTokenEndpoint({ exchange: goodExchange() });

    await expect(callback(staff, { state: "forged" })).resolves.toBe("state-mismatch");
    await expect(callback(admin, { state: "forged" })).resolves.toBe("state-mismatch");
    expect(seen.exchanges).toBe(0);
  });

  it("refuses a missing state cookie", async () => {
    const { admin } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });

    await expect(
      completeDriveConnection({
        params: new URLSearchParams({ state: "state-1", code: "c" }),
        stateCookie: undefined,
        person: admin,
      }),
    ).resolves.toBe("state-mismatch");
  });

  it("matches the account case-insensitively", async () => {
    const { admin } = await people();
    stubTokenEndpoint({ exchange: goodExchange({ id_token: idToken("Bukti@Perusahaan.TEST") }) });

    await expect(callback(admin, {})).resolves.toBe("connected");
  });

  it("returns to /pengaturan with the outcome and clears the state cookie", async () => {
    const { admin } = await people();
    vi.mocked(resolvePerson).mockResolvedValue(admin);
    stubTokenEndpoint({ exchange: goodExchange({ scope: "openid email" }) });

    const response = await GET(
      new NextRequest("http://localhost:3001/api/drive/callback?state=s&code=c", {
        headers: { cookie: `${DRIVE_STATE_COOKIE}=s` },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3001/pengaturan?drive=scope-missing",
    );
    expect(response.headers.get("set-cookie")).toMatch(
      new RegExp(`^${DRIVE_STATE_COOKIE}=;.*Path=/api/drive/callback`),
    );
  });
});

describe("a successful connect", () => {
  it("stores the refresh token only encrypted, and it decrypts back", async () => {
    const { admin } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });

    await expect(callback(admin, {})).resolves.toBe("connected");

    const [row] = await rows();
    expect(row).toMatchObject({
      accountEmail: ACCOUNT,
      status: "connected",
      brokenAt: null,
      connectedByPersonId: admin.id,
      folderProblem: null,
      // Connecting is not a use; only a successful refresh sets it.
      lastUsedAt: null,
    });
    expect(JSON.stringify(row)).not.toContain("refresh-token-plaintext");
    expect(
      decryptRefreshToken({
        ciphertext: row!.refreshTokenCiphertext,
        iv: row!.refreshTokenIv,
        tag: row!.refreshTokenTag,
      }),
    ).toBe("refresh-token-plaintext");
  });

  it("creates the root, its two subfolders and the README, with _staging outside the root", async () => {
    const { admin } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });

    await callback(admin, {});

    const [row] = await rows();
    const root = drive.named(ROOT_FOLDER_NAME);
    const staging = drive.named(STAGING_FOLDER_NAME);
    const bukti = drive.named(BUKTI_TRANSAKSI_FOLDER_NAME);
    // `Pelaksanaan Offline` is the name of two folders now: one under each of Bukti Transaksi and
    // Dokumen (ADR-0042).
    const offline = drive
      .named(PELAKSANAAN_OFFLINE_FOLDER_NAME)
      .filter((folder) => folder.parents[0] === bukti[0]?.id);
    const readme = drive.named(README_NAME);
    for (const found of [root, staging, bukti, offline, readme]) expect(found).toHaveLength(1);

    expect(root[0]!.parents).toEqual([MY_DRIVE]);
    expect(staging[0]!.parents).toEqual([MY_DRIVE]);
    expect(bukti[0]!.parents).toEqual([root[0]!.id]);
    expect(offline[0]!.parents).toEqual([bukti[0]!.id]);
    expect(readme[0]!.parents).toEqual([root[0]!.id]);
    expect(new TextDecoder().decode(drive.files.get(readme[0]!.id)!.content)).toBe(README_TEXT);
    // The names themselves, written out: the product owner renamed the production folders to these
    // by hand, and a fresh connection must match them (#394).
    expect(root[0]!.name).toBe("SUGT ITB 2026 Internal App Object Storage");
    expect(staging[0]!.name).toBe("SUGT ITB 2026 _staging — jangan dibagikan");
    expect(README_TEXT).toBe(
      "Dikelola aplikasi SUGT ITB — jangan hapus, jangan ganti nama, jangan bagikan folder ini.",
    );

    expect(row).toMatchObject({
      rootFolderId: root[0]!.id,
      stagingFolderId: staging[0]!.id,
      buktiTransaksiFolderId: bukti[0]!.id,
      pelaksanaanOfflineFolderId: offline[0]!.id,
      readmeFileId: readme[0]!.id,
    });

    // `Dokumen/` and its `Pelaksanaan Offline/` beside Bukti Transaksi, made by the same connect.
    const dokumen = drive.named(DOKUMEN_FOLDER_NAME);
    expect(dokumen).toHaveLength(1);
    expect(dokumen[0]!.parents).toEqual([root[0]!.id]);
    const dokumenOffline = drive
      .named(PELAKSANAAN_OFFLINE_FOLDER_NAME)
      .filter((folder) => folder.parents[0] === dokumen[0]!.id);
    expect(dokumenOffline).toHaveLength(1);
    expect(row).toMatchObject({
      dokumenFolderId: dokumen[0]!.id,
      dokumenPelaksanaanOfflineFolderId: dokumenOffline[0]!.id,
    });

    // Both footage trees too: the archive (ADR-0046) and the upload tree (#561), side by side.
    const [ids] = await rows();
    for (const [name, treeId, pelaksanaanId] of [
      [FOOTAGE_FOLDER_NAME, ids!.footageFolderId, ids!.footagePelaksanaanOfflineFolderId],
      [
        FOOTAGE_UPLOAD_FOLDER_NAME,
        ids!.footageUploadFolderId,
        ids!.footageUploadPelaksanaanOfflineFolderId,
      ],
    ] as const) {
      const tree = drive.named(name);
      expect(tree).toHaveLength(1);
      expect(tree[0]).toMatchObject({ id: treeId, parents: [root[0]!.id] });
      expect(drive.files.get(pelaksanaanId!)?.parents).toEqual([treeId]);
    }
  });

  it("on reconnect, overwrites the token, reuses valid ids and recreates a missing subfolder", async () => {
    const { admin } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });
    await callback(admin, {});
    const [first] = await rows();
    drive.remove(first!.pelaksanaanOfflineFolderId!);

    stubTokenEndpoint({ exchange: goodExchange({ refresh_token: "second-refresh-token" }) });
    await expect(callback(admin, {})).resolves.toBe("connected");

    const [second] = await rows();
    expect(second).toMatchObject({
      rootFolderId: first!.rootFolderId,
      stagingFolderId: first!.stagingFolderId,
      buktiTransaksiFolderId: first!.buktiTransaksiFolderId,
      readmeFileId: first!.readmeFileId,
    });
    expect(second!.pelaksanaanOfflineFolderId).not.toBe(first!.pelaksanaanOfflineFolderId);
    await expect(drive.getFile(second!.pelaksanaanOfflineFolderId!)).resolves.toMatchObject({
      parents: [first!.buktiTransaksiFolderId],
      trashed: false,
    });
    expect(drive.named(ROOT_FOLDER_NAME)).toHaveLength(1);
    expect(
      decryptRefreshToken({
        ciphertext: second!.refreshTokenCiphertext,
        iv: second!.refreshTokenIv,
        tag: second!.refreshTokenTag,
      }),
    ).toBe("second-refresh-token");
  });

  it("recreates a missing Bukti Transaksi, and Pelaksanaan Offline inside the new one", async () => {
    const { admin } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });
    await callback(admin, {});
    const [first] = await rows();
    drive.remove(first!.buktiTransaksiFolderId!);

    await expect(callback(admin, {})).resolves.toBe("connected");

    const [second] = await rows();
    expect(second!.buktiTransaksiFolderId).not.toBe(first!.buktiTransaksiFolderId);
    expect(second!.pelaksanaanOfflineFolderId).not.toBe(first!.pelaksanaanOfflineFolderId);
    await expect(drive.getFile(second!.pelaksanaanOfflineFolderId!)).resolves.toMatchObject({
      parents: [second!.buktiTransaksiFolderId],
      trashed: false,
    });
  });

  it("records what it made when Drive fails partway, and a reconnect finishes without a second root", async () => {
    const { admin, staff } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });
    const createFolder = drive.createFolder.bind(drive);
    vi.spyOn(drive, "createFolder")
      .mockImplementationOnce(createFolder)
      .mockRejectedValueOnce(new DriveRequestError("files.create", 503));

    await expect(callback(admin, {})).resolves.toBe("folders-unfinished");

    const [first] = await rows();
    expect(first).toMatchObject({ status: "connected", folderProblem: "folders-unfinished" });
    expect(first!.rootFolderId).not.toBeNull();
    expect(first!.stagingFolderId).toBeNull();
    await expect(driveAccessToken(staff)).resolves.toEqual({
      outcome: "drive-folders-unresolved",
    });

    await expect(callback(admin, {})).resolves.toBe("connected");
    expect(drive.named(ROOT_FOLDER_NAME)).toHaveLength(1);
    await expect(rows()).resolves.toMatchObject([
      { rootFolderId: first!.rootFolderId, folderProblem: null },
    ]);
  });

  it("reports a trashed root without recreating it, and keeps the token", async () => {
    const { admin } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });
    await callback(admin, {});
    const [first] = await rows();
    drive.trash(first!.rootFolderId!);

    await expect(callback(admin, {})).resolves.toBe("root-trashed");

    const [second] = await rows();
    expect(second).toMatchObject({
      status: "connected",
      folderProblem: "root-trashed",
      rootFolderId: first!.rootFolderId,
    });
    expect(drive.named(ROOT_FOLDER_NAME)).toHaveLength(1);
    expect(drive.named(BUKTI_TRANSAKSI_FOLDER_NAME)).toHaveLength(1);
  });

  it("clears a folder problem once the root is restored and reconnected", async () => {
    const { admin } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });
    await callback(admin, {});
    const [first] = await rows();
    drive.trash(first!.stagingFolderId!);
    await expect(callback(admin, {})).resolves.toBe("staging-trashed");

    drive.restore(first!.stagingFolderId!);
    await expect(callback(admin, {})).resolves.toBe("connected");
    await expect(rows()).resolves.toMatchObject([{ folderProblem: null }]);
  });
});

describe("the drive_connection row", () => {
  it("is one row: the database refuses a second", async () => {
    const { admin } = await people();
    const row = {
      accountEmail: ACCOUNT,
      refreshTokenCiphertext: "c",
      refreshTokenIv: "i",
      refreshTokenTag: "t",
      status: "connected" as const,
      connectedByPersonId: admin.id,
    };
    await db.insert(schema.driveConnection).values(row);

    await expect(db.insert(schema.driveConnection).values(row)).rejects.toThrow();
    await expect(
      db.insert(schema.driveConnection).values({ ...row, singleton: false }),
    ).rejects.toThrow();
    await expect(rows()).resolves.toHaveLength(1);
  });
});

describe("driveAccessToken", () => {
  async function connected() {
    const { admin, staff } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });
    await callback(admin, {});
    return staff;
  }

  it("refreshes the stored token for any Staff member and records the use", async () => {
    const staff = await connected();
    const seen = stubTokenEndpoint({ refresh: { body: { access_token: "fresh-access" } } });

    await expect(driveAccessToken(staff)).resolves.toMatchObject({
      outcome: "ok",
      accessToken: "fresh-access",
    });
    expect(seen.refreshes).toEqual(["refresh-token-plaintext"]);
    const [row] = await rows();
    expect(row!.lastUsedAt).not.toBeNull();
  });

  it("marks the connection broken on invalid_grant, keeping the first failure's time", async () => {
    const staff = await connected();
    stubTokenEndpoint({ refresh: { status: 400, body: { error: "invalid_grant" } } });

    await expect(driveAccessToken(staff)).resolves.toEqual({ outcome: "drive-disconnected" });

    const [row] = await rows();
    expect(row!.status).toBe("broken");
    expect(row!.brokenAt).toBeInstanceOf(Date);

    // A second refusal finds it already broken; so does a direct second mark.
    await expect(driveAccessToken(staff)).resolves.toEqual({ outcome: "drive-disconnected" });
    await markDriveConnectionBroken(staff);
    await expect(rows()).resolves.toMatchObject([{ brokenAt: row!.brokenAt }]);
  });

  it("does not record a use on a broken row", async () => {
    const staff = await connected();
    await markDriveConnectionBroken(staff);

    await touchDriveConnection(staff, `openid email ${DRIVE_SCOPE}`);

    await expect(rows()).resolves.toMatchObject([{ status: "broken", lastUsedAt: null }]);
  });

  it("answers drive-folders-unresolved, asking Google nothing, while _staging is in the trash", async () => {
    const { admin, staff } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });
    await callback(admin, {});
    drive.trash((await rows())[0]!.stagingFolderId!);
    await callback(admin, {});
    const seen = stubTokenEndpoint({});

    await expect(driveAccessToken(staff)).resolves.toEqual({
      outcome: "drive-folders-unresolved",
    });
    expect(seen.refreshes).toHaveLength(0);
  });

  it.each([
    ["a different key", Buffer.alloc(32, 7).toString("base64")],
    ["a key of the wrong length", Buffer.alloc(3, 7).toString("base64")],
  ])("marks the connection broken when the token will not decrypt under %s", async (_, key) => {
    const staff = await connected();
    const seen = stubTokenEndpoint({});
    vi.stubEnv("DRIVE_TOKEN_KEY", key);

    await expect(driveAccessToken(staff)).resolves.toEqual({ outcome: "drive-disconnected" });

    expect(seen.refreshes).toHaveLength(0);
    await expect(rows()).resolves.toMatchObject([{ status: "broken" }]);
  });

  it("leaves the connection alone when Google is unreachable", async () => {
    const staff = await connected();
    stubTokenEndpoint({ refresh: { status: 503, body: {} } });

    await expect(driveAccessToken(staff)).resolves.toEqual({ outcome: "drive-unreachable" });
    await expect(rows()).resolves.toMatchObject([{ status: "connected", brokenAt: null }]);
  });

  it("returns a reconnect to Terhubung", async () => {
    const { admin, staff } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });
    await callback(admin, {});
    stubTokenEndpoint({ refresh: { status: 400, body: { error: "invalid_grant" } } });
    await driveAccessToken(staff);

    stubTokenEndpoint({ exchange: goodExchange({ refresh_token: "after-reconnect" }) });
    await expect(callback(admin, {})).resolves.toBe("connected");

    await expect(rows()).resolves.toMatchObject([{ status: "connected", brokenAt: null }]);
  });

  it("answers drive-disconnected with no row, without calling Google", async () => {
    const { staff } = await people();
    const seen = stubTokenEndpoint({});

    await expect(driveAccessToken(staff)).resolves.toEqual({ outcome: "drive-disconnected" });
    expect(seen.refreshes).toHaveLength(0);
  });
});

describe("the Pengaturan card", () => {
  /** The page as an Administrator sees it, as text, with `?drive=` set to `outcome` when given. */
  async function pageText(admin: Person, drive?: string) {
    vi.mocked(requirePerson).mockResolvedValue(admin);
    const page = await Page({ searchParams: Promise.resolve(drive ? { drive } : {}) } as never);
    return renderToStaticMarkup(page)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
  }

  it("reads Belum terhubung with no row", async () => {
    const { admin } = await people();

    const text = await pageText(admin);

    expect(text).toContain("Belum terhubung");
    expect(text).toContain("Hubungkan Google Drive");
  });

  it("reads Terhubung with the account, who connected it and the root link", async () => {
    const { admin } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });
    await callback(admin, {});
    const [row] = await rows();

    const text = await pageText(admin, "connected");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) } as never));

    expect(text).toContain("Google Drive terhubung.");
    expect(text).toContain("Terhubung");
    expect(text).toContain(ACCOUNT);
    expect(text).toContain("Admin,");
    expect(text).toContain("Hubungkan ulang");
    expect(html).toContain(`https://drive.google.com/drive/folders/${row!.rootFolderId}`);
  });

  it("says the connection needs widening while its token lacks the full drive scope (#562)", async () => {
    const { admin, staff } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });
    await callback(admin, {});
    const widen = "Akses Drive perlu diperluas untuk menyalin Foto &amp; Video — hubungkan ulang.";
    expect(await pageText(admin)).not.toContain(widen);

    // A connection from before #562: its refresh reports `drive.file` only, and the card says so.
    stubTokenEndpoint({
      refresh: { body: { access_token: "a", scope: `openid email ${DRIVE_FILE_SCOPE}` } },
    });
    await expect(driveAccessToken(staff)).resolves.toMatchObject({ outcome: "ok" });
    const text = await pageText(admin);
    expect(text).toContain("Terhubung");
    expect(text).toContain(widen);
  });

  it("reads Terputus sejak … once the token is refused", async () => {
    const { admin, staff } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });
    await callback(admin, {});
    stubTokenEndpoint({ refresh: { status: 400, body: { error: "invalid_grant" } } });
    await driveAccessToken(staff);

    const text = await pageText(admin);

    expect(text).toMatch(/Terputus sejak \d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB/);
    expect(text).not.toContain("Terhubung");
  });

  it("does not claim Terhubung while the root is in the trash", async () => {
    const { admin } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });
    await callback(admin, {});
    drive.trash((await rows())[0]!.rootFolderId!);
    await callback(admin, {});

    const text = await pageText(admin);

    expect(text).toContain("Folder utama ada di Sampah Google Drive");
    expect(text).not.toContain("Terhubung");
  });

  it("does not claim Terhubung while the tree is unfinished", async () => {
    const { admin } = await people();
    stubTokenEndpoint({ exchange: goodExchange() });
    vi.spyOn(drive, "createFolder").mockRejectedValueOnce(
      new DriveRequestError("files.create", 503),
    );
    await callback(admin, {});

    const text = await pageText(admin);

    expect(text).toContain("Google Drive gagal saat menyiapkan folder");
    expect(text).not.toContain("Terhubung");
  });

  it("names the wrong-account outcome with the company account, and ignores anything else", async () => {
    const { admin } = await people();

    await expect(pageText(admin, "wrong-account")).resolves.toContain(
      `Akun yang dipilih bukan ${ACCOUNT}. Pilih akun perusahaan.`,
    );
    // An unknown value is ignored outright — the URL never carries text onto the page.
    await expect(pageText(admin, "<b>forged</b>")).resolves.toBe(await pageText(admin));
  });
});
