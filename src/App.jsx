import {
  createRouteRegistry,
  createRouter,
  defineRoute,
} from "@async/framework/browser";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Code2,
  Database,
  Gauge,
  GitBranch,
  Link2,
  Loader2,
  Moon,
  PackageSearch,
  RotateCcw,
  Search,
  SunMedium,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildEsmUnpkgUrl,
  buildSizeApiSearchParams,
  buildUnpkgSearchParams,
  DEFAULT_SIZE_OPTIONS,
  normalizeSizeOptions,
  packageSpecFromResolved,
  sizeOptionsFromSearchParams,
} from "./package-url.js";
import { measurePackageSizeInBrowser } from "./browser-measure.js";

const RECENTS_KEY = "package-size.recent-searches.v2";
const LEGACY_RECENTS_KEY = "package-size.recent-searches.v1";
const THEME_KEY = "package-size.theme.v1";
const MAX_RECENTS = 8;
const DEFAULT_QUERY = "react";
const URL_BUILDER_POPOVER_ID = "url-builder-popover";

const conditionOptions = ["browser", "react-server", "worker"];
const pageRoutes = createRouteRegistry({
  "/": defineRoute({ render: "none", meta: { page: "measure" } }),
  "/tools": defineRoute({ render: "none", meta: { page: "tools" } }),
  "*": defineRoute({ render: "none", meta: { page: "measure" } }),
});

const sampleResult = {
  query: "react",
  requestUrl: "https://esm.unpkg.com/react?conditions=browser&target=es2022",
  resolvedUrl: "https://esm.unpkg.com/react@19.2.7?conditions=browser&target=es2022",
  package: "react",
  version: "19.2.7",
  rawBytes: 20689,
  gzipBytes: 4735,
  brotliBytes: 4171,
  contentType: "application/javascript; charset=utf-8",
  source: "esm.unpkg.com",
  measuredAt: new Date().toISOString(),
  warnings: [],
  options: {
    ...DEFAULT_SIZE_OPTIONS,
    conditions: [...DEFAULT_SIZE_OPTIONS.conditions],
  },
  cacheHit: false,
};

const toneStyles = {
  minified: {
    text: "text-[#1d9bf0] dark:text-[#39c5cf]",
    bar: "bg-linear-to-r from-[#1d9bf0] to-[#1a8cd8] dark:from-[#39c5cf] dark:to-[#1d9bf0]",
  },
  gzip: {
    text: "text-[#1f7ae8] dark:text-[#1d9bf0]",
    bar: "bg-[#1f7ae8] dark:bg-[#1d9bf0]",
    note: "bg-[#e6f1ff] text-[#1f7ae8] dark:bg-[#1d9bf0]/15 dark:text-[#8ecdf8]",
  },
  brotli: {
    text: "text-[#e58a00] dark:text-[#f6a935]",
    bar: "bg-[#e58a00] dark:bg-[#f6a935]",
    note: "bg-[#fff1dc] text-[#e58a00] dark:bg-[#f6a935]/15 dark:text-[#ffd083]",
  },
};

const iconButtonClass =
  "inline-grid h-[34px] w-[34px] place-items-center rounded-[7px] border-0 bg-transparent text-[#263241] no-underline transition-colors hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:text-[#f7f9f9] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]";
const thClass =
  "border-b border-[#e1e7ed] px-3 py-[13px] text-left text-[15px] font-[650] text-[#5b6678] dark:border-[#38444d] dark:text-[#8b98a5]";
const tdClass =
  "h-[52px] border-b border-[#e1e7ed] px-3 py-[13px] text-left text-[15px] text-[#5b6678] dark:border-[#38444d] dark:text-[#8b98a5] max-[680px]:h-auto max-[680px]:border-b-0 max-[680px]:p-0 max-[680px]:text-sm";
const mobileLabelClass =
  "hidden max-[680px]:mb-[3px] max-[680px]:block max-[680px]:text-[11px] max-[680px]:font-bold max-[680px]:text-[#8b95a4] dark:text-[#8b98a5]";
const fieldClass =
  "h-10 w-full rounded-[7px] border border-[#cbd4de] bg-white px-3 text-[15px] text-[#111827] outline-0 focus:border-[#1d9bf0] focus:ring-2 focus:ring-[#1d9bf0]/15 dark:border-[#38444d] dark:bg-[#192734] dark:text-[#f7f9f9] dark:focus:border-[#1d9bf0] dark:focus:ring-[#1d9bf0]/20";

function defaultSizeOptions() {
  return {
    ...DEFAULT_SIZE_OPTIONS,
    conditions: [...DEFAULT_SIZE_OPTIONS.conditions],
  };
}

function buildDashboardSearchParams(packageSpec, sizeOptions) {
  const normalizedOptions = normalizeSizeOptions(sizeOptions);
  const params = new URLSearchParams();
  params.set("pkg", String(packageSpec ?? "").trim() || DEFAULT_QUERY);

  if (normalizedOptions.subpath) {
    params.set("subpath", normalizedOptions.subpath);
  }
  for (const [key, value] of buildUnpkgSearchParams(normalizedOptions)) {
    params.set(key, value);
  }

  return params.toString().replace(/=(?=&|$)/g, "").replace(/%2C/g, ",");
}

function readDashboardStateFromLocation() {
  if (typeof window === "undefined") {
    return {
      query: DEFAULT_QUERY,
      sizeOptions: defaultSizeOptions(),
    };
  }

  const searchParams = new URLSearchParams(window.location.search);
  const query = (searchParams.get("pkg") ?? searchParams.get("package") ?? DEFAULT_QUERY).trim() || DEFAULT_QUERY;

  try {
    return {
      query,
      sizeOptions: sizeOptionsFromSearchParams(searchParams),
    };
  } catch {
    return {
      query,
      sizeOptions: defaultSizeOptions(),
    };
  }
}

function writeDashboardStateToLocation(packageSpec, sizeOptions, mode = "push") {
  if (typeof window === "undefined") {
    return;
  }

  const search = buildDashboardSearchParams(packageSpec, sizeOptions);
  const nextUrl = `${window.location.pathname}?${search}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (nextUrl === currentUrl) {
    return;
  }

  const method = mode === "replace" ? "replaceState" : "pushState";
  window.history[method](null, "", nextUrl);
}

function pageFromRoute(route) {
  return route?.meta?.page === "tools" ? "tools" : "measure";
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function formatBytes(bytes) {
  return `${new Intl.NumberFormat("en-US").format(bytes)} bytes`;
}

function smallerBy(rawBytes, compressedBytes) {
  if (!rawBytes) {
    return "0.0% smaller";
  }
  return `${(100 * (1 - compressedBytes / rawBytes)).toFixed(1)}% smaller`;
}

function relativeTime(isoDate) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
  if (elapsedSeconds < 60) {
    return `${Math.max(1, elapsedSeconds)}s ago`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

function packageInitial(packageName) {
  if (packageName.startsWith("@")) {
    return packageName.split("/")[1]?.slice(0, 2).toLowerCase() ?? "pkg";
  }
  return packageName.slice(0, 2).toLowerCase();
}

function getPreferredTheme() {
  if (typeof window === "undefined") {
    return "light";
  }
  const savedTheme = window.localStorage.getItem(THEME_KEY);
  if (savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function normalizeStoredRecent(recent) {
  if (!recent?.package || !recent?.version || !recent?.resolvedUrl) {
    return null;
  }

  let options = defaultSizeOptions();
  try {
    options = normalizeSizeOptions(recent.options ?? {});
  } catch {
    options = defaultSizeOptions();
  }

  return {
    package: recent.package,
    query: recent.query ?? recent.package,
    pinnedQuery: recent.pinnedQuery ?? packageSpecFromResolved(recent.package, recent.version),
    version: recent.version,
    rawBytes: recent.rawBytes,
    gzipBytes: recent.gzipBytes,
    brotliBytes: recent.brotliBytes,
    requestUrl: recent.requestUrl ?? recent.resolvedUrl,
    resolvedUrl: recent.resolvedUrl,
    options,
    lastSearchedAt: recent.lastSearchedAt ?? new Date().toISOString(),
  };
}

function readRecents() {
  try {
    const raw =
      window.localStorage.getItem(RECENTS_KEY) ??
      window.localStorage.getItem(LEGACY_RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return parsed.map(normalizeStoredRecent).filter(Boolean);
  } catch {
    return [];
  }
}

function writeRecents(recents) {
  window.localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
}

function normalizeResultForRecent(result) {
  const options = normalizeSizeOptions(result.options ?? {});
  return {
    package: result.package,
    query: result.query,
    pinnedQuery: packageSpecFromResolved(result.package, result.version),
    version: result.version,
    rawBytes: result.rawBytes,
    gzipBytes: result.gzipBytes,
    brotliBytes: result.brotliBytes,
    requestUrl: result.requestUrl,
    resolvedUrl: result.resolvedUrl,
    options,
    lastSearchedAt: new Date().toISOString(),
  };
}

async function fetchPackageSize(query, sizeOptions) {
  const params = buildSizeApiSearchParams(query, sizeOptions);
  const response = await fetch(`/api/size?${params.toString()}`, {
    headers: {
      accept: "application/json",
    },
  });
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message ?? "Package size request failed.");
    }
    return payload.result;
  }

  return measurePackageSizeInBrowser(query, sizeOptions);
}

function BrandMark() {
  return (
    <div
      className="inline-grid h-[38px] w-[38px] flex-none place-items-center rounded-[7px] border border-[#b9e3ff] bg-[#e8f5fe] text-[#1d9bf0] dark:border-[#38444d] dark:bg-[#223949] dark:text-[#1d9bf0]"
      aria-hidden="true"
    >
      <PackageSearch size={25} strokeWidth={2.4} />
    </div>
  );
}

function Header({ currentPage, theme, onToggleTheme }) {
  const isDark = theme === "dark";
  const tabClass = (page) => {
    const isActive = currentPage === page;
    return [
      "inline-flex h-[34px] items-center gap-2 rounded-[7px] px-3 text-[15px] font-[700] no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:focus-visible:outline-[#1d9bf0]",
      isActive
        ? "bg-[#e8f5fe] text-[#0f6fb8] dark:bg-[#223949] dark:text-[#8ecdf8]"
        : "text-[#354153] hover:bg-[#f5f8fa] dark:text-[#d6dde4] dark:hover:bg-[#253341]",
    ].join(" ");
  };

  return (
    <header className="flex h-[66px] items-center justify-between border-b border-[#d9e0e7] bg-white/80 px-7 backdrop-blur-md dark:border-[#38444d] dark:bg-[#15202b]/88 max-[980px]:h-auto max-[980px]:min-h-[66px] max-[980px]:items-start max-[980px]:gap-4 max-[980px]:px-5 max-[980px]:py-[18px]">
      <div className="flex min-w-0 items-center gap-[18px] max-[980px]:flex-wrap max-[980px]:gap-x-3.5 max-[980px]:gap-y-2.5">
        <BrandMark />
        <h1 className="m-0 text-[22px] leading-[1.1] font-[750] text-[#111827] dark:text-[#f7f9f9] max-[680px]:text-xl">
          Package Size
        </h1>
      </div>
      <nav
        className="flex items-center gap-3.5 max-[680px]:w-full max-[680px]:justify-between"
        aria-label="Primary navigation"
      >
        <div className="flex items-center gap-1.5">
          <a
            className={tabClass("measure")}
            href="#/"
            aria-current={currentPage === "measure" ? "page" : undefined}
          >
            <Gauge size={17} aria-hidden="true" />
            Measure
          </a>
          <a
            className={tabClass("tools")}
            href="#/tools"
            aria-current={currentPage === "tools" ? "page" : undefined}
          >
            <Link2 size={17} aria-hidden="true" />
            Tools
          </a>
        </div>
        <div className="flex items-center gap-3.5">
          <a
            className={iconButtonClass}
            href="https://github.com/PatrickJS/package-size"
            aria-label="GitHub repository"
          >
            <GitBranch size={21} />
          </a>
          <span className="h-6 w-px bg-[#d9e0e7] dark:bg-[#38444d]" aria-hidden="true" />
          <button
            className={iconButtonClass}
            type="button"
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            aria-pressed={isDark}
            onClick={onToggleTheme}
          >
            {isDark ? <Moon size={22} /> : <SunMedium size={22} />}
          </button>
        </div>
      </nav>
    </header>
  );
}

function ToolsPage({ previewUrl }) {
  return (
    <section
      className="grid grid-cols-[minmax(0,0.9fr)_minmax(380px,0.8fr)] gap-7 max-[980px]:grid-cols-1"
      aria-label="Package Size tools"
    >
      <div className="pt-2">
        <h2 className="m-0 max-w-[760px] text-[42px] leading-[1.04] font-black tracking-normal text-[#0c1118] dark:text-[#f7f9f9] max-[680px]:text-[32px]">
          Self-serve tools for exact resolver URLs.
        </h2>
        <p className="mt-5 mb-6 max-w-[760px] text-[18px] leading-[1.45] text-[#5b6678] dark:text-[#8b98a5]">
          Local commands and URL construction live here so the measure page stays focused on package search, resolved versions, and size results.
        </p>
        <div className="grid max-w-[860px] grid-cols-2 gap-3.5 max-[680px]:grid-cols-1">
          <CommandBlock icon={<Terminal size={18} />} title="Local JSON" command="node bin/package-size.js json react" />
          <CommandBlock icon={<Code2 size={18} />} title="Dev dashboard" command="pnpm run dev" />
        </div>
        <div className="mt-5 flex items-center gap-2.5 text-[15px] font-[650] text-[#354153] dark:text-[#d6dde4]">
          <Database size={18} aria-hidden="true" />
          <span>Resolved versions are pinned in recents so later runs use the stable URL UNPKG selected.</span>
        </div>
      </div>
      <aside className="rounded-[7px] border border-[#cbd4de] bg-white shadow-[0_8px_22px_rgba(15,23,42,0.05)] dark:border-[#38444d] dark:bg-[#192734] dark:shadow-none">
        <details className="shareable-details" open>
          <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-5 py-4 text-[15px] font-bold text-[#1d9bf0] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#1d9bf0] dark:text-[#8ecdf8]">
            <span className="flex items-center gap-2.5">
              <Link2 size={18} aria-hidden="true" />
              <span>Shareable resolver URL</span>
            </span>
            <ChevronDown className="shareable-chevron transition-transform" size={19} aria-hidden="true" />
          </summary>
          <div className="px-5 pb-5">
            <h3 className="m-0 text-[22px] font-extrabold text-[#111827] dark:text-[#f7f9f9]">Build a UNPKG variant</h3>
            <p className="m-0 mt-2 text-[15px] leading-[1.4] text-[#5b6678] dark:text-[#8b98a5]">
              Open the builder to set package, subpath, target, export conditions, metadata, and bundle flags. Resolving updates the dashboard URL with the package and UNPKG query parameters.
            </p>
            <code className="mt-4 block max-h-[88px] overflow-auto wrap-anywhere rounded-[7px] border border-[#e1e7ed] bg-[#f7fafc] px-3 py-2.5 text-[13px] leading-[1.35] text-[#111827] dark:border-[#38444d] dark:bg-[#15202b] dark:text-[#f7f9f9]">
              {previewUrl || "Enter a valid package spec to preview the URL."}
            </code>
            <button
              className="mt-4 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-[7px] border-0 bg-linear-to-b from-[#1d9bf0] to-[#1a8cd8] px-4 text-[16px] font-bold text-white shadow-[0_10px_24px_rgba(29,155,240,0.20)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d9bf0] dark:from-[#1d9bf0] dark:to-[#1a8cd8] dark:shadow-[0_12px_28px_rgba(29,155,240,0.18)]"
              type="button"
              popoverTarget={URL_BUILDER_POPOVER_ID}
            >
              <Link2 size={18} />
              URL builder
            </button>
          </div>
        </details>
      </aside>
    </section>
  );
}

function CommandBlock({ icon, title, command }) {
  return (
    <div className="rounded-[7px] border border-[#d9e0e7] bg-white px-3.5 py-3 dark:border-[#38444d] dark:bg-[#192734]">
      <div className="mb-2 flex items-center gap-2 text-sm font-bold text-[#5b6678] dark:text-[#8b98a5]">
        {icon}
        <span>{title}</span>
      </div>
      <code className="block wrap-anywhere text-[15px] leading-[1.35] font-bold text-[#111827] dark:text-[#f7f9f9]">
        {command}
      </code>
    </div>
  );
}

function UrlBuilderPopover({
  error,
  loading,
  onResolve,
  previewUrl,
  query,
  setQuery,
  setSizeOptions,
  sizeOptions,
}) {
  const popoverRef = useRef(null);
  const setOption = (key, value) => {
    setSizeOptions((current) => ({
      ...current,
      [key]: value,
    }));
  };
  const toggleCondition = (condition) => {
    setSizeOptions((current) => {
      const selected = new Set(current.conditions);
      if (selected.has(condition)) {
        selected.delete(condition);
      } else {
        selected.add(condition);
      }
      const conditions = [...selected];
      return {
        ...current,
        conditions: conditions.length ? conditions : ["browser"],
      };
    });
  };
  const copyUrl = () => {
    navigator.clipboard?.writeText(previewUrl).catch(() => {});
  };
  const resolveFromBuilder = async () => {
    const nextResult = await onResolve(query, sizeOptions);
    if (nextResult) {
      popoverRef.current?.hidePopover?.();
    }
  };

  return (
    <div
      className="url-builder-popover"
      id={URL_BUILDER_POPOVER_ID}
      popover="auto"
      ref={popoverRef}
      role="dialog"
      aria-labelledby="url-builder-title"
    >
      <div className="max-h-[calc(100vh_-_36px)] overflow-auto rounded-[7px] border border-[#cbd4de] bg-white p-5 shadow-[0_26px_70px_rgba(15,23,42,0.28)] dark:border-[#38444d] dark:bg-[#192734]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 id="url-builder-title" className="m-0 text-[24px] font-extrabold text-[#111827] dark:text-[#f7f9f9]">
              URL builder
            </h3>
            <p className="m-0 mt-1 text-[15px] leading-[1.35] text-[#5b6678] dark:text-[#8b98a5]">
              Construct and resolve the esm.unpkg.com variant, then view the measured size.
            </p>
          </div>
          <button
            className={iconButtonClass}
            type="button"
            popoverTarget={URL_BUILDER_POPOVER_ID}
            popoverTargetAction="hide"
            aria-label="Close URL builder"
          >
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-bold text-[#354153] dark:text-[#d6dde4]">
            Package spec
            <input
              className={fieldClass}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="react or @scope/package@tag"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold text-[#354153] dark:text-[#d6dde4]">
            Subpath
            <input
              className={fieldClass}
              value={sizeOptions.subpath}
              onChange={(event) => setOption("subpath", event.target.value)}
              placeholder="client or dist/index.js"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold text-[#354153] dark:text-[#d6dde4]">
            Target
            <select
              className={fieldClass}
              value={sizeOptions.target}
              onChange={(event) => setOption("target", event.target.value)}
            >
              {["es2018", "es2020", "es2022", "es2024", "esnext", "node", "deno"].map((target) => (
                <option key={target} value={target}>
                  {target}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="mb-2 block text-sm font-bold text-[#354153] dark:text-[#d6dde4]">Export conditions</span>
            <div className="grid grid-cols-3 gap-2 max-[520px]:grid-cols-1">
              {conditionOptions.map((condition) => (
                <CheckboxControl
                  key={condition}
                  label={condition}
                  checked={sizeOptions.conditions.includes(condition)}
                  onChange={() => toggleCondition(condition)}
                />
              ))}
            </div>
          </div>
          <label className="grid gap-1.5 text-sm font-bold text-[#354153] dark:text-[#d6dde4]">
            Bundle mode
            <select
              className={fieldClass}
              value={sizeOptions.bundle}
              onChange={(event) => setOption("bundle", event.target.value)}
            >
              <option value="default">Default</option>
              <option value="bundle">Bundle</option>
              <option value="standalone">Standalone</option>
              <option value="no-bundle">No bundle</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 max-[520px]:grid-cols-1">
            <CheckboxControl
              label="Development"
              checked={sizeOptions.env === "development"}
              onChange={() => setOption("env", sizeOptions.env === "development" ? "production" : "development")}
            />
            <CheckboxControl label="Minify" checked={sizeOptions.min} onChange={() => setOption("min", !sizeOptions.min)} />
            <CheckboxControl
              label="Source map"
              checked={sizeOptions.sourcemap}
              onChange={() => setOption("sourcemap", !sizeOptions.sourcemap)}
            />
            <CheckboxControl
              label="Metadata"
              checked={sizeOptions.meta}
              onChange={() => setOption("meta", !sizeOptions.meta)}
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 max-[520px]:grid-cols-1">
            <code className="block max-h-[92px] overflow-auto wrap-anywhere rounded-[7px] border border-[#e1e7ed] bg-[#f7fafc] px-3 py-2.5 text-[13px] leading-[1.35] text-[#111827] dark:border-[#38444d] dark:bg-[#15202b] dark:text-[#f7f9f9]">
              {previewUrl || "Enter a valid package spec to preview the URL."}
            </code>
            <button className={iconButtonClass} type="button" onClick={copyUrl} aria-label="Copy constructed URL">
              <Clipboard size={19} />
            </button>
          </div>
          {error ? (
            <p className="m-0 rounded-[7px] border border-[#fac9be] bg-[#fff4f1] px-3 py-2 text-[14px] font-semibold text-[#a43d28] dark:border-[#8c3d32] dark:bg-[#3a2526] dark:text-[#ffb4a8]">
              {error}
            </p>
          ) : null}
          <button
            className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-[7px] border-0 bg-linear-to-b from-[#1d9bf0] to-[#1a8cd8] text-[18px] font-bold text-white shadow-[0_10px_24px_rgba(29,155,240,0.20)] disabled:cursor-wait disabled:opacity-80 dark:from-[#1d9bf0] dark:to-[#1a8cd8] dark:shadow-[0_12px_28px_rgba(29,155,240,0.18)]"
            type="button"
            disabled={loading}
            onClick={resolveFromBuilder}
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : null}
            Resolve package
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckboxControl({ label, checked, onChange }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-[7px] border border-[#d9e0e7] bg-[#fbfcfd] px-3 text-[14px] font-[650] text-[#354153] dark:border-[#38444d] dark:bg-[#15202b] dark:text-[#d6dde4]">
      <input
        className="h-4 w-4 accent-[#1d9bf0] dark:accent-[#1d9bf0]"
        type="checkbox"
        checked={checked}
        onChange={onChange}
      />
      <span>{label}</span>
    </label>
  );
}

function SearchForm({ query, setQuery, onSubmit, loading }) {
  return (
    <form className="mb-7 flex items-center gap-4 max-[980px]:flex-col max-[980px]:items-stretch" onSubmit={onSubmit}>
      <div className="flex h-14 flex-1 items-center rounded-[7px] border-2 border-[#1d9bf0] bg-white text-[#667282] shadow-[0_5px_16px_rgba(29,155,240,0.10)] dark:border-[#1d9bf0] dark:bg-[#192734] dark:text-[#8b98a5] dark:shadow-none">
        <Search className="ml-3.5" size={23} aria-hidden="true" />
        <input
          className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 pr-2.5 pl-3.5 text-[21px] tracking-normal text-[#111827] outline-0 placeholder:text-[#8b95a4] dark:text-[#f7f9f9] dark:placeholder:text-[#536471] max-[680px]:text-lg"
          aria-label="Package name"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="react"
        />
        {query ? (
          <button
            className="mr-1.5 inline-grid h-11 w-11 place-items-center rounded-[7px] border-0 bg-transparent text-[#647184] hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:text-[#8b98a5] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            <X size={22} />
          </button>
        ) : null}
      </div>
      <button
        className="inline-flex h-14 min-w-[118px] cursor-pointer items-center justify-center gap-2 rounded-[7px] border-0 bg-linear-to-b from-[#1d9bf0] to-[#1a8cd8] text-xl font-bold text-white shadow-[0_10px_24px_rgba(29,155,240,0.22)] disabled:cursor-wait disabled:opacity-80 dark:from-[#1d9bf0] dark:to-[#1a8cd8] dark:shadow-[0_12px_28px_rgba(29,155,240,0.2)] max-[980px]:w-full"
        disabled={loading}
        type="submit"
      >
        {loading ? <Loader2 className="animate-spin" size={21} /> : null}
        Search
      </button>
    </form>
  );
}

function PackageIcon({ name }) {
  return (
    <span
      className="inline-grid h-7 w-7 place-items-center rounded-[7px] border border-[#d3dce5] bg-[#111827] text-xs font-extrabold tracking-normal text-white dark:border-[#38444d] dark:bg-[#223949] dark:text-[#f7f9f9]"
      aria-hidden="true"
    >
      {packageInitial(name)}
    </span>
  );
}

function resultKind(result) {
  return result.options?.meta ? "Resolved metadata" : "Resolved browser artifact";
}

function ResultHeader({ result, loading, onRefresh }) {
  return (
    <section
      className="mb-7 flex items-start justify-between gap-6 max-[980px]:flex-col max-[980px]:items-stretch"
      aria-label="Package result"
    >
      <div>
        <div className="flex items-center gap-2.5">
          <h2 className="m-0 text-3xl leading-[1.1] font-extrabold text-[#0c1118] dark:text-[#f7f9f9]">
            {result.package}
          </h2>
          <CheckCircle2 className="text-[#1f7ae8] dark:text-[#1d9bf0]" size={22} fill="currentColor" aria-hidden="true" />
        </div>
        <p className="my-2 mb-5 max-w-[740px] overflow-hidden text-base leading-[1.35] text-ellipsis whitespace-nowrap text-[#5b6678] dark:text-[#8b98a5] max-[680px]:whitespace-normal">
          {result.resolvedUrl.replace("https://", "")}
        </p>
        <div className="flex items-center gap-[18px] text-[15px] text-[#5b6678] dark:text-[#8b98a5] max-[680px]:flex-wrap max-[680px]:gap-x-3 max-[680px]:gap-y-2">
          <span className="inline-flex h-9 min-w-24 items-center rounded-[5px] border border-[#cbd4de] bg-white px-3 text-[17px] text-[#111827] dark:border-[#38444d] dark:bg-[#192734] dark:text-[#f7f9f9]">
            {result.version}
          </span>
          <span className="h-[18px] w-px bg-[#d9e0e7] dark:bg-[#38444d]" aria-hidden="true" />
          <span>{resultKind(result)}</span>
          <span className="h-[18px] w-px bg-[#d9e0e7] dark:bg-[#38444d]" aria-hidden="true" />
          <span>{result.source}</span>
        </div>
      </div>
      <div className="flex items-center gap-2.5 pt-2.5 text-sm whitespace-nowrap text-[#263241] dark:text-[#f7f9f9] max-[980px]:pt-0">
        <span className="h-[7px] w-[7px] rounded-full bg-[#25b253] dark:bg-[#00ba7c]" aria-hidden="true" />
        <span>{loading ? "Measuring" : result.cacheHit ? "Cache hit" : "Measured"}</span>
        <span>{relativeTime(result.measuredAt)}</span>
        <button
          className="inline-grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-[#657284] hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:text-[#8b98a5] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
          type="button"
          onClick={onRefresh}
          aria-label="Refresh result"
        >
          <RotateCcw size={16} />
        </button>
      </div>
    </section>
  );
}

function Metric({ title, value, bytes, tone, footnote }) {
  const styles = toneStyles[tone];

  return (
    <div className="min-h-[136px] border-r border-[#d9e0e7] pt-1 pr-[30px] last:border-r-0 not-first:pl-[30px] dark:border-[#38444d] max-[680px]:mb-[18px] max-[680px]:min-h-0 max-[680px]:border-r-0 max-[680px]:border-b max-[680px]:border-[#d9e0e7] max-[680px]:p-0 max-[680px]:pb-[18px] max-[680px]:last:mb-0 max-[680px]:last:border-b-0 dark:max-[680px]:border-[#38444d]">
      <div className="mb-3 flex items-center gap-2 text-[17px] text-[#5b6678] dark:text-[#8b98a5]">
        <span>{title}</span>
        <span className="inline-grid h-[17px] w-[17px] place-items-center rounded-full border border-[#98a4b3] text-xs font-[750] text-[#7c8796] dark:border-[#536471] dark:text-[#8b98a5]">
          i
        </span>
      </div>
      <strong className={`mb-[5px] block text-[27px] font-extrabold tracking-normal ${styles.text}`}>
        {formatKiB(value)}
      </strong>
      <span className="block text-[15px] text-[#5b6678] dark:text-[#8b98a5]">{formatBytes(bytes)}</span>
      {footnote ? (
        <span className={`mt-3.5 inline-block rounded-[5px] px-[9px] py-[3px] text-sm font-[650] ${styles.note}`}>
          {footnote}
        </span>
      ) : null}
    </div>
  );
}

function CompressionChart({ result }) {
  const rows = [
    { label: "Minified", bytes: result.rawBytes, tone: "minified" },
    { label: "Gzip", bytes: result.gzipBytes, tone: "gzip" },
    { label: "Brotli", bytes: result.brotliBytes, tone: "brotli" },
  ];
  const max = Math.max(...rows.map((row) => row.bytes), 1);

  return (
    <div className="min-w-0" aria-label="Compression comparison">
      <div className="mb-[18px] flex items-center justify-center gap-7 text-[15px] text-[#5b6678] dark:text-[#8b98a5]">
        {rows.map((row) => (
          <span className="inline-flex items-center gap-2" key={row.label}>
            <i className={`h-3 w-3 rounded-[2px] ${toneStyles[row.tone].bar}`} aria-hidden="true" />
            {row.label}
          </span>
        ))}
      </div>
      <div className="grid gap-3.5">
        {rows.map((row) => (
          <div
            className="grid grid-cols-[84px_minmax(160px,1fr)_118px] items-center gap-3.5 text-[15px] text-[#354153] dark:text-[#f7f9f9] max-[680px]:grid-cols-[68px_minmax(120px,1fr)]"
            key={row.label}
          >
            <span>{row.label}</span>
            <div className="h-[22px] border-b border-[#d2d9e2] dark:border-[#38444d]">
              <i
                className={`block h-full rounded-r-[3px] ${toneStyles[row.tone].bar}`}
                style={{ width: `${Math.max(6, (row.bytes / max) * 100)}%` }}
              />
            </div>
            <em className="text-[#5b6678] not-italic whitespace-nowrap dark:text-[#8b98a5] max-[680px]:col-start-2">
              {formatBytes(row.bytes)}
            </em>
          </div>
        ))}
      </div>
      <div className="ml-[98px] flex justify-between border-t border-[#cbd4de] pt-2 text-sm text-[#5b6678] dark:border-[#38444d] dark:text-[#8b98a5] max-[680px]:ml-[82px]">
        <span>0</span>
        <span>{formatKiB(max / 2)}</span>
        <span>{formatKiB(max)}</span>
      </div>
    </div>
  );
}

function MetricsPanel({ result }) {
  return (
    <section
      className="mb-[34px] grid grid-cols-[minmax(0,0.48fr)_minmax(420px,0.52fr)] items-end gap-7 border-b border-[#d9e0e7] pb-8 dark:border-[#38444d] max-[980px]:grid-cols-1"
      aria-label="Size metrics"
    >
      <div className="grid grid-cols-3 border-r border-[#d9e0e7] dark:border-[#38444d] max-[980px]:border-r-0 max-[680px]:grid-cols-1">
        <Metric title="Minified" value={result.rawBytes} bytes={result.rawBytes} tone="minified" />
        <Metric
          title="Gzip"
          value={result.gzipBytes}
          bytes={result.gzipBytes}
          tone="gzip"
          footnote={smallerBy(result.rawBytes, result.gzipBytes)}
        />
        <Metric
          title="Brotli"
          value={result.brotliBytes}
          bytes={result.brotliBytes}
          tone="brotli"
          footnote={smallerBy(result.rawBytes, result.brotliBytes)}
        />
      </div>
      <CompressionChart result={result} />
    </section>
  );
}

function ErrorMessage({ message }) {
  if (!message) {
    return null;
  }

  return (
    <div
      className="-mt-3 mb-5 rounded-[7px] border border-[#fac9be] bg-[#fff4f1] px-3.5 py-[11px] text-[15px] font-semibold text-[#a43d28] dark:border-[#8c3d32] dark:bg-[#3a2526] dark:text-[#ffb4a8]"
      role="alert"
    >
      {message}
    </div>
  );
}

function MobileLabel({ children }) {
  return <span className={mobileLabelClass}>{children}</span>;
}

function RecentsTable({ recents, onSelect, onClear }) {
  return (
    <section aria-label="Recently searched packages">
      <div className="mb-[18px] flex items-center justify-between">
        <h2 className="m-0 text-[23px] font-extrabold text-[#111827] dark:text-[#f7f9f9]">Recently searched</h2>
        {recents.length ? (
          <button
            className="cursor-pointer border-0 bg-transparent text-[15px] font-[650] text-[#1d9bf0] hover:text-[#0f6fb8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:text-[#1d9bf0] dark:hover:text-[#8ecdf8]"
            type="button"
            onClick={onClear}
          >
            Clear history
          </button>
        ) : null}
      </div>
      {recents.length ? (
        <div className="overflow-x-auto max-[680px]:overflow-visible">
          <table className="w-full min-w-[900px] border-collapse max-[680px]:min-w-0">
            <thead className="max-[680px]:hidden">
              <tr>
                <th className={thClass}>Package</th>
                <th className={thClass}>Version</th>
                <th className={thClass}>Mode</th>
                <th className={thClass}>Minified</th>
                <th className={thClass}>Gzip</th>
                <th className={thClass}>Brotli</th>
                <th className={thClass}>Last searched</th>
                <th className={thClass} aria-label="Action" />
              </tr>
            </thead>
            <tbody className="max-[680px]:grid max-[680px]:gap-3.5">
              {recents.slice(0, 5).map((recent) => (
                <tr
                  className="max-[680px]:relative max-[680px]:grid max-[680px]:grid-cols-2 max-[680px]:gap-x-[18px] max-[680px]:gap-y-2.5 max-[680px]:border-b max-[680px]:border-[#e1e7ed] max-[680px]:pt-[13px] max-[680px]:pr-[42px] max-[680px]:pb-3.5 max-[680px]:pl-0 dark:max-[680px]:border-[#38444d]"
                  key={recent.resolvedUrl}
                >
                  <td className={`${tdClass} max-[680px]:col-span-2`}>
                    <button
                      className="inline-flex cursor-pointer items-center gap-3.5 border-0 bg-transparent p-0 font-[750] text-[#111827] dark:text-[#f7f9f9]"
                      type="button"
                      onClick={() => onSelect(recent.pinnedQuery, recent.options)}
                    >
                      <PackageIcon name={recent.package} />
                      <span>{recent.package}</span>
                    </button>
                  </td>
                  <td className={tdClass}>
                    <MobileLabel>Version</MobileLabel>
                    {recent.version}
                  </td>
                  <td className={tdClass}>
                    <MobileLabel>Mode</MobileLabel>
                    {recent.options.meta ? "Metadata" : recent.options.target}
                  </td>
                  <td className={`${tdClass} ${toneStyles.minified.text}`}>
                    <MobileLabel>Minified</MobileLabel>
                    {formatKiB(recent.rawBytes)}
                  </td>
                  <td className={`${tdClass} ${toneStyles.gzip.text}`}>
                    <MobileLabel>Gzip</MobileLabel>
                    {formatKiB(recent.gzipBytes)}
                  </td>
                  <td className={`${tdClass} ${toneStyles.brotli.text}`}>
                    <MobileLabel>Brotli</MobileLabel>
                    {formatKiB(recent.brotliBytes)}
                  </td>
                  <td className={tdClass}>
                    <MobileLabel>Last</MobileLabel>
                    {relativeTime(recent.lastSearchedAt)}
                  </td>
                  <td className={`${tdClass} max-[680px]:absolute max-[680px]:top-3 max-[680px]:right-0`}>
                    <button
                      className="inline-grid h-8 w-8 place-items-center rounded-[7px] border-0 bg-transparent text-[#657284] hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:text-[#8b98a5] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
                      type="button"
                      onClick={() => onSelect(recent.pinnedQuery, recent.options)}
                      aria-label={`Search ${recent.pinnedQuery}`}
                    >
                      <ChevronRight size={20} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex min-h-[110px] items-center justify-center gap-2.5 border-y border-[#e1e7ed] font-[650] text-[#5b6678] dark:border-[#38444d] dark:text-[#8b98a5]">
          <PackageSearch size={26} />
          <span>No recent searches yet.</span>
        </div>
      )}
      {recents.length > 5 ? (
        <button
          className="mx-auto mt-6 block cursor-pointer border-0 bg-transparent text-[17px] font-[650] text-[#1d9bf0] hover:text-[#0f6fb8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:text-[#1d9bf0] dark:hover:text-[#8ecdf8]"
          type="button"
        >
          View all history
        </button>
      ) : null}
    </section>
  );
}

export default function App() {
  const [initialDashboardState] = useState(readDashboardStateFromLocation);
  const [query, setQuery] = useState(initialDashboardState.query);
  const [sizeOptions, setSizeOptions] = useState(initialDashboardState.sizeOptions);
  const [result, setResult] = useState(sampleResult);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState("measure");
  const [theme, setTheme] = useState(getPreferredTheme);
  const [recents, setRecents] = useState(() => {
    if (typeof window === "undefined") {
      return [];
    }
    return readRecents();
  });
  const didAutoMeasure = useRef(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const router = createRouter({
      mode: "signals",
      urlMode: "hash",
      root: document,
      routes: pageRoutes,
    }).start();

    const syncPage = () => {
      setCurrentPage(pageFromRoute(router.signals.get("router.route")));
    };
    const unsubscribe = router.signals.subscribe("router.route", syncPage);
    syncPage();

    return () => {
      unsubscribe?.();
      router.destroy();
    };
  }, []);

  const previewUrl = useMemo(() => {
    try {
      return buildEsmUnpkgUrl(query || "react", sizeOptions);
    } catch {
      return "";
    }
  }, [query, sizeOptions]);

  const saveRecent = useCallback((nextResult) => {
    setRecents((current) => {
      const recent = normalizeResultForRecent(nextResult);
      const deduped = current.filter(
        (item) => item.resolvedUrl !== recent.resolvedUrl,
      );
      const next = [recent, ...deduped].slice(0, MAX_RECENTS);
      writeRecents(next);
      return next;
    });
  }, []);

  const runSearch = useCallback(
    async (nextQuery = query, nextOptions = sizeOptions, options = {}) => {
      const trimmed = nextQuery.trim();
      if (!trimmed) {
        setError("Enter a package name.");
        return null;
      }

      let normalizedOptions;
      try {
        normalizedOptions = normalizeSizeOptions(nextOptions);
      } catch (nextError) {
        setError(nextError.message);
        return null;
      }

      setQuery(trimmed);
      setSizeOptions(normalizedOptions);
      setLoading(true);
      setError("");

      try {
        const nextResult = await fetchPackageSize(trimmed, normalizedOptions);
        setResult(nextResult);
        saveRecent(nextResult);
        if (options.history !== false) {
          writeDashboardStateToLocation(trimmed, normalizedOptions, options.history ?? "push");
        }
        return nextResult;
      } catch (nextError) {
        setError(nextError.message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [query, saveRecent, sizeOptions],
  );

  useEffect(() => {
    if (didAutoMeasure.current) {
      return;
    }
    didAutoMeasure.current = true;
    runSearch(initialDashboardState.query, initialDashboardState.sizeOptions, { history: "replace" });
  }, [initialDashboardState, runSearch]);

  useEffect(() => {
    const handlePopState = () => {
      const nextState = readDashboardStateFromLocation();
      runSearch(nextState.query, nextState.sizeOptions, { history: false });
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [runSearch]);

  const visibleResult = useMemo(() => result ?? sampleResult, [result]);

  return (
    <div className="min-h-screen min-w-80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(251,252,253,0.9)),radial-gradient(circle_at_25%_0%,rgba(29,155,240,0.07),transparent_32%)] font-sans text-[#111827] antialiased dark:bg-[linear-gradient(180deg,rgba(21,32,43,0.98),rgba(21,32,43,0.94)),radial-gradient(circle_at_25%_0%,rgba(29,155,240,0.10),transparent_34%)] dark:text-[#f7f9f9]">
      <Header
        currentPage={currentPage}
        theme={theme}
        onToggleTheme={() => {
          setTheme((current) => (current === "dark" ? "light" : "dark"));
        }}
      />
      <main className="mx-auto w-[calc(100vw_-_64px)] max-w-[1376px] py-[38px] pb-14 max-[980px]:w-[calc(100%_-_32px)] max-[980px]:max-w-[760px] max-[980px]:pt-6">
        {currentPage === "tools" ? (
          <ToolsPage
            previewUrl={previewUrl}
          />
        ) : (
          <>
            <SearchForm
              query={query}
              setQuery={setQuery}
              loading={loading}
              onSubmit={(event) => {
                event.preventDefault();
                runSearch();
              }}
            />
            <ErrorMessage message={error} />
            <ResultHeader
              result={visibleResult}
              loading={loading}
              onRefresh={() => runSearch(visibleResult.query, visibleResult.options, { history: "replace" })}
            />
            <MetricsPanel result={visibleResult} />
            <RecentsTable
              recents={recents}
              onSelect={runSearch}
              onClear={() => {
                writeRecents([]);
                setRecents([]);
              }}
            />
          </>
        )}
      </main>
      <UrlBuilderPopover
        error={error}
        loading={loading}
        onResolve={(nextQuery, nextOptions) => runSearch(nextQuery, nextOptions)}
        previewUrl={previewUrl}
        query={query}
        setQuery={setQuery}
        setSizeOptions={setSizeOptions}
        sizeOptions={sizeOptions}
      />
    </div>
  );
}
