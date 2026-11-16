import {
  DriveRequestError,
  FOLDER_MIME_TYPE,
  SHORTCUT_MIME_TYPE,
  type DriveChild,
  type DriveClient,
  type DriveFile,
  type DrivePermission,
  type NewDrivePermission,
} from "./google";

/**
 * **An in-memory Google Drive, for Vitest only** — the fake `google.ts` promises. Nothing in the app
 * imports it; a test swaps `openDrive` for it, so no test touches the network. It models only what
 * ADR-0040 relies on, as the #370 spike observed it:
 *
 * - **Trashing a folder trashes what is inside it**, so `getFile` on a child reports `trashed`.
 * - **Permissions are inherited**: `listPermissions` on an item includes every permission on a folder
 *   above it, marked `inherited` — what Periksa koneksi's safety check reads.
 * - **Uploads declare their size**: `land` — the browser's `PUT` — refuses bytes of another length.
 * - **Some emails cannot be shared with**: one in `refusedEmails` — not a Google account, say — is
 *   refused with a 400, as Drive refuses it.
 * - **Every item has an owner** (#562): what the app makes, a copy included, is the company account's
 *   (`COMPANY_ACCOUNT`); `upload` puts a file there as a Staff member, owned by them. A copy a test
 *   makes Drive refuse (`refusedCopies`) fails with Google's own reason.
 *
 * Later tickets extend it rather than mocking Drive ad hoc. `calls` counts every operation, so a
 * test can assert that a refused write reached Drive **zero** times.
 */

type StoredFile = Omit<DriveFile, "trashed"> & {
  /** Trashed by itself; a child of a trashed folder is trashed too, without this flag. */
  explicitlyTrashed: boolean;
  content: Uint8Array;
  permissions: { id: string; type: string; role: string; emailAddress: string | null }[];
  /** Whose file it is: `COMPANY_ACCOUNT` for anything the app made. */
  owner: string;
};

type Session = {
  name: string;
  parentId: string;
  mimeType: string;
  size: number;
  origin: string;
  appProperties: Record<string, string>;
};

/** The id Drive gives the top of My Drive. A folder created with no parent lands there. */
export const MY_DRIVE = "root";

/** The connected company account: the owner of everything the app makes. */
export const COMPANY_ACCOUNT = "sugt-company@gmail.com";

export class FakeDrive implements DriveClient {
  readonly files = new Map<string, StoredFile>();
  readonly sessions = new Map<string, Session>();
  /** Emails Drive will not share with — a test adds to it. */
  readonly refusedEmails = new Set<string>();
  /** Files whose copy Drive refuses, with the HTTP status and Google's reason — a test adds to it. */
  readonly refusedCopies = new Map<string, { status: number; reason: string }>();
  calls = 0;
  private nextId = 1;

  async createFolder(input: {
    name: string;
    parentId?: string;
    appProperties?: Record<string, string>;
  }) {
    this.calls += 1;
    return {
      id: this.store({
        name: input.name,
        mimeType: FOLDER_MIME_TYPE,
        parents: [input.parentId ?? MY_DRIVE],
        appProperties: input.appProperties ?? {},
      }),
    };
  }

  async createFile(input: { name: string; parentId: string; mimeType: string; content: string }) {
    this.calls += 1;
    return {
      id: this.store({
        name: input.name,
        mimeType: input.mimeType,
        parents: [input.parentId],
        content: new TextEncoder().encode(input.content),
      }),
    };
  }

  async getFile(id: string): Promise<DriveFile | null> {
    this.calls += 1;
    return this.view(id);
  }

  async updateFile(
    id: string,
    input: {
      name?: string;
      addParent?: string;
      removeParent?: string;
      appProperties?: Record<string, string>;
    },
  ) {
    this.calls += 1;
    const file = this.require("files.update", id);
    if (input.name) file.name = input.name;
    if (input.removeParent) file.parents = file.parents.filter((p) => p !== input.removeParent);
    if (input.addParent) file.parents = [...file.parents, input.addParent];
    if (input.appProperties) file.appProperties = { ...file.appProperties, ...input.appProperties };
  }

  async trashFile(id: string) {
    this.calls += 1;
    this.require("files.update(trash)", id).explicitlyTrashed = true;
  }

  async untrashFile(id: string) {
    this.calls += 1;
    this.require("files.update(untrash)", id).explicitlyTrashed = false;
  }

  async readRange(id: string, start: number, end: number) {
    this.calls += 1;
    return this.require("files.get(media)", id).content.slice(start, end + 1);
  }

  async createPermission(id: string, permission: NewDrivePermission) {
    this.calls += 1;
    const file = this.require("permissions.create", id);
    const emailAddress = permission.type === "user" ? permission.emailAddress : null;
    if (emailAddress !== null && this.refusedEmails.has(emailAddress)) {
      throw new DriveRequestError("permissions.create", 400);
    }
    file.permissions.push({
      id: `perm-${this.nextId++}`,
      type: permission.type,
      role: permission.role,
      emailAddress,
    });
  }

  async deletePermission(id: string, permissionId: string) {
    this.calls += 1;
    const file = this.require("permissions.delete", id);
    const before = file.permissions.length;
    file.permissions = file.permissions.filter((p) => p.id !== permissionId);
    if (file.permissions.length === before) throw new DriveRequestError("permissions.delete", 404);
  }

  async listPermissions(id: string): Promise<DrivePermission[]> {
    this.calls += 1;
    const own = this.require("permissions.list", id).permissions.map((p) => ({
      ...p,
      inherited: false,
    }));
    const inherited = this.ancestors(id).flatMap((ancestor) =>
      ancestor.permissions.map((p) => ({ ...p, inherited: true })),
    );
    return [...own, ...inherited];
  }

  async listChildren(folderId: string): Promise<DriveChild[]> {
    this.calls += 1;
    return [...this.files.values()]
      .filter((file) => file.parents.includes(folderId))
      .map((file) => {
        const view = this.view(file.id)!;
        return {
          id: view.id,
          name: view.name,
          mimeType: view.mimeType,
          trashed: view.trashed,
          appProperties: { ...view.appProperties },
          ownerEmail: file.owner,
        };
      });
  }

  async copyFile(
    id: string,
    input: { name: string; parentId: string; appProperties: Record<string, string> },
  ) {
    this.calls += 1;
    const original = this.require("files.copy", id);
    const refused = this.refusedCopies.get(id);
    if (refused) throw new DriveRequestError("files.copy", refused.status, refused.reason);
    this.require("files.copy", input.parentId);
    return {
      id: this.store({
        name: input.name,
        mimeType: original.mimeType,
        parents: [input.parentId],
        appProperties: input.appProperties,
        content: original.content.slice(),
      }),
    };
  }

  async openResumableSession(input: {
    name: string;
    parentId: string;
    mimeType: string;
    size: number;
    origin: string;
    appProperties?: Record<string, string>;
  }) {
    this.calls += 1;
    const sessionUri = `https://upload.fake-drive.test/session/${this.nextId++}`;
    this.sessions.set(sessionUri, {
      name: input.name,
      parentId: input.parentId,
      mimeType: input.mimeType,
      size: input.size,
      origin: input.origin,
      appProperties: input.appProperties ?? {},
    });
    return { sessionUri };
  }

  // ── Test helpers: what a browser, or a person in the Drive UI, does. Not part of DriveClient. ──

  /**
   * The browser's `PUT` to a session. Drive refuses bytes of any other length than was declared,
   * creating nothing — the size enforcement #370 observed.
   */
  land(sessionUri: string, bytes: Uint8Array): { id: string } {
    const session = this.sessions.get(sessionUri);
    if (!session) throw new Error(`No upload session ${sessionUri}`);
    if (bytes.length !== session.size) throw new DriveRequestError("upload", 400);
    this.sessions.delete(sessionUri);
    return {
      id: this.store({
        name: session.name,
        mimeType: session.mimeType,
        parents: [session.parentId],
        appProperties: session.appProperties,
        content: bytes,
      }),
    };
  }

  /** A permission someone added by hand in the Drive UI — the owner's, a commenter's, anything. */
  share(id: string, permission: { type: string; role: string; emailAddress?: string }): string {
    const permissionId = `perm-${this.nextId++}`;
    this.require("share", id).permissions.push({
      id: permissionId,
      type: permission.type,
      role: permission.role,
      emailAddress: permission.emailAddress ?? null,
    });
    return permissionId;
  }

  /**
   * **A Staff member puts a file (or a folder) into a folder through Drive** (#562): owned by them,
   * not by the company account.
   */
  upload(
    parentId: string,
    input: { name: string; owner: string; mimeType?: string; content?: string },
  ): string {
    this.require("upload", parentId);
    return this.store({
      name: input.name,
      mimeType: input.mimeType ?? "image/jpeg",
      parents: [parentId],
      content: new TextEncoder().encode(input.content ?? input.name),
      owner: input.owner,
    });
  }

  /** A Staff member adds a Drive shortcut to `targetId` in a folder. */
  shortcut(parentId: string, targetId: string, owner: string): string {
    return this.upload(parentId, {
      name: `Pintasan ke ${this.require("shortcut", targetId).name}`,
      owner,
      mimeType: SHORTCUT_MIME_TYPE,
    });
  }

  /** Move to the Drive trash, as a person would. Children follow. */
  trash(id: string) {
    this.require("trash", id).explicitlyTrashed = true;
  }

  /** Restore from the Drive trash. */
  restore(id: string) {
    this.require("restore", id).explicitlyTrashed = false;
  }

  /** Delete for good, as emptying the trash would. */
  remove(id: string) {
    this.files.delete(id);
  }

  /** Every stored item named `name`, trashed or not. */
  named(name: string): DriveFile[] {
    return [...this.files.keys()].map((id) => this.view(id)!).filter((file) => file.name === name);
  }

  private store(input: {
    name: string;
    mimeType: string;
    parents: string[];
    appProperties?: Record<string, string>;
    content?: Uint8Array;
    owner?: string;
  }): string {
    const id = `fake-${this.nextId++}`;
    const content = input.content ?? new Uint8Array();
    this.files.set(id, {
      id,
      name: input.name,
      mimeType: input.mimeType,
      parents: input.parents,
      size: input.mimeType === FOLDER_MIME_TYPE ? null : content.length,
      appProperties: input.appProperties ?? {},
      explicitlyTrashed: false,
      content,
      permissions: [],
      owner: input.owner ?? COMPANY_ACCOUNT,
    });
    return id;
  }

  private view(id: string): DriveFile | null {
    const file = this.files.get(id);
    if (!file) return null;
    const {
      explicitlyTrashed,
      content: _content,
      permissions: _permissions,
      owner: _owner,
      ...rest
    } = file;
    const trashed = explicitlyTrashed || this.ancestors(id).some((a) => a.explicitlyTrashed);
    return { ...rest, parents: [...rest.parents], trashed };
  }

  private ancestors(id: string): StoredFile[] {
    const found: StoredFile[] = [];
    let parentId = this.files.get(id)?.parents[0];
    while (parentId && parentId !== MY_DRIVE) {
      const parent = this.files.get(parentId);
      if (!parent) break;
      found.push(parent);
      parentId = parent.parents[0];
    }
    return found;
  }

  private require(operation: string, id: string): StoredFile {
    const file = this.files.get(id);
    if (!file) throw new DriveRequestError(operation, 404);
    return file;
  }
}
