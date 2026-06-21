import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.jsx";

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

function resultFor(packageName, overrides = {}) {
  const isZod = packageName.startsWith("zod");
  const name = isZod ? "zod" : "react";
  const version = isZod ? "4.4.3" : "19.2.7";
  const rawBytes = isZod ? 545251 : 20689;
  const gzipBytes = isZod ? 80474 : 4735;
  const brotliBytes = isZod ? 64245 : 4171;
  const options = {
    ...defaultOptions,
    ...overrides.options,
  };
  const query = overrides.query ?? packageName;
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

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  mockSizeApi();
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
  vi.restoreAllMocks();
});

describe("App", () => {
  it("loads the homepage, default package, and v2 recents", async () => {
    render(<App />);

    expect(screen.getByText("Measure browser-resolved npm artifacts from your machine.")).toBeInTheDocument();
    expect(screen.getByText("package-size json react")).toBeInTheDocument();
    expect(screen.getByText("package-size dashboard --open")).toBeInTheDocument();
    expect(await screen.findByText("19.2.7")).toBeInTheDocument();
    const recentSection = screen.getByLabelText("Recently searched packages");
    expect(within(recentSection).getByText("react")).toBeInTheDocument();
    expect(window.localStorage.getItem("package-size.recent-searches.v2")).toContain("react@19.2.7");
  });

  it("collapses and expands the shareable resolver URL panel", async () => {
    const user = userEvent.setup();
    render(<App />);

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
      expect(screen.getAllByText("4.4.3").length).toBeGreaterThan(0);
    });
    const lastUrl = global.fetch.mock.calls.at(-1)[0];
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
    const firstUrl = global.fetch.mock.calls[0][0];
    const parsed = new URL(firstUrl, "http://localhost");
    expect(parsed.searchParams.get("pkg")).toBe("zod");
    expect(parsed.searchParams.get("target")).toBe("es2020");
    expect(parsed.searchParams.get("conditions")).toBe("browser,react-server");
    expect(parsed.searchParams.get("meta")).toBe("true");
    expect(screen.getByText("Resolved metadata")).toBeInTheDocument();
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
    const lastUrl = global.fetch.mock.calls.at(-1)[0];
    const parsed = new URL(lastUrl, "http://localhost");
    expect(parsed.searchParams.get("pkg")).toBe("zod@4.4.3");
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
