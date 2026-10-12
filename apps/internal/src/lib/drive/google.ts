import { requireEnv } from "-/lib/env";

/**
 * **The one module that talks to Google** for the company Drive (ADR-0040): the OAuth token endpoint
 * and Drive v3 REST, over plain `fetch`. No `googleapis` dependency, for the reason ADR-0033 avoided
 * it — a large client for a handful of calls.
 *
 * It is split in two on purpose, along the line the tests fake:
 * - **The token endpoint** (`exchangeDriveCode`, `refreshDriveAccessToken`) is real code the tests
 *   reach, with `fetch` stubbed at the network boundary — the way `tests/support/google.ts` stubs it
 *   for sign-in.
 * - **Drive itself** is the `DriveClient` interface `openDrive` returns. Its in-memory fake,
 *   `fake-drive.ts`, sits beside it; a test swaps `openDrive` for the fake and never touches the
 *   network. Later tickets extend that fake rather than mocking Drive ad hoc.
 *
 * The client id and secret are the **"sugt Drive connector"** client's, not the sign-in client's.
 * `drive.file` access to every file the app made belongs to that client, so it is never replaced.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/** Where Google sends the Administrator back. Registered on the connector client (#369). */
export const DRIVE_CALLBACK_PATH = "/api/drive/callback";

/**
 * The redirect URI, built on `BETTER_AUTH_URL` — the internal app's own base URL, which the Session
 * and Perjadin feedback links already build on. (`INTERNAL_APP_URL` is the public app's name for it.)
 */
function redirectUri(): string {
  return `${requireEnv("BETTER_AUTH_URL")}${DRIVE_CALLBACK_PATH}`;
}

/**
 * Google's consent screen for the company account. `prompt=consent` with `access_type=offline` is
 * what makes Google issue a refresh token every time, a reconnect included; `login_hint` pre-selects
 * the pinned account, though the callback still checks which one came back.
 */
export function driveAuthorizationUrl(state: string): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: requireEnv("GOOGLE_DRIVE_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: `openid email ${DRIVE_FILE_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    login_hint: requireEnv("GOOGLE_DRIVE_ACCOUNT_EMAIL"),
    state,
  }).toString();
  return url.toString();
}

export type CodeExchange =
  | {
      ok: true;
      accessToken: string;
      /** Absent when Google sent none — the callback refuses that (check 7). */
      refreshToken: string | null;
      /** The space-separated scopes the account actually granted. */
      scope: string;
      /** The email in the id_token, or null when it carried none. */
      email: string | null;
    }
  | { ok: false };

/** Trade the callback's `code` for tokens. Any non-2xx, or an unreadable body, is `{ ok: false }`. */
export async function exchangeDriveCode(code: string): Promise<CodeExchange> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: requireEnv("GOOGLE_DRIVE_CLIENT_ID"),
        client_secret: requireEnv("GOOGLE_DRIVE_CLIENT_SECRET"),
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
    });
  } catch {
    return { ok: false };
  }
  if (!response.ok) return { ok: false };

  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    id_token?: string;
  } | null;
  if (!body?.access_token) return { ok: false };

  return {
    ok: true,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    scope: body.scope ?? "",
    email: body.id_token ? idTokenEmail(body.id_token) : null,
  };
}

/**
 * The id_token's `email` claim, **decoded, not verified**. The token came straight from Google's
 * token endpoint over TLS in answer to our own client secret, which is the case OpenID Connect lets
 * skip signature validation (Core §3.1.3.7). A token handed in by a browser would need verifying.
 */
function idTokenEmail(idToken: string): string | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: unknown;
    };
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

export type TokenRefresh =
  | { ok: true; accessToken: string }
  /** Google refused the refresh token itself: revoked, expired, or the grant was removed. */
  | { ok: false; reason: "invalid-grant" }
  /** Anything else — the network, a 5xx. Says nothing about the token. */
  | { ok: false; reason: "unreachable" };

/** Swap the stored refresh token for a short-lived access token. */
export async function refreshDriveAccessToken(refreshToken: string): Promise<TokenRefresh> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: requireEnv("GOOGLE_DRIVE_CLIENT_ID"),
        client_secret: requireEnv("GOOGLE_DRIVE_CLIENT_SECRET"),
        grant_type: "refresh_token",
      }),
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    error?: string;
  } | null;
  if (response.ok && body?.access_token) return { ok: true, accessToken: body.access_token };
  if (body?.error === "invalid_grant") return { ok: false, reason: "invalid-grant" };
  return { ok: false, reason: "unreachable" };
}

/** A Drive file or folder, with the fields this app reads. */
export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  /** Bytes. Absent for folders. */
  size: number | null;
  appProperties: Record<string, string>;
};

export type DrivePermission = {
  id: string;
  type: string;
  role: string;
  /** True when the permission reaches this item from a folder above it. */
  inherited: boolean;
};

/**
 * **The narrow set of Drive operations ADR-0040 needs**, and nothing else. Each throws a
 * `DriveRequestError` on a non-2xx, except `getFile`, which answers `null` for a 404 — "is it still
 * there" is a question, not a failure.
 */
export interface DriveClient {
  /** A folder; at the top of My Drive when `parentId` is omitted. */
  createFolder(input: {
    name: string;
    parentId?: string;
    appProperties?: Record<string, string>;
  }): Promise<{ id: string }>;
  /** A small file with its content in one request — the README. */
  createFile(input: {
    name: string;
    parentId: string;
    mimeType: string;
    content: string;
  }): Promise<{ id: string }>;
  getFile(id: string): Promise<DriveFile | null>;
  /** Rename, move, or add `appProperties`. */
  updateFile(
    id: string,
    input: {
      name?: string;
      addParent?: string;
      removeParent?: string;
      appProperties?: Record<string, string>;
    },
  ): Promise<void>;
  /** Move to the Drive trash — the loser of a folder compare-and-set throws its folder away. */
  trashFile(id: string): Promise<void>;
  /** Take back out of the Drive trash — a Hapus bukti the database refused after its trash (#462). */
  untrashFile(id: string): Promise<void>;
  /** Bytes `start` to `end` inclusive, for sniffing a file's type from its first bytes. */
  readRange(id: string, start: number, end: number): Promise<Uint8Array>;
  createPermission(id: string, permission: { type: "anyone"; role: "reader" }): Promise<void>;
  listPermissions(id: string): Promise<DrivePermission[]>;
  /**
   * A resumable upload session the browser `PUT`s to. `origin` is the uploading page's, and is
   * required: without it the bytes land but the browser cannot read the response (#370).
   */
  openResumableSession(input: {
    name: string;
    parentId: string;
    mimeType: string;
    size: number;
    origin: string;
    appProperties?: Record<string, string>;
  }): Promise<{ sessionUri: string }>;
}

export class DriveRequestError extends Error {
  override readonly name = "DriveRequestError";

  constructor(
    readonly operation: string,
    /** The HTTP status, or 0 when the request never got an answer — the network, a timeout. */
    readonly status: number,
  ) {
    super(
      status === 0
        ? `Google Drive ${operation} got no answer.`
        : `Google Drive ${operation} failed with HTTP ${status}.`,
    );
  }
}

/**
 * Did a Drive call fail? Every one this client makes fails as a `DriveRequestError` — a non-2xx, or
 * status 0 for no answer at all — so that is the whole test. Those are Google's to answer for and
 * become "not synced yet"; anything else, a database refusal included, is a bug and is left to throw.
 */
export function isDriveFailure(error: unknown): error is DriveRequestError {
  return error instanceof DriveRequestError;
}

/** A 2xx body Drive sent, parsed; one that is not JSON is Drive failing too, not a bug here. */
async function readJson<T>(operation: string, response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new DriveRequestError(operation, response.status);
  }
}

/**
 * Is a folder shared "anyone with the link can view" **on itself** — the one share the app makes on a
 * transaction folder (ADR-0040)? An inherited one does not count: it is not the app's, and the
 * folder above can stop sharing at any time.
 */
export function isLinkShared(permissions: DrivePermission[]): boolean {
  return permissions.some(
    (permission) =>
      !permission.inherited && permission.type === "anyone" && permission.role === "reader",
  );
}

/** `fetch`, with a request that got no answer turned into a `DriveRequestError` of status 0. */
async function send(operation: string, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new DriveRequestError(operation, 0);
  }
}

const FILE_FIELDS = "id,name,mimeType,parents,trashed,size,appProperties";

/** The real client, over Drive v3 REST, for one access token. */
export function openDrive(accessToken: string): DriveClient {
  const authorization = { authorization: `Bearer ${accessToken}` };

  async function call(operation: string, url: string, init: RequestInit = {}): Promise<Response> {
    const response = await send(operation, url, {
      ...init,
      headers: { ...authorization, ...(init.headers as Record<string, string> | undefined) },
    });
    if (!response.ok) throw new DriveRequestError(operation, response.status);
    return response;
  }

  return {
    async createFolder({ name, parentId, appProperties }) {
      const response = await call("files.create", `${DRIVE_API}/files?fields=id`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: FOLDER_MIME_TYPE,
          ...(parentId ? { parents: [parentId] } : {}),
          ...(appProperties ? { appProperties } : {}),
        }),
      });
      return readJson<{ id: string }>("files.create", response);
    },

    async createFile({ name, parentId, mimeType, content }) {
      const boundary = `sugt-${crypto.randomUUID()}`;
      const body =
        `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify({ name, mimeType, parents: [parentId] })}\r\n` +
        `--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--`;
      const response = await call(
        "files.create",
        `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`,
        {
          method: "POST",
          headers: { "content-type": `multipart/related; boundary=${boundary}` },
          body,
        },
      );
      return readJson<{ id: string }>("files.create", response);
    },

    async getFile(id) {
      const response = await send(
        "files.get",
        `${DRIVE_API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS}`,
        { headers: authorization },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new DriveRequestError("files.get", response.status);
      const file = await readJson<{
        id: string;
        name: string;
        mimeType: string;
        parents?: string[];
        trashed?: boolean;
        size?: string;
        appProperties?: Record<string, string>;
      }>("files.get", response);
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        parents: file.parents ?? [],
        trashed: file.trashed ?? false,
        size: file.size === undefined ? null : Number(file.size),
        appProperties: file.appProperties ?? {},
      };
    },

    async updateFile(id, { name, addParent, removeParent, appProperties }) {
      const params = new URLSearchParams({ fields: "id" });
      if (addParent) params.set("addParents", addParent);
      if (removeParent) params.set("removeParents", removeParent);
      await call("files.update", `${DRIVE_API}/files/${encodeURIComponent(id)}?${params}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(name ? { name } : {}),
          ...(appProperties ? { appProperties } : {}),
        }),
      });
    },

    async trashFile(id) {
      await call("files.update(trash)", `${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      });
    },

    async untrashFile(id) {
      await call(
        "files.update(untrash)",
        `${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ trashed: false }),
        },
      );
    },

    async readRange(id, start, end) {
      const response = await call(
        "files.get(media)",
        `${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`,
        { headers: { range: `bytes=${start}-${end}` } },
      );
      return new Uint8Array(await response.arrayBuffer());
    },

    async createPermission(id, permission) {
      await call(
        "permissions.create",
        `${DRIVE_API}/files/${encodeURIComponent(id)}/permissions?fields=id`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(permission),
        },
      );
    },

    async listPermissions(id) {
      const response = await call(
        "permissions.list",
        `${DRIVE_API}/files/${encodeURIComponent(id)}/permissions?fields=permissions(id,type,role,permissionDetails)`,
      );
      const body = await readJson<{
        permissions?: {
          id: string;
          type: string;
          role: string;
          permissionDetails?: { inherited?: boolean }[];
        }[];
      }>("permissions.list", response);
      return (body.permissions ?? []).map((permission) => ({
        id: permission.id,
        type: permission.type,
        role: permission.role,
        inherited: (permission.permissionDetails ?? []).some((detail) => detail.inherited),
      }));
    },

    async openResumableSession({ name, parentId, mimeType, size, origin, appProperties }) {
      const response = await call(
        "files.create(resumable)",
        `${DRIVE_UPLOAD_API}/files?uploadType=resumable`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json; charset=UTF-8",
            origin,
            "x-upload-content-type": mimeType,
            "x-upload-content-length": String(size),
          },
          body: JSON.stringify({
            name,
            parents: [parentId],
            ...(appProperties ? { appProperties } : {}),
          }),
        },
      );
      const sessionUri = response.headers.get("location");
      if (!sessionUri) throw new DriveRequestError("files.create(resumable)", response.status);
      return { sessionUri };
    },
  };
}
