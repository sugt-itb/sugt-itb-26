import { openDrive } from "-/lib/drive/google";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **The Drive client's permission calls, on the wire** (#552): what `openDrive` sends Google when it
 * shares a footage folder. `fetch` is stubbed at the network boundary; nothing else is faked.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown = { id: "p1" }) {
  const fetch = vi.fn(async () => Response.json(body));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("Drive permissions", () => {
  it("gives a user edit access without Drive's notification email", async () => {
    const fetch = stubFetch();

    await openDrive("token").createPermission("folder-1", {
      type: "user",
      role: "writer",
      emailAddress: "rina@itb.ac.id",
    });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get("sendNotificationEmail")).toBe("false");
    expect(JSON.parse(init.body as string)).toEqual({
      type: "user",
      role: "writer",
      emailAddress: "rina@itb.ac.id",
    });
  });

  it("asks nothing about notifications for a link share", async () => {
    const fetch = stubFetch();

    await openDrive("token").createPermission("folder-1", { type: "anyone", role: "reader" });

    const [url] = fetch.mock.calls[0] as unknown as [string];
    expect(new URL(url).searchParams.has("sendNotificationEmail")).toBe(false);
  });

  it("deletes one permission, and lists each with its email", async () => {
    const fetch = stubFetch({
      permissions: [
        { id: "p1", type: "user", role: "writer", emailAddress: "rina@itb.ac.id" },
        { id: "p2", type: "anyone", role: "reader" },
      ],
    });
    const drive = openDrive("token");

    await drive.deletePermission("folder-1", "p1");
    const [deleteUrl, deleteInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(deleteInit.method).toBe("DELETE");
    expect(new URL(deleteUrl).pathname).toBe("/drive/v3/files/folder-1/permissions/p1");

    await expect(drive.listPermissions("folder-1")).resolves.toEqual([
      { id: "p1", type: "user", role: "writer", emailAddress: "rina@itb.ac.id", inherited: false },
      { id: "p2", type: "anyone", role: "reader", emailAddress: null, inherited: false },
    ]);
    const [listUrl] = fetch.mock.calls[1] as unknown as [string];
    expect(new URL(listUrl).searchParams.get("fields")).toContain("emailAddress");
  });
});
