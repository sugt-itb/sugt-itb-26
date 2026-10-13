import DashboardPage from "-/app/(app)/page";
import { GoogleSignInButton } from "-/app/masuk/google-sign-in-button";
import SignInPage from "-/app/masuk/page";
import { getPerson, requirePerson, type Person } from "-/lib/person";
import { safeDestination, signInPath } from "-/lib/sign-in-destination";
import { proxy } from "-/proxy";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addPerson, resetDatabase } from "./support/fixtures";
import { SIGN_IN_PATH, signInWithGoogle } from "./support/sign-in";

/**
 * **A deep link survives sign-in (#502)**, and nothing else does.
 *
 * Driven at the three places the destination passes through — the proxy that writes `?next`,
 * the sign-in screen that reads it, and Better Auth's real handler that lands the visitor on it
 * — plus the open-redirect table every reader shares. The page's own guard is the fourth place,
 * and it is driven to show it is still the one that refuses.
 */

vi.mock("-/lib/person", async (importOriginal) => ({
  ...(await importOriginal<typeof import("-/lib/person")>()),
  getPerson: vi.fn(),
  requirePerson: vi.fn(),
}));

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

/** Destinations a Person can genuinely be sent to, each with the path it lands on. */
const ACCEPTED: [string, string][] = [
  ["/feedback", "/feedback"],
  ["/sesi-daring", "/sesi-daring"],
  [
    "/perjadin/0b7f0c4e-6f5a-4c4e-9d1e-2a4f8f2c9b11",
    "/perjadin/0b7f0c4e-6f5a-4c4e-9d1e-2a4f8f2c9b11",
  ],
  ["/feedback?tab=perjadin&urut=skor", "/feedback?tab=perjadin&urut=skor"],
  // Re-encoded into the shape Better Auth takes: a comma or a space in the query is fine once encoded.
  ["/log?jenis=a,b&q=Pak Budi", "/log?jenis=a%2Cb&q=Pak+Budi"],
  // Next's client router marks the RSC fetch with `_rsc`; a person never needs to land on it.
  ["/feedback?tab=perjadin&_rsc=1x2y3", "/feedback?tab=perjadin"],
  // The fragment never reaches a server, so it is not carried.
  ["/feedback#atas", "/feedback"],
];

/** Every way to name somewhere that is not a path on this app. Each falls back to the default. */
const REFUSED: [string, unknown][] = [
  ["an absolute URL", "https://evil.example/masuk"],
  ["an absolute URL on our own scheme", "http://localhost:3001/feedback"],
  ["a protocol-relative URL", "//evil.example"],
  ["a protocol-relative URL with a path", "//evil.example/feedback"],
  ["a backslash after the slash", "/\\evil.example"],
  ["a leading backslash pair", "\\\\evil.example"],
  ["a backslash anywhere", "/feedback\\..\\..\\evil"],
  ["an encoded slash after the slash", "/%2fevil.example"],
  ["an encoded backslash after the slash", "/%5Cevil.example"],
  ["a tab between the slashes", "/\t/evil.example"],
  ["a newline between the slashes", "/\n/evil.example"],
  ["a javascript: URL", "javascript:alert(1)"],
  ["a javascript: URL behind a slash", "/javascript:alert(1)"],
  ["a data: URL", "data:text/html,<script>alert(1)</script>"],
  ["a bare host", "evil.example"],
  ["a relative path", "feedback"],
  ["an empty string", ""],
  ["a repeated parameter", ["/feedback", "//evil.example"]],
  ["no parameter", undefined],
];

describe("safeDestination — the open-redirect table", () => {
  it.each(ACCEPTED)("honours %j as %j", (value, landing) => {
    expect(safeDestination(value)).toBe(landing);
  });

  it.each(REFUSED)("refuses %s", (_, value) => {
    expect(safeDestination(value as string | string[] | undefined)).toBeNull();
  });
});

describe("the proxy carries the requested page to /masuk", () => {
  function signedOut(path: string) {
    return proxy(new NextRequest(`http://localhost:3001${path}`));
  }

  function redirectedTo(response: Response) {
    expect(response.status).toBe(307);
    return new URL(response.headers.get("location")!);
  }

  it("with its path and query string", () => {
    const location = redirectedTo(signedOut("/feedback?tab=perjadin&urut=skor"));

    expect(location.pathname).toBe(SIGN_IN_PATH);
    expect(location.searchParams.get("next")).toBe("/feedback?tab=perjadin&urut=skor");
  });

  it("and a reader of `?next` lands on exactly what was asked for", () => {
    const location = redirectedTo(signedOut("/sesi-daring"));

    expect(safeDestination(location.searchParams.get("next"))).toBe("/sesi-daring");
  });

  it("including the bare root, which the Unified Dashboard's Progress figure links to", () => {
    expect(redirectedTo(signedOut("/")).searchParams.get("next")).toBe("/");
  });

  it("and not a request path that is no destination", () => {
    // A request for `//evil.example` is a real path on this app, and still not one to send anyone to.
    expect(redirectedTo(signedOut("//evil.example")).href).toBe(
      `http://localhost:3001${SIGN_IN_PATH}`,
    );
  });

  it("writes the same URL signInPath does", () => {
    expect(signInPath("/feedback?tab=perjadin")).toBe(
      `${SIGN_IN_PATH}?next=%2Ffeedback%3Ftab%3Dperjadin`,
    );
    expect(signInPath(null)).toBe(SIGN_IN_PATH);
  });
});

describe("Google sign-in lands on the destination", () => {
  async function invited(email: string) {
    await addPerson({ fullName: "Ratna", email, role: "Staff" });
  }

  it.each(ACCEPTED)(
    "Better Auth accepts %j and the callback lands on it",
    async (value, landing) => {
      // If a Better Auth upgrade narrows what it takes as a relative `callbackURL`, this fails here
      // instead of the Masuk button silently answering 403.
      await invited("ratna@gmail.com");

      const { location, sessionCookie } = await signInWithGoogle(
        { googleId: "google-ratna", email: "ratna@gmail.com", name: "Ratna" },
        { callbackURL: safeDestination(value)! },
      );

      expect(sessionCookie).not.toBeNull();
      expect(location.pathname + location.search).toBe(landing);
    },
  );

  it("never carries the destination onto a rejection", async () => {
    const { location, sessionCookie } = await signInWithGoogle(
      { googleId: "google-stranger", email: "stranger@gmail.com", name: "Stranger" },
      { callbackURL: "/feedback?tab=perjadin" },
    );

    expect(sessionCookie).toBeNull();
    expect(location.pathname).toBe(SIGN_IN_PATH);
    expect(location.searchParams.has("error")).toBe(true);
    expect(location.search).not.toContain("feedback");
  });
});

describe("the sign-in screen (/masuk)", () => {
  async function person(role: "Staff" | "Pimpinan", email: string): Promise<Person> {
    const row = await addPerson({ fullName: email, email, role });
    return { ...row, grants: [] } as Person;
  }

  function render(params: Record<string, string | string[]>) {
    return SignInPage({ searchParams: Promise.resolve(params) });
  }

  /** What a call throws — its `digest` for a redirect — or `null` when it returns. */
  async function thrownBy(call: () => Promise<unknown>) {
    return call().then(
      () => null,
      (error: unknown) => error as { digest?: string },
    );
  }

  /** The `destination` the page hands its Masuk button, found in its element tree. */
  function buttonDestination(node: unknown): string | null | undefined {
    if (typeof node !== "object" || node === null || !("props" in node)) return undefined;
    const element = node as {
      type: unknown;
      props: { destination?: string | null; children?: unknown };
    };
    if (element.type === GoogleSignInButton) return element.props.destination;
    for (const child of [element.props.children].flat()) {
      const found = buttonDestination(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  describe("signed out", () => {
    beforeEach(() => vi.mocked(getPerson).mockResolvedValue(null));

    it("hands the destination to the Masuk button", async () => {
      expect(buttonDestination(await render({ next: "/sesi-daring" }))).toBe("/sesi-daring");
    });

    it("hands it nothing when there is none, so it keeps today's landing", async () => {
      expect(buttonDestination(await render({}))).toBeNull();
    });

    it.each(REFUSED.filter(([, value]) => value !== undefined))(
      "hands it nothing for %s",
      async (_, value) => {
        expect(buttonDestination(await render({ next: value as string | string[] }))).toBeNull();
      },
    );

    it("shows the one rejection message and never the destination", async () => {
      const page = await render({ error: "NOT_ON_INVITE_LIST", next: "/feedback?tab=perjadin" });
      const html = renderToStaticMarkup(page);

      expect(html).toContain("Akun ini tidak terdaftar.");
      expect(html).not.toContain("feedback");
      expect(html).not.toContain("NOT_ON_INVITE_LIST");
      expect(buttonDestination(page)).toBeNull();
    });
  });

  describe("signed in", () => {
    it("sends a Person straight to the destination", async () => {
      vi.mocked(getPerson).mockResolvedValue(await person("Staff", "rina@gmail.com"));

      const thrown = await thrownBy(() => render({ next: "/feedback?tab=perjadin" }));

      expect(thrown?.digest).toMatch(/^NEXT_REDIRECT;.*;\/feedback\?tab=perjadin;/);
    });

    it.each([
      ["Staff", "/pendamping"],
      ["Pimpinan", "/"],
    ] as const)("sends a %s with no destination to %s, as before", async (role, landing) => {
      vi.mocked(getPerson).mockResolvedValue(await person(role, "someone@gmail.com"));

      const thrown = await thrownBy(() => render({}));

      expect(thrown?.digest).toMatch(new RegExp(`^NEXT_REDIRECT;.*;${landing};`));
    });

    it("ignores a destination that is not a path on this app", async () => {
      vi.mocked(getPerson).mockResolvedValue(await person("Staff", "rina@gmail.com"));

      const thrown = await thrownBy(() => render({ next: "//evil.example" }));

      expect(thrown?.digest).toMatch(/^NEXT_REDIRECT;.*;\/pendamping;/);
    });

    it("leaves refusing an unreadable destination to that page's own guard", async () => {
      // A grant-less Staff Person may not read the Dashboard. Sign-in sends them there anyway…
      const staff = await person("Staff", "rina@gmail.com");
      vi.mocked(getPerson).mockResolvedValue(staff);
      vi.mocked(requirePerson).mockResolvedValue(staff);

      const toDashboard = await thrownBy(() => render({ next: "/?minggu=2" }));
      expect(toDashboard?.digest).toMatch(/^NEXT_REDIRECT;.*;\/\?minggu=2;/);

      // …and the Dashboard's guard is what turns them away, exactly as if they had clicked a link.
      const atDashboard = await thrownBy(() =>
        DashboardPage({ searchParams: Promise.resolve({ minggu: "2" }) } as never),
      );
      expect(atDashboard?.digest).toMatch(/^NEXT_REDIRECT;.*;\/pendamping;/);
    });
  });
});
