import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readBrowserCachedPackageHistory,
  readBrowserMeasurement,
  readBrowserVersionHistory,
  writeBrowserMeasurement,
  writeBrowserVersionHistory,
} from "../src/browser-cache.js";
import App from "../src/App.jsx";

vi.mock("../src/browser-cache.js", () => ({
  readBrowserCachedPackageHistory: vi.fn(async () => []),
  readBrowserMeasurement: vi.fn(async () => null),
  readBrowserVersionHistory: vi.fn(async () => null),
  writeBrowserMeasurement: vi.fn(async () => {}),
  writeBrowserVersionHistory: vi.fn(async () => {}),
}));

const defaultOptions = {
  subpath: "",
  target: "es2022",
  conditions: ["browser"],
  env: "production",
  bundle: "default",
  min: false,
  sourcemap: false,
  meta: false,
};

const reactSizesByVersion = {
  "17.0.2": {
    rawBytes: 17689,
    gzipBytes: 4235,
    brotliBytes: 3671,
  },
  "18.3.1": {
    rawBytes: 25689,
    gzipBytes: 5735,
    brotliBytes: 3671,
  },
  "19.2.7": {
    rawBytes: 20689,
    gzipBytes: 4735,
    brotliBytes: 4171,
  },
};

function resultFor(packageName, overrides = {}) {
  const requested = String(packageName ?? "react");
  const asyncMatch = requested.match(/^(@async\/[a-z0-9._~-]+)(?:@(.+))?$/);
  const asyncSizes = {
    "@async/framework": [136536, 34374, 29063],
    "@async/json": [18420, 4912, 4096],
    "@async/db": [42120, 10240, 8760],
    "@async/pipeline": [88220, 21440, 18120],
    "@async/web": [52480, 13200, 10920],
  };
  const isZod = requested.startsWith("zod");
  const name = asyncMatch ? asyncMatch[1] : isZod ? "zod" : "react";
  const requestedVersion = requested.match(/^react@(.+)$/)?.[1];
  const asyncVersion = asyncMatch?.[2];
  const version = asyncMatch ? asyncVersion ?? "0.13.0" : isZod ? "4.4.3" : requestedVersion ?? "19.2.7";
  const reactSizes = reactSizesByVersion[version] ?? reactSizesByVersion["19.2.7"];
  const asyncPackageSizes = asyncSizes[name] ?? asyncSizes["@async/framework"];
  const rawBytes = asyncMatch ? asyncPackageSizes[0] : isZod ? 545251 : reactSizes.rawBytes;
  const gzipBytes = asyncMatch ? asyncPackageSizes[1] : isZod ? 80474 : reactSizes.gzipBytes;
  const brotliBytes = asyncMatch ? asyncPackageSizes[2] : isZod ? 64245 : reactSizes.brotliBytes;
  const options = {
    ...defaultOptions,
    ...overrides.options,
  };
  const query = overrides.query ?? requested;
  const queryTail = `conditions=${options.conditions.join(",")}&target=${options.target}`;

  return {
    query,
    requestUrl: `https://esm.unpkg.com/${query}?${queryTail}`,
    resolvedUrl: `https://esm.unpkg.com/${name}@${version}?${queryTail}${options.meta ? "&meta" : ""}`,
    package: name,
    version,
    rawBytes,
    gzipBytes,
    brotliBytes,
    contentType: options.meta ? "application/json" : "application/javascript",
    source: "esm.unpkg.com",
    measuredAt: new Date().toISOString(),
    warnings: [],
    options,
    cacheHit: overrides.cacheHit ?? false,
  };
}

function mockSizeApi() {
  global.fetch = vi.fn(async (url) => {
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname === "/api/versions") {
      const limit = Number.parseInt(parsed.searchParams.get("limit") ?? "5", 10);
      const stableRows = [
        {
          ...resultFor("react"),
          publishedAt: "2026-06-01T00:00:00.000Z",
          loaded: true,
        },
        {
          ...resultFor("react@18.3.1"),
          publishedAt: "2024-04-26T00:00:00.000Z",
          loaded: true,
        },
        {
          package: "react",
          version: "17.0.2",
          publishedAt: "2021-03-22T00:00:00.000Z",
          loaded: false,
        },
        {
          package: "react",
          version: "16.14.0",
          publishedAt: "2020-10-14T00:00:00.000Z",
          loaded: false,
        },
        {
          package: "react",
          version: "15.7.0",
          publishedAt: "2017-10-14T00:00:00.000Z",
          loaded: false,
        },
        {
          package: "react",
          version: "14.0.0",
          publishedAt: "2015-10-07T00:00:00.000Z",
          loaded: false,
        },
      ];
      return new Response(JSON.stringify({
        ok: true,
        result: {
          package: "react",
          hasMore: stableRows.length > limit,
          npm: {
            packageUrl: "https://www.npmjs.com/package/react",
            scope: null,
            scopeUrl: null,
            maintainers: [
              {
                name: "gaearon",
                url: "https://www.npmjs.com/~gaearon",
              },
            ],
          },
          versions: [
            ...stableRows.slice(0, limit),
            {
              package: "react",
              version: "19.3.0-canary-68631c04-20260626",
              publishedAt: "2026-06-26T00:00:00.000Z",
              loaded: false,
            },
          ],
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const pkg = parsed.searchParams.get("pkg");
    const options = {
      ...defaultOptions,
      target: parsed.searchParams.get("target") ?? defaultOptions.target,
      conditions: (parsed.searchParams.get("conditions") ?? "browser").split(","),
      meta: parsed.searchParams.get("meta") === "true",
    };
    const result = resultFor(pkg, { options });
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function fetchUrls(pathname) {
  return global.fetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => new URL(url, "http://localhost").pathname === pathname);
}

function lastSizeRequestUrl() {
  return fetchUrls("/api/size").at(-1);
}

function deferredResponse() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  mockSizeApi();
  readBrowserCachedPackageHistory.mockResolvedValue([]);
  readBrowserMeasurement.mockResolvedValue(null);
  readBrowserVersionHistory.mockResolvedValue(null);
  writeBrowserMeasurement.mockResolvedValue(undefined);
  writeBrowserVersionHistory.mockResolvedValue(undefined);
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
  vi.restoreAllMocks();
});

describe("App", () => {
  it("loads the measure page, default package, and v2 recents", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "Package Size" })).toBeInTheDocument();
    expect(screen.queryByText("UNPKG artifact checker")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Measure" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Package name")).toBeInTheDocument();
    expect(screen.queryByText("Local JSON")).not.toBeInTheDocument();
    expect(screen.queryByText("Shareable resolver URL")).not.toBeInTheDocument();
    expect(await screen.findByText("19.2.7")).toBeInTheDocument();
    await waitFor(() => {
      expect(writeBrowserMeasurement).toHaveBeenCalledWith(expect.objectContaining({
        package: "react",
        version: "19.2.7",
      }));
    });
    const recentSection = screen.getByLabelText("Recently searched packages");
    expect(within(recentSection).getByText("react")).toBeInTheDocument();
    expect(window.localStorage.getItem("package-size.recent-searches.v2")).toContain("react@19.2.7");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "View react on npm" })).toHaveAttribute(
        "href",
        "https://www.npmjs.com/package/react",
      );
    });
    expect(screen.getByRole("link", { name: "gaearon" })).toHaveAttribute("href", "https://www.npmjs.com/~gaearon");
  });

  it("collapses and expands the shareable resolver URL panel", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("link", { name: "Tools" }));
    const summary = screen.getByText("Shareable resolver URL");
    const panel = summary.closest("details");
    expect(panel?.open).toBe(true);

    await user.click(summary);
    expect(panel?.open).toBe(false);

    await user.click(summary);
    expect(panel?.open).toBe(true);
  });

  it("uses URL builder options when resolving", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("19.2.7");
    await user.click(screen.getByRole("link", { name: "Tools" }));
    await user.click(screen.getByRole("button", { name: "URL builder" }));
    await user.selectOptions(screen.getByLabelText("Target"), "es2020");
    await user.selectOptions(screen.getByLabelText("Bundle mode"), "standalone");
    await user.click(screen.getByLabelText("Development"));
    await user.click(screen.getByLabelText("Metadata"));

    const input = screen.getByLabelText("Package spec");
    await user.clear(input);
    await user.type(input, "zod");
    await user.click(screen.getByRole("button", { name: "Resolve package", hidden: true }));

    await waitFor(() => {
      expect(lastSizeRequestUrl()).toContain("pkg=zod");
    });
    const lastUrl = lastSizeRequestUrl();
    const parsed = new URL(lastUrl, "http://localhost");
    expect(parsed.searchParams.get("pkg")).toBe("zod");
    expect(parsed.searchParams.get("target")).toBe("es2020");
    expect(parsed.searchParams.get("meta")).toBe("true");
    expect(parsed.searchParams.get("env")).toBe("development");
    expect(parsed.searchParams.get("bundle")).toBe("standalone");
    const dashboardParams = new URL(window.location.href).searchParams;
    expect(dashboardParams.get("pkg")).toBe("zod");
    expect(dashboardParams.get("target")).toBe("es2020");
    expect(dashboardParams.get("conditions")).toBe("browser");
    expect(dashboardParams.has("meta")).toBe(true);
    expect(dashboardParams.has("dev")).toBe(true);
    expect(dashboardParams.has("standalone")).toBe(true);
    expect(dashboardParams.has("env")).toBe(false);
    expect(dashboardParams.has("bundle")).toBe(false);
    await user.click(screen.getByRole("link", { name: "Measure" }));
    await waitFor(() => {
      expect(screen.getAllByText("4.4.3").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Resolved metadata")).toBeInTheDocument();
  });

  it("loads the shown package and UNPKG options from dashboard query params", async () => {
    window.history.replaceState(
      null,
      "",
      "/?pkg=zod&conditions=browser,react-server&target=es2020&meta",
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("4.4.3").length).toBeGreaterThan(0);
    });
    const firstUrl = fetchUrls("/api/size")[0];
    const parsed = new URL(firstUrl, "http://localhost");
    expect(parsed.searchParams.get("pkg")).toBe("zod");
    expect(parsed.searchParams.get("target")).toBe("es2020");
    expect(parsed.searchParams.get("conditions")).toBe("browser,react-server");
    expect(parsed.searchParams.get("meta")).toBe("true");
    expect(screen.getByText("Resolved metadata")).toBeInTheDocument();
  });

  it("links scoped packages to npm package, scope, and maintainers", async () => {
    window.history.replaceState(
      null,
      "",
      "/?pkg=%40async%2Fframework&conditions=browser&target=es2022",
    );
    global.fetch = vi.fn(async (url) => {
      const parsed = new URL(url, "http://localhost");
      if (parsed.pathname === "/api/size") {
        return new Response(JSON.stringify({ ok: true, result: resultFor("@async/framework") }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (parsed.pathname === "/api/versions") {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            package: "@async/framework",
            hasMore: false,
            npm: {
              packageUrl: "https://www.npmjs.com/package/%40async/framework",
              scope: "async",
              scopeUrl: "https://www.npmjs.com/org/async",
              maintainers: [
                {
                  name: "async-npm",
                  url: "https://www.npmjs.com/~async-npm",
                },
                {
                  name: "patrickjs",
                  url: "https://www.npmjs.com/~patrickjs",
                },
              ],
            },
            versions: [
              {
                package: "@async/framework",
                version: "0.13.0",
                publishedAt: "2026-06-26T00:00:00.000Z",
                loaded: false,
              },
            ],
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<App />);

    expect(await screen.findByRole("heading", { level: 2, name: "@async/framework" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "View @async/framework on npm" })).toHaveAttribute(
        "href",
        "https://www.npmjs.com/package/%40async/framework",
      );
    });
    expect(screen.getByRole("link", { name: "View @async scope on npm" })).toHaveAttribute(
      "href",
      "https://www.npmjs.com/org/async",
    );
    expect(screen.getByRole("link", { name: "patrickjs" })).toHaveAttribute(
      "href",
      "https://www.npmjs.com/~patrickjs",
    );
    const maintainerNames = screen
      .getAllByRole("link")
      .map((link) => link.textContent)
      .filter((name) => name === "patrickjs" || name === "async-npm");
    expect(maintainerNames).toEqual(["patrickjs", "async-npm"]);
  });

  it("searches a package and dedupes recent rows by resolved URL", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("19.2.7");
    const input = screen.getByLabelText("Package name");
    await user.clear(input);
    await user.type(input, "zod");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(screen.getAllByText("4.4.3").length).toBeGreaterThan(0);
    });
    const rows = within(screen.getByLabelText("Recently searched packages")).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(window.localStorage.getItem("package-size.recent-searches.v2")).toContain("zod@4.4.3");
  });

  it("clicks a pinned recent package to search again", async () => {
    window.localStorage.setItem(
      "package-size.recent-searches.v2",
      JSON.stringify([
        {
          ...resultFor("zod"),
          pinnedQuery: "zod@4.4.3",
          lastSearchedAt: new Date().toISOString(),
        },
      ]),
    );
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("19.2.7");
    await user.click(screen.getAllByRole("button", { name: "Search zod@4.4.3" })[0]);

    await waitFor(() => {
      expect(screen.getAllByText("4.4.3").length).toBeGreaterThan(0);
    });
    const lastUrl = lastSizeRequestUrl();
    const parsed = new URL(lastUrl, "http://localhost");
    expect(parsed.searchParams.get("pkg")).toBe("zod@4.4.3");
  });

  it("shows five stable versions by default, loads more, and loads a selected version", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("19.2.7");
    const historySection = screen.getByLabelText("Version history");

    expect(await within(historySection).findByText("18.3.1")).toBeInTheDocument();
    await waitFor(() => {
      expect(writeBrowserVersionHistory).toHaveBeenCalledWith(expect.objectContaining({
        packageName: "react",
        limit: 5,
        history: expect.objectContaining({ package: "react" }),
      }));
    });
    expect(within(historySection).queryByText("19.3.0-canary-68631c04-20260626")).not.toBeInTheDocument();
    expect(within(historySection).getByText("25.09 KB")).toBeInTheDocument();
    expect(within(historySection).getByText("20.20 KB")).toBeInTheDocument();
    expect(within(historySection).queryByText("Current")).not.toBeInTheDocument();
    expect(within(historySection).getAllByText("Not loaded").length).toBeGreaterThan(0);
    expect(within(historySection).queryByText("14.0.0")).not.toBeInTheDocument();

    await user.click(within(historySection).getByRole("button", { name: "Reload and test visible versions" }));
    expect(await within(historySection).findByText("17.27 KB")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchUrls("/api/size").some((url) => url.includes("pkg=react%4017.0.2"))).toBe(true);
    });

    await user.click(within(historySection).getByRole("button", { name: "Show graph" }));
    expect(within(historySection).getByRole("img", { name: "Loaded version size graph" })).toBeInTheDocument();
    expect(window.localStorage.getItem("package-size.version-history.graph.v1")).toBe("true");
    expect(within(historySection).getByText("Loaded size trend")).toBeInTheDocument();
    expect(within(historySection).getAllByText("Minified").length).toBeGreaterThan(0);
    expect(within(historySection).getAllByText("Gzip").length).toBeGreaterThan(0);
    expect(within(historySection).getAllByText("Brotli").length).toBeGreaterThan(0);

    await user.click(within(historySection).getByRole("button", { name: "Load more version history" }));
    expect(await within(historySection).findByText("14.0.0")).toBeInTheDocument();

    await user.click(within(historySection).getByRole("button", { name: "Load react@17.0.2 from version history" }));

    await waitFor(() => {
      expect(lastSizeRequestUrl()).toContain("pkg=react%4017.0.2");
    });
    expect(within(screen.getByLabelText("Package result")).getByText("17.0.2")).toBeInTheDocument();
  });

  it("loads versions from the result header dropdown and latest action", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("19.2.7");
    const resultSection = screen.getByLabelText("Package result");
    const versionSelect = within(resultSection).getByRole("combobox", { name: "Version" });
    await waitFor(() => {
      expect(within(versionSelect).getByRole("option", { name: "18.3.1" })).toBeInTheDocument();
    });

    await user.selectOptions(versionSelect, "18.3.1");
    await waitFor(() => {
      expect(lastSizeRequestUrl()).toContain("pkg=react%4018.3.1");
    });
    expect(within(resultSection).getByRole("combobox", { name: "Version" })).toHaveValue("18.3.1");

    await user.click(within(resultSection).getByRole("button", { name: "Load latest react" }));
    await waitFor(() => {
      expect(lastSizeRequestUrl()).toContain("pkg=react%4019.2.7");
    });
  });

  it("tracks comma-separated packages on the dashboard and opens one in measure", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("link", { name: "Dashboard" }));
    const dashboard = screen.getByLabelText("Package dashboard");

    await user.clear(within(dashboard).getByLabelText("Tracked packages"));
    await user.type(
      within(dashboard).getByLabelText("Tracked packages"),
      "@async/framework, @async/json, @async/db, @async/pipeline, @async/web",
    );
    await user.click(within(dashboard).getByRole("button", { name: "Track packages" }));

    expect(await within(dashboard).findByText("@async/framework")).toBeInTheDocument();
    expect(await within(dashboard).findByText("@async/json")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchUrls("/api/size").some((url) => url.includes("pkg=%40async%2Fjson"))).toBe(true);
    });
    const tracked = JSON.parse(window.localStorage.getItem("package-size.tracked-packages.v1"));
    expect(tracked.map((item) => item.packageSpec)).toEqual(expect.arrayContaining([
      "@async/framework",
      "@async/json",
      "@async/db",
      "@async/pipeline",
      "@async/web",
    ]));

    await user.click(within(dashboard).getByRole("button", { name: "Open @async/json in measure" }));
    const resultSection = await screen.findByLabelText("Package result");
    expect(within(resultSection).getByRole("heading", { level: 2, name: "@async/json" })).toBeInTheDocument();
  });

  it("defaults to the dashboard when tracked packages are saved and no route hash is set", async () => {
    window.localStorage.setItem("package-size.tracked-packages.v1", JSON.stringify([
      {
        packageSpec: "@async/framework",
        options: defaultOptions,
        addedAt: "2026-06-26T00:00:00.000Z",
      },
    ]));

    render(<App />);

    expect(screen.getByLabelText("Package dashboard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(window.location.hash).toBe("#/dashboard");
  });

  it("restores the saved version graph preference", async () => {
    window.localStorage.setItem("package-size.version-history.graph.v1", "true");

    render(<App />);

    const historySection = screen.getByLabelText("Version history");
    expect(await within(historySection).findByRole("img", { name: "Loaded version size graph" })).toBeInTheDocument();
    expect(within(historySection).getByRole("button", { name: "Hide graph" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders cached version history optimistically while refreshing", async () => {
    const versionsResponse = deferredResponse();
    readBrowserVersionHistory.mockResolvedValue({
      package: "react",
      hasMore: true,
      versions: [
        {
          package: "react",
          version: "18.3.1",
          publishedAt: "2024-04-26T00:00:00.000Z",
          loaded: false,
        },
      ],
    });
    global.fetch = vi.fn(async (url) => {
      const parsed = new URL(url, "http://localhost");
      if (parsed.pathname === "/api/size") {
        return new Response(JSON.stringify({ ok: true, result: resultFor("react") }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (parsed.pathname === "/api/versions") {
        return versionsResponse.promise;
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<App />);

    const historySection = screen.getByLabelText("Version history");
    expect(await within(historySection).findByText("18.3.1")).toBeInTheDocument();
    expect(within(historySection).queryByText("Loading version history")).not.toBeInTheDocument();
    expect(within(historySection).getByText("Refreshing")).toBeInTheDocument();

    versionsResponse.resolve(new Response(JSON.stringify({
      ok: true,
      result: {
        package: "react",
        hasMore: false,
        versions: [
          {
            package: "react",
            version: "17.0.2",
            publishedAt: "2021-03-22T00:00:00.000Z",
            loaded: false,
          },
        ],
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    expect(await within(historySection).findByText("17.0.2")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(historySection).queryByText("Refreshing")).not.toBeInTheDocument();
    });
  });

  it("uses browser measurement cache when the size API is unavailable for an exact version", async () => {
    window.history.replaceState(
      null,
      "",
      "/?pkg=react%4019.2.7&conditions=browser&target=es2022",
    );
    readBrowserMeasurement.mockResolvedValue(resultFor("react@19.2.7", { cacheHit: true }));
    global.fetch = vi.fn(async (url) => {
      const parsed = new URL(url, "http://localhost");
      if (parsed.pathname === "/api/size") {
        return new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (parsed.pathname === "/api/versions") {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            package: "react",
            hasMore: false,
            versions: [
              {
                package: "react",
                version: "19.2.7",
                publishedAt: "2026-06-01T00:00:00.000Z",
                loaded: false,
              },
            ],
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<App />);

    expect(await screen.findByText("Cache hit")).toBeInTheDocument();
    expect(readBrowserMeasurement).toHaveBeenCalledWith(
      "react@19.2.7",
      expect.objectContaining({ target: "es2022" }),
    );
  });

  it("uses browser version history cache when the versions API is unavailable", async () => {
    readBrowserVersionHistory.mockResolvedValue({
      package: "react",
      hasMore: false,
      versions: [
        {
          package: "react",
          version: "18.3.1",
          publishedAt: "2024-04-26T00:00:00.000Z",
          loaded: false,
        },
      ],
    });
    global.fetch = vi.fn(async (url) => {
      const parsed = new URL(url, "http://localhost");
      if (parsed.pathname === "/api/size") {
        return new Response(JSON.stringify({ ok: true, result: resultFor("react") }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (parsed.pathname === "/api/versions") {
        return new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<App />);

    const historySection = screen.getByLabelText("Version history");
    expect(await within(historySection).findByText("18.3.1")).toBeInTheDocument();
    expect(readBrowserVersionHistory).toHaveBeenCalledWith(expect.objectContaining({
      packageName: "react",
      limit: 5,
    }));
  });

  it("renders API errors", async () => {
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({
        ok: false,
        error: { code: "INVALID_PACKAGE_SPEC", message: "Package spec must be an npm package name." },
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    ));

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Package spec must be an npm package name.");
  });

  it("toggles the dark theme", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(document.documentElement).not.toHaveClass("dark");
    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem("package-size.theme.v1")).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });
});
