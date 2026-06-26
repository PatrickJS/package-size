import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readBrowserCachedPackageHistory,
  readBrowserMeasurement,
  readBrowserVersionHistory,
  writeBrowserMeasurement,
  writeBrowserVersionHistory,
} from "../src/browser-cache.js";
import { mountApp } from "../src/App.js";

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

let mounted;

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
  const version = asyncMatch ? asyncVersion ?? "0.15.0" : isZod ? "4.4.3" : requestedVersion ?? "19.2.7";
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
      const pkg = parsed.searchParams.get("pkg") ?? "react";
      const limit = Number.parseInt(parsed.searchParams.get("limit") ?? "5", 10);
      if (pkg === "@async/framework") {
        return jsonResponse({
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
                version: "0.15.0",
                publishedAt: "2026-06-26T00:00:00.000Z",
                loaded: false,
              },
            ],
          },
        });
      }

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
      return jsonResponse({
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
      });
    }

    const pkg = parsed.searchParams.get("pkg");
    const options = {
      ...defaultOptions,
      target: parsed.searchParams.get("target") ?? defaultOptions.target,
      conditions: (parsed.searchParams.get("conditions") ?? "browser").split(","),
      meta: parsed.searchParams.get("meta") === "true",
      env: parsed.searchParams.get("env") ?? defaultOptions.env,
      bundle: parsed.searchParams.get("bundle") ?? defaultOptions.bundle,
    };
    return jsonResponse({ ok: true, result: resultFor(pkg, { options }) });
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
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

function mount(options = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  mounted = mountApp({ root: document.getElementById("root"), ...options });
  return mounted;
}

async function waitForExpectation(assertion, timeout = 1500) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeout) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

function allElements(root = document) {
  return [...root.querySelectorAll("*")];
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function queryByText(text, root = document) {
  return allElements(root).find((element) => normalizeText(element.textContent) === text) ?? null;
}

function getByText(text, root = document) {
  const element = queryByText(text, root);
  if (!element) {
    throw new Error(`Unable to find text: ${text}`);
  }
  return element;
}

function queryTextIncludes(text, root = document) {
  return allElements(root).find((element) => normalizeText(element.textContent).includes(text)) ?? null;
}

function getByLabel(label, root = document) {
  const labelled = allElements(root).find((element) => element.getAttribute("aria-label") === label);
  if (labelled) {
    return labelled;
  }
  const wrappingLabel = [...root.querySelectorAll("label")].find((element) => normalizeText(element.textContent).includes(label));
  const control = wrappingLabel?.querySelector("input,select,textarea");
  if (control) {
    return control;
  }
  throw new Error(`Unable to find label: ${label}`);
}

function roleCandidates(role, root = document) {
  if (role === "heading") {
    return [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")];
  }
  if (role === "link") {
    return [...root.querySelectorAll("a")];
  }
  if (role === "button") {
    return [...root.querySelectorAll("button")];
  }
  if (role === "combobox") {
    return [...root.querySelectorAll("select")];
  }
  if (role === "alert" || role === "img") {
    return [...root.querySelectorAll(`[role="${role}"]`)];
  }
  if (role === "row") {
    return [...root.querySelectorAll("tr")];
  }
  return [...root.querySelectorAll(`[role="${role}"]`)];
}

function elementName(element) {
  return element.getAttribute("aria-label") ?? normalizeText(element.textContent);
}

function getByRole(role, { name, level } = {}, root = document) {
  const match = roleCandidates(role, root).find((element) => {
    if (level && element.tagName !== `H${level}`) {
      return false;
    }
    if (name === undefined) {
      return true;
    }
    const accessibleName = elementName(element);
    return name instanceof RegExp ? name.test(accessibleName) : accessibleName === name;
  });
  if (!match) {
    throw new Error(`Unable to find role ${role}${name ? ` named ${name}` : ""}`);
  }
  return match;
}

function click(element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function submit(form) {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function change(element, value) {
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
}

function setInputValue(element, value) {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
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
  mounted?.destroy();
  mounted = null;
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
  vi.restoreAllMocks();
});

describe("Async framework app", () => {
  it("loads the measure page, default package, npm metadata, and recents", async () => {
    mount();

    expect(getByRole("heading", { level: 1, name: "Package Size" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Measure" })).toHaveAttribute("aria-current", "page");
    expect(getByLabel("Package name")).toBeInTheDocument();
    await waitForExpectation(() => expect(getByText("19.2.7")).toBeInTheDocument());
    await waitForExpectation(() => {
      expect(writeBrowserMeasurement).toHaveBeenCalledWith(expect.objectContaining({
        package: "react",
        version: "19.2.7",
      }));
    });
    expect(getByLabel("Recently searched packages")).toHaveTextContent("react");
    expect(window.localStorage.getItem("package-size.recent-searches.v2")).toContain("react@19.2.7");
    await waitForExpectation(() => {
      expect(getByRole("link", { name: "View react on npm" })).toHaveAttribute(
        "href",
        "https://www.npmjs.com/package/react",
      );
    });
    expect(getByRole("link", { name: "gaearon" })).toHaveAttribute("href", "https://www.npmjs.com/~gaearon");
  });

  it("uses URL builder options when resolving", async () => {
    mount();

    await waitForExpectation(() => expect(getByText("19.2.7")).toBeInTheDocument());
    click(getByRole("link", { name: "Tools" }));
    change(getByLabel("Target"), "es2020");
    change(getByLabel("Bundle mode"), "standalone");
    getByLabel("Development").checked = true;
    getByLabel("Metadata").checked = true;
    const input = getByLabel("Package spec");
    setInputValue(input, "zod");
    submit(getByLabel("URL builder"));

    await waitForExpectation(() => {
      expect(lastSizeRequestUrl()).toContain("pkg=zod");
    });
    const lastUrl = lastSizeRequestUrl();
    const parsed = new URL(lastUrl, "http://localhost");
    expect(parsed.searchParams.get("pkg")).toBe("zod");
    expect(parsed.searchParams.get("target")).toBe("es2020");
    expect(parsed.searchParams.get("meta")).toBe("true");
    expect(parsed.searchParams.get("env")).toBe("development");
    expect(parsed.searchParams.get("bundle")).toBe("standalone");
    expect(new URL(window.location.href).searchParams.get("pkg")).toBe("zod");
    await waitForExpectation(() => expect(getByText("4.4.3")).toBeInTheDocument());
    expect(getByText("Resolved metadata")).toBeInTheDocument();
  });

  it("links scoped packages to npm package, scope, and maintainers with patrickjs first", async () => {
    window.history.replaceState(
      null,
      "",
      "/?pkg=%40async%2Fframework&conditions=browser&target=es2022",
    );
    mount();

    await waitForExpectation(() => {
      expect(getByRole("heading", { level: 2, name: "@async/framework" })).toBeInTheDocument();
    });
    expect(getByRole("link", { name: "View @async/framework on npm" })).toHaveAttribute(
      "href",
      "https://www.npmjs.com/package/%40async/framework",
    );
    expect(getByRole("link", { name: "View @async scope on npm" })).toHaveAttribute(
      "href",
      "https://www.npmjs.com/org/async",
    );
    const maintainerNames = roleCandidates("link")
      .map((link) => normalizeText(link.textContent))
      .filter((name) => name === "patrickjs" || name === "async-npm");
    expect(maintainerNames).toEqual(["patrickjs", "async-npm"]);
  });

  it("searches a package and searches pinned recent packages", async () => {
    mount();

    await waitForExpectation(() => expect(getByText("19.2.7")).toBeInTheDocument());
    setInputValue(getByLabel("Package name"), "zod");
    submit(getByLabel("Package search"));

    await waitForExpectation(() => expect(getByText("4.4.3")).toBeInTheDocument());
    expect(window.localStorage.getItem("package-size.recent-searches.v2")).toContain("zod@4.4.3");
    click(getByRole("button", { name: "Search react@19.2.7" }));

    await waitForExpectation(() => {
      expect(lastSizeRequestUrl()).toContain("pkg=react%4019.2.7");
    });
  });

  it("shows stable versions, reloads measurements, graphs loaded sizes, and loads more", async () => {
    mount();

    await waitForExpectation(() => expect(getByText("19.2.7")).toBeInTheDocument());
    const historySection = getByLabel("Version history");
    await waitForExpectation(() => expect(getByText("18.3.1", historySection)).toBeInTheDocument());
    await waitForExpectation(() => {
      expect(writeBrowserVersionHistory).toHaveBeenCalledWith(expect.objectContaining({
        packageName: "react",
        limit: 5,
        history: expect.objectContaining({ package: "react" }),
      }));
    });
    expect(queryTextIncludes("19.3.0-canary", historySection)).toBeNull();
    expect(historySection).toHaveTextContent("25.09 KB");
    expect(historySection).toHaveTextContent("20.20 KB");
    expect(historySection).not.toHaveTextContent("Current");
    expect(historySection).toHaveTextContent("Not loaded");
    expect(historySection).not.toHaveTextContent("14.0.0");

    click(getByRole("button", { name: "Reload and test visible versions" }, historySection));
    await waitForExpectation(() => expect(getByLabel("Version history")).toHaveTextContent("17.27 KB"));
    expect(fetchUrls("/api/size").some((url) => url.includes("pkg=react%4017.0.2"))).toBe(true);

    click(getByRole("button", { name: "Show graph" }, getByLabel("Version history")));
    await waitForExpectation(() => {
      expect(getByRole("img", { name: "Loaded version size graph" }, getByLabel("Version history"))).toBeInTheDocument();
    });
    expect(window.localStorage.getItem("package-size.version-history.graph.v1")).toBe("true");
    expect(getByLabel("Version history")).toHaveTextContent("Loaded size trend");
    expect(getByLabel("Version history")).toHaveTextContent("Minified");
    expect(getByLabel("Version history")).toHaveTextContent("Gzip");
    expect(getByLabel("Version history")).toHaveTextContent("Brotli");

    click(getByRole("button", { name: "Load more version history" }, getByLabel("Version history")));
    await waitForExpectation(() => expect(getByLabel("Version history")).toHaveTextContent("14.0.0"));

    click(getByRole("button", { name: "Load react@17.0.2 from version history" }, getByLabel("Version history")));
    await waitForExpectation(() => {
      expect(lastSizeRequestUrl()).toContain("pkg=react%4017.0.2");
    });
    expect(getByLabel("Package result")).toHaveTextContent("17.0.2");
  });

  it("loads versions from the result dropdown and checks latest unpinned", async () => {
    mount();

    await waitForExpectation(() => expect(getByText("19.2.7")).toBeInTheDocument());
    await waitForExpectation(() => expect(getByLabel("Version").textContent).toContain("18.3.1"));
    change(getByLabel("Version"), "18.3.1");
    await waitForExpectation(() => {
      expect(lastSizeRequestUrl()).toContain("pkg=react%4018.3.1");
    });

    click(getByRole("button", { name: "Load latest react" }, getByLabel("Package result")));
    await waitForExpectation(() => {
      expect(lastSizeRequestUrl()).toContain("pkg=react");
    });
    expect(lastSizeRequestUrl()).not.toContain("pkg=react%4018.3.1");
  });

  it("tracks comma-separated packages, shows a graph, refreshes latest, and opens one in measure", async () => {
    mount();

    click(getByRole("link", { name: "Dashboard" }));
    const dashboard = await waitForExpectation(() => getByLabel("Package dashboard"));
    setInputValue(
      getByLabel("Tracked packages", dashboard),
      "@async/framework@0.12.5, @async/json, @async/db, @async/pipeline, @async/web",
    );
    submit(dashboard.querySelector("form"));

    await waitForExpectation(() => expect(getByLabel("Package dashboard")).toHaveTextContent("@async/framework"));
    await waitForExpectation(() => expect(getByLabel("Package dashboard")).toHaveTextContent("@async/json"));
    expect(getByRole("img", { name: "Tracked package size graph" }, getByLabel("Package dashboard"))).toBeInTheDocument();
    await waitForExpectation(() => {
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
    expect(fetchUrls("/api/size").some((url) => url.includes("pkg=%40async%2Fframework%400.12.5"))).toBe(false);

    global.fetch.mockClear();
    click(getByRole("button", { name: "Refresh latest @async/framework" }, getByLabel("Package dashboard")));
    await waitForExpectation(() => {
      expect(fetchUrls("/api/size")).toEqual(expect.arrayContaining([
        expect.stringContaining("pkg=%40async%2Fframework"),
      ]));
    });
    expect(fetchUrls("/api/size").some((url) => url.includes("pkg=%40async%2Fframework%400.12.5"))).toBe(false);

    click(getByRole("button", { name: "Open @async/json in measure" }, getByLabel("Package dashboard")));
    await waitForExpectation(() => {
      expect(getByRole("heading", { level: 2, name: "@async/json" })).toBeInTheDocument();
    });
  });

  it("defaults to dashboard when tracked packages are saved and restores graph preference", async () => {
    window.localStorage.setItem("package-size.tracked-packages.v1", JSON.stringify([
      {
        packageSpec: "@async/framework",
        options: defaultOptions,
        addedAt: "2026-06-26T00:00:00.000Z",
      },
    ]));
    window.localStorage.setItem("package-size.version-history.graph.v1", "true");

    mount();

    expect(getByLabel("Package dashboard")).toBeInTheDocument();
    expect(getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(window.location.hash).toBe("#/dashboard");
    click(getByRole("link", { name: "Measure" }));
    await waitForExpectation(() => {
      expect(getByRole("img", { name: "Loaded version size graph" }, getByLabel("Version history"))).toBeInTheDocument();
    });
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
        return jsonResponse({ ok: true, result: resultFor("react") });
      }
      if (parsed.pathname === "/api/versions") {
        return versionsResponse.promise;
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    mount();

    await waitForExpectation(() => expect(getByLabel("Version history")).toHaveTextContent("18.3.1"));
    expect(getByLabel("Version history")).not.toHaveTextContent("Loading version history");
    expect(getByLabel("Version history")).toHaveTextContent("Refreshing");

    versionsResponse.resolve(jsonResponse({
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
    }));

    await waitForExpectation(() => expect(getByLabel("Version history")).toHaveTextContent("17.0.2"));
    await waitForExpectation(() => expect(getByLabel("Version history")).not.toHaveTextContent("Refreshing"));
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
        return jsonResponse({
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
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    mount();

    await waitForExpectation(() => expect(getByText("Cache hit")).toBeInTheDocument());
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
        return jsonResponse({ ok: true, result: resultFor("react") });
      }
      if (parsed.pathname === "/api/versions") {
        return new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    mount();

    const historySection = await waitForExpectation(() => getByLabel("Version history"));
    await waitForExpectation(() => expect(historySection).toHaveTextContent("18.3.1"));
    expect(readBrowserVersionHistory).toHaveBeenCalledWith(expect.objectContaining({
      packageName: "react",
      limit: 5,
    }));
  });

  it("renders API errors and toggles dark theme", async () => {
    global.fetch = vi.fn(async () => jsonResponse({
      ok: false,
      error: { code: "INVALID_PACKAGE_SPEC", message: "Package spec must be an npm package name." },
    }, 400));

    mount();

    await waitForExpectation(() => {
      expect(getByRole("alert")).toHaveTextContent("Package spec must be an npm package name.");
    });
    expect(document.documentElement).not.toHaveClass("dark");
    click(getByRole("button", { name: "Switch to dark theme" }));

    await waitForExpectation(() => expect(document.documentElement).toHaveClass("dark"));
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem("package-size.theme.v1")).toBe("dark");
    expect(getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });
});
