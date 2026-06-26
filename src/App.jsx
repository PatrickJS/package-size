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
  BarChart3,
  Database,
  Download,
  Gauge,
  GitBranch,
  History,
  Link2,
  Loader2,
  Moon,
  PackageSearch,
  Plus,
  RotateCcw,
  Search,
  SunMedium,
  Terminal,
  TrendingUp,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildNpmMaintainerUrl,
  buildNpmPackageUrl,
  buildNpmRegistryPackageUrl,
  buildNpmScopeUrl,
  buildEsmUnpkgUrl,
  buildSizeApiSearchParams,
  buildUnpkgSearchParams,
  compareStableVersionsDesc,
  DEFAULT_SIZE_OPTIONS,
  isStableVersion,
  normalizeSizeOptions,
  npmPackageScope,
  parsePackageSpec,
  packageSpecFromResolved,
  sizeOptionsSignature,
  sizeOptionsFromSearchParams,
} from "./package-url.js";
import { measurePackageSizeInBrowser } from "./browser-measure.js";
import {
  readBrowserCachedPackageHistory,
  readBrowserMeasurement,
  readBrowserVersionHistory,
  writeBrowserMeasurement,
  writeBrowserVersionHistory,
} from "./browser-cache.js";

const RECENTS_KEY = "package-size.recent-searches.v2";
const LEGACY_RECENTS_KEY = "package-size.recent-searches.v1";
const THEME_KEY = "package-size.theme.v1";
const TRACKED_PACKAGES_KEY = "package-size.tracked-packages.v1";
const MAX_RECENTS = 8;
const MAX_TRACKED_PACKAGES = 24;
const DEFAULT_VERSION_HISTORY_LIMIT = 5;
const VERSION_HISTORY_PAGE_SIZE = 5;
const MAX_VERSION_HISTORY = 100;
const DEFAULT_QUERY = "react";
const URL_BUILDER_POPOVER_ID = "url-builder-popover";
const VERSION_HISTORY_GRAPH_KEY = "package-size.version-history.graph.v1";

const conditionOptions = ["browser", "react-server", "worker"];
const pageRoutes = createRouteRegistry({
  "/": defineRoute({ render: "none", meta: { page: "measure" } }),
  "/dashboard": defineRoute({ render: "none", meta: { page: "dashboard" } }),
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
  if (route?.meta?.page === "dashboard") {
    return "dashboard";
  }
  return route?.meta?.page === "tools" ? "tools" : "measure";
}

function pageFromLocationHash(trackedPackages = []) {
  if (typeof window === "undefined") {
    return "measure";
  }
  const hashPath = window.location.hash.replace(/^#/, "") || "/";
  if (hashPath.startsWith("/dashboard")) {
    return "dashboard";
  }
  if (hashPath.startsWith("/tools")) {
    return "tools";
  }
  return window.location.hash ? "measure" : trackedPackages.length ? "dashboard" : "measure";
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

function formatHistorySize(bytes) {
  if (typeof bytes !== "number") {
    return "Not loaded";
  }
  return formatKiB(bytes);
}

function trendTone(delta) {
  if (delta > 0) {
    return {
      label: `+${formatKiB(delta)}`,
      stroke: "#b95000",
      text: "text-[#b95000] dark:text-[#ffb86b]",
    };
  }
  if (delta < 0) {
    return {
      label: `-${formatKiB(Math.abs(delta))}`,
      stroke: "#178a45",
      text: "text-[#178a45] dark:text-[#00ba7c]",
    };
  }
  return {
    label: "No change",
    stroke: "#1d9bf0",
    text: "text-[#5b6678] dark:text-[#8b98a5]",
  };
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

function formatDate(isoDate) {
  if (!isoDate) {
    return "Unknown";
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function loadedTrendEntries(entries) {
  return entries
    .filter((entry) => (
      entry?.loaded &&
      isStableVersion(entry.version) &&
      typeof entry.rawBytes === "number" &&
      typeof entry.gzipBytes === "number" &&
      typeof entry.brotliBytes === "number"
    ))
    .sort((left, right) => compareStableVersionsDesc(right.version, left.version));
}

const sizeTrendSeries = [
  {
    key: "rawBytes",
    label: "Minified",
    color: "#1d9bf0",
    text: toneStyles.minified.text,
  },
  {
    key: "gzipBytes",
    label: "Gzip",
    color: "#1f7ae8",
    text: toneStyles.gzip.text,
  },
  {
    key: "brotliBytes",
    label: "Brotli",
    color: "#e58a00",
    text: toneStyles.brotli.text,
  },
];

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

function getPreferredVersionHistoryGraph() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(VERSION_HISTORY_GRAPH_KEY) === "true";
  } catch {
    return false;
  }
}

function writeVersionHistoryGraphPreference(showGraph) {
  try {
    window.localStorage.setItem(VERSION_HISTORY_GRAPH_KEY, showGraph ? "true" : "false");
  } catch {
    // Graph visibility is a UI preference, so storage failures should not block the toggle.
  }
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

function trackedPackageId(packageSpec, sizeOptions) {
  return `${String(packageSpec ?? "").trim()}|${sizeOptionsSignature(sizeOptions)}`;
}

function normalizeTrackedResult(result) {
  if (
    !result?.package ||
    !result?.version ||
    typeof result.rawBytes !== "number" ||
    typeof result.gzipBytes !== "number" ||
    typeof result.brotliBytes !== "number"
  ) {
    return null;
  }

  let options;
  try {
    options = normalizeSizeOptions(result.options ?? {});
  } catch {
    return null;
  }

  return {
    query: result.query ?? packageSpecFromResolved(result.package, result.version),
    package: result.package,
    pinnedQuery: result.pinnedQuery ?? packageSpecFromResolved(result.package, result.version),
    version: result.version,
    rawBytes: result.rawBytes,
    gzipBytes: result.gzipBytes,
    brotliBytes: result.brotliBytes,
    requestUrl: result.requestUrl ?? result.resolvedUrl,
    resolvedUrl: result.resolvedUrl,
    options,
    contentType: result.contentType,
    source: result.source,
    measuredAt: result.measuredAt,
    cacheHit: Boolean(result.cacheHit),
  };
}

function normalizeTrackedPackage(item) {
  const packageSpec = String(item?.packageSpec ?? item?.query ?? "").trim();
  if (!packageSpec) {
    return null;
  }

  let options;
  try {
    parsePackageSpec(packageSpec);
    options = normalizeSizeOptions(item.options ?? {});
  } catch {
    return null;
  }

  const result = normalizeTrackedResult(item.result);
  return {
    id: trackedPackageId(packageSpec, options),
    packageSpec,
    options,
    result,
    addedAt: item.addedAt ?? new Date().toISOString(),
    updatedAt: item.updatedAt ?? result?.measuredAt ?? null,
    error: item.error ?? "",
  };
}

function readTrackedPackages() {
  try {
    const raw = window.localStorage.getItem(TRACKED_PACKAGES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return parsed.map(normalizeTrackedPackage).filter(Boolean).slice(0, MAX_TRACKED_PACKAGES);
  } catch {
    return [];
  }
}

function writeTrackedPackages(packages) {
  window.localStorage.setItem(TRACKED_PACKAGES_KEY, JSON.stringify(packages));
}

function splitTrackedPackageSpecs(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function trackedPackageFromSpec(packageSpec, sizeOptions, existing = {}) {
  const parsed = parsePackageSpec(packageSpec);
  const options = normalizeSizeOptions(sizeOptions ?? {});
  const spec = parsed.version
    ? packageSpecFromResolved(parsed.packageName, parsed.version)
    : parsed.packageName;
  return {
    id: trackedPackageId(spec, options),
    packageSpec: spec,
    options,
    result: normalizeTrackedResult(existing.result),
    addedAt: existing.addedAt ?? new Date().toISOString(),
    updatedAt: existing.updatedAt ?? null,
    error: "",
  };
}

function sameSizeOptions(left, right) {
  try {
    return sizeOptionsSignature(left) === sizeOptionsSignature(right);
  } catch {
    return false;
  }
}

function historyContextKey(result) {
  if (!result?.package) {
    return "";
  }
  return `${result.package}|${sizeOptionsSignature(result.options ?? {})}`;
}

function historyEntryFromMeasurement(measurement, extra = {}) {
  if (
    !measurement?.package ||
    !measurement?.version ||
    typeof measurement.rawBytes !== "number" ||
    typeof measurement.gzipBytes !== "number" ||
    typeof measurement.brotliBytes !== "number"
  ) {
    return null;
  }

  let options;
  try {
    options = normalizeSizeOptions(measurement.options ?? {});
  } catch {
    return null;
  }

  return {
    package: measurement.package,
    version: measurement.version,
    requestUrl: measurement.requestUrl ?? measurement.resolvedUrl,
    resolvedUrl: measurement.resolvedUrl,
    rawBytes: measurement.rawBytes,
    gzipBytes: measurement.gzipBytes,
    brotliBytes: measurement.brotliBytes,
    measuredAt: measurement.measuredAt,
    cachedAt: measurement.cachedAt,
    publishedAt: extra.publishedAt ?? measurement.publishedAt ?? null,
    options,
    loaded: true,
  };
}

function normalizeVersionRow(row) {
  if (!row?.version || !isStableVersion(row.version)) {
    return null;
  }

  const measured = historyEntryFromMeasurement(row, {
    publishedAt: row.publishedAt,
  });
  if (measured) {
    return measured;
  }

  return {
    package: row.package,
    version: row.version,
    publishedAt: row.publishedAt ?? null,
    loaded: false,
  };
}

function localHistoryEntries(recents, result) {
  const entries = [historyEntryFromMeasurement(result)];
  entries.push(
    ...recents
      .filter((recent) => (
        recent.package === result.package &&
        sameSizeOptions(recent.options, result.options)
      ))
      .map((recent) => historyEntryFromMeasurement(recent)),
  );

  return entries.filter((entry) => entry && isStableVersion(entry.version));
}

function publicMaintainers(metadata) {
  if (!Array.isArray(metadata?.maintainers)) {
    return [];
  }

  return metadata.maintainers
    .map((maintainer) => (
      typeof maintainer === "string"
        ? maintainer
        : maintainer?.name
    ))
    .map((name) => String(name ?? "").trim())
    .filter((name) => /^[a-z0-9][a-z0-9._~-]*$/i.test(name))
    .map((name) => ({
      name,
      url: buildNpmMaintainerUrl(name),
    }))
    .sort(compareMaintainers);
}

function compareMaintainers(left, right) {
  const leftIsPatrick = String(left.name ?? "").toLowerCase() === "patrickjs";
  const rightIsPatrick = String(right.name ?? "").toLowerCase() === "patrickjs";
  if (leftIsPatrick) {
    return rightIsPatrick ? 0 : -1;
  }
  if (rightIsPatrick) {
    return 1;
  }
  return 0;
}

function npmPackageMetadata(packageName, metadata = {}) {
  const registryMetadata = metadata ?? {};
  const scope = npmPackageScope(packageName);
  return {
    packageUrl: registryMetadata.packageUrl ?? buildNpmPackageUrl(packageName),
    scope: registryMetadata.scope ?? scope,
    scopeUrl: registryMetadata.scopeUrl ?? buildNpmScopeUrl(packageName),
    maintainers: [...(registryMetadata.maintainers ?? publicMaintainers(registryMetadata))]
      .sort(compareMaintainers),
  };
}

function dedupeHistoryEntries(entries) {
  const byVersion = new Map();
  for (const entry of entries) {
    if (!entry?.version || !isStableVersion(entry.version)) {
      continue;
    }
    const current = byVersion.get(entry.version);
    if (!current || entry.loaded || !current.loaded) {
      byVersion.set(entry.version, entry);
    }
  }
  return [...byVersion.values()].sort((left, right) => (
    compareStableVersionsDesc(left.version, right.version)
  ));
}

function mergeVersionRows(rows, localEntries) {
  const localByVersion = new Map(
    localEntries.map((entry) => [entry.version, entry]),
  );
  const merged = rows
    .map((row) => {
      const normalized = normalizeVersionRow(row);
      if (!normalized) {
        return null;
      }

      const local = localByVersion.get(normalized.version);
      return local
        ? {
            ...normalized,
            ...local,
            publishedAt: normalized.publishedAt ?? local.publishedAt,
            loaded: true,
          }
        : normalized;
    })
    .filter(Boolean);

  return merged;
}

function mergeMeasuredHistoryEntry(entries, measurement) {
  const measured = historyEntryFromMeasurement(measurement);
  if (!measured || !isStableVersion(measured.version)) {
    return entries;
  }

  const existing = entries.find((entry) => entry.version === measured.version);
  return dedupeHistoryEntries([
    ...entries.filter((entry) => entry.version !== measured.version),
    {
      ...existing,
      ...measured,
      publishedAt: existing?.publishedAt ?? measured.publishedAt,
      loaded: true,
    },
  ]);
}

async function fetchRegistryVersionRows(packageName, limit = DEFAULT_VERSION_HISTORY_LIMIT) {
  const response = await fetch(buildNpmRegistryPackageUrl(packageName), {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Version history is unavailable.");
  }

  const metadata = await response.json();
  const versions = metadata?.versions;
  if (!versions || typeof versions !== "object" || Array.isArray(versions)) {
    throw new Error("Version history is unavailable.");
  }

  const time = metadata?.time && typeof metadata.time === "object" ? metadata.time : {};
  const stableVersions = Object.keys(versions)
    .filter(isStableVersion)
    .sort(compareStableVersionsDesc);

  return {
    hasMore: stableVersions.length > limit,
    npm: npmPackageMetadata(packageName, metadata),
    versions: stableVersions
      .slice(0, limit)
      .map((version) => ({
        package: packageName,
        version,
        publishedAt: time[version] ?? null,
        loaded: false,
      })),
  };
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
  let response;
  try {
    response = await fetch(`/api/size?${params.toString()}`, {
      headers: {
        accept: "application/json",
      },
    });
  } catch {
    response = null;
  }

  const contentType = response?.headers.get("content-type") ?? "";
  if (response && contentType.includes("application/json")) {
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message ?? "Package size request failed.");
    }
    await writeBrowserMeasurement(payload.result);
    return payload.result;
  }

  const cached = await readBrowserMeasurement(query, sizeOptions);
  if (cached) {
    return cached;
  }

  const result = await measurePackageSizeInBrowser(query, sizeOptions);
  await writeBrowserMeasurement(result);
  return result;
}

async function enrichVersionHistoryWithBrowserCache(
  history,
  packageName,
  sizeOptions,
  browserEntries,
) {
  const localEntries = browserEntries ?? await readBrowserCachedPackageHistory({
    packageName,
    sizeOptions,
  });
  return {
    ...history,
    package: history.package ?? packageName,
    npm: npmPackageMetadata(packageName, history.npm),
    versions: mergeVersionRows(history.versions ?? [], localEntries),
  };
}

async function fetchPackageVersionHistory(
  query,
  sizeOptions,
  {
    browserEntries,
    cachedHistory,
    limit = DEFAULT_VERSION_HISTORY_LIMIT,
  } = {},
) {
  const parsed = parsePackageSpec(query);
  const requestedLimit = Math.min(MAX_VERSION_HISTORY, Math.max(1, limit));
  const params = buildSizeApiSearchParams(parsed.packageName, sizeOptions);
  params.set("limit", String(requestedLimit));
  let response;
  try {
    response = await fetch(`/api/versions?${params.toString()}`, {
      headers: {
        accept: "application/json",
      },
    });
  } catch {
    response = null;
  }
  const contentType = response?.headers.get("content-type") ?? "";

  if (response && contentType.includes("application/json")) {
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message ?? "Version history is unavailable.");
    }
    const history = await enrichVersionHistoryWithBrowserCache(
      payload.result,
      parsed.packageName,
      sizeOptions,
      browserEntries,
    );
    await writeBrowserVersionHistory({
      packageName: parsed.packageName,
      sizeOptions,
      limit: requestedLimit,
      history,
    });
    return history;
  }

  const cached = cachedHistory ?? await readBrowserVersionHistory({
    packageName: parsed.packageName,
    sizeOptions,
    limit: requestedLimit,
  });
  if (cached) {
    return enrichVersionHistoryWithBrowserCache(
      cached,
      parsed.packageName,
      sizeOptions,
      browserEntries,
    );
  }

  const registryHistory = {
    package: parsed.packageName,
    ...(await fetchRegistryVersionRows(parsed.packageName, requestedLimit)),
  };
  const history = await enrichVersionHistoryWithBrowserCache(
    registryHistory,
    parsed.packageName,
    sizeOptions,
    browserEntries,
  );
  await writeBrowserVersionHistory({
    packageName: parsed.packageName,
    sizeOptions,
    limit: requestedLimit,
    history,
  });
  return history;
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
            className={tabClass("dashboard")}
            href="#/dashboard"
            aria-current={currentPage === "dashboard" ? "page" : undefined}
          >
            <BarChart3 size={17} aria-hidden="true" />
            Dashboard
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

function NpmMark() {
  return (
    <span
      className="inline-grid h-[18px] w-[30px] place-items-center rounded-[3px] bg-[#cb3837] text-[11px] leading-none font-black tracking-normal text-white"
      aria-hidden="true"
    >
      npm
    </span>
  );
}

function PackageRegistryLinks({ metadata, packageName }) {
  const npm = npmPackageMetadata(packageName, metadata);
  const maintainers = npm.maintainers.slice(0, 8);

  return (
    <div className="mt-3 flex max-w-[780px] flex-wrap items-center gap-2 text-[14px] font-[650]">
      <a
        className="inline-flex h-8 items-center gap-2 rounded-[7px] border border-[#cbd4de] bg-white px-2.5 text-[#263241] no-underline hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:border-[#38444d] dark:bg-[#192734] dark:text-[#f7f9f9] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
        href={npm.packageUrl}
        rel="noreferrer"
        target="_blank"
        aria-label={`View ${packageName} on npm`}
      >
        <NpmMark />
        <span>Package</span>
      </a>
      {npm.scope && npm.scopeUrl ? (
        <a
          className="inline-flex h-8 items-center rounded-[7px] border border-[#cbd4de] bg-white px-2.5 text-[#263241] no-underline hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:border-[#38444d] dark:bg-[#192734] dark:text-[#f7f9f9] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
          href={npm.scopeUrl}
          rel="noreferrer"
          target="_blank"
          aria-label={`View @${npm.scope} scope on npm`}
        >
          @{npm.scope}
        </a>
      ) : null}
      {maintainers.length ? (
        <>
          <span className="text-[#5b6678] dark:text-[#8b98a5]">Maintainers</span>
          {maintainers.map((maintainer) => (
            <a
              className="inline-flex h-8 items-center rounded-[7px] border border-[#cbd4de] bg-white px-2.5 text-[#263241] no-underline hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:border-[#38444d] dark:bg-[#192734] dark:text-[#f7f9f9] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
              href={maintainer.url}
              key={maintainer.name}
              rel="noreferrer"
              target="_blank"
            >
              {maintainer.name}
            </a>
          ))}
        </>
      ) : null}
    </div>
  );
}

function versionSelectOptions(result, entries) {
  const byVersion = new Map();
  if (result?.version) {
    byVersion.set(result.version, {
      version: result.version,
      loaded: true,
    });
  }
  for (const entry of entries ?? []) {
    if (!entry?.version || !isStableVersion(entry.version)) {
      continue;
    }
    byVersion.set(entry.version, {
      version: entry.version,
      loaded: Boolean(entry.loaded),
    });
  }
  return [...byVersion.values()].sort((left, right) => (
    compareStableVersionsDesc(left.version, right.version)
  ));
}

function ResultHeader({
  packageMetadata,
  result,
  loading,
  onLoadLatest,
  onLoadVersion,
  onRefresh,
  versionEntries,
}) {
  const versions = versionSelectOptions(result, versionEntries);
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
        <div className="flex items-center gap-3 text-[15px] text-[#5b6678] dark:text-[#8b98a5] max-[680px]:flex-wrap max-[680px]:gap-x-3 max-[680px]:gap-y-2">
          <select
            className="h-9 min-w-28 rounded-[5px] border border-[#cbd4de] bg-white px-3 text-[17px] font-[650] text-[#111827] outline-0 focus:border-[#1d9bf0] focus:ring-2 focus:ring-[#1d9bf0]/15 disabled:opacity-70 dark:border-[#38444d] dark:bg-[#192734] dark:text-[#f7f9f9] dark:focus:border-[#1d9bf0] dark:focus:ring-[#1d9bf0]/20"
            aria-label="Version"
            value={result.version}
            disabled={loading || versions.length <= 1}
            onChange={(event) => onLoadVersion(event.target.value)}
          >
            {versions.map((entry) => (
              <option key={entry.version} value={entry.version}>
                {entry.version}
              </option>
            ))}
          </select>
          <button
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[5px] border border-[#cbd4de] bg-white px-3 text-[15px] font-bold text-[#1d9bf0] hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] disabled:cursor-wait disabled:opacity-80 dark:border-[#38444d] dark:bg-[#192734] dark:text-[#8ecdf8] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
            type="button"
            disabled={loading}
            onClick={onLoadLatest}
            aria-label={`Load latest ${result.package}`}
          >
            <RotateCcw size={15} />
            <span>Load Latest</span>
          </button>
          <span className="h-[18px] w-px bg-[#d9e0e7] dark:bg-[#38444d]" aria-hidden="true" />
          <span>{resultKind(result)}</span>
          <span className="h-[18px] w-px bg-[#d9e0e7] dark:bg-[#38444d]" aria-hidden="true" />
          <span>{result.source}</span>
        </div>
        <PackageRegistryLinks metadata={packageMetadata} packageName={result.package} />
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

function VersionSizeTrendChart({ entries }) {
  const rows = loadedTrendEntries(entries);
  const width = 720;
  const height = 240;
  const padding = {
    top: 22,
    right: 24,
    bottom: 46,
    left: 70,
  };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => sizeTrendSeries.map((series) => row[series.key])),
  );
  const xFor = (index) => (
    rows.length <= 1
      ? padding.left + innerWidth / 2
      : padding.left + (index / (rows.length - 1)) * innerWidth
  );
  const yFor = (value) => padding.top + ((maxValue - value) / maxValue) * innerHeight;
  const lineSeries = sizeTrendSeries.map((series) => ({
    ...series,
    points: rows.map((row, index) => ({
      version: row.version,
      value: row[series.key],
      x: xFor(index),
      y: yFor(row[series.key]),
    })),
  }));
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const latestSummaries = latest
    ? sizeTrendSeries.map((series) => {
        const delta = previous ? latest[series.key] - previous[series.key] : 0;
        return {
          ...series,
          delta,
          tone: trendTone(delta),
          value: latest[series.key],
        };
      })
    : [];
  const labelIndexes = new Set([
    0,
    Math.floor((rows.length - 1) / 2),
    rows.length - 1,
  ]);
  const yAxisLabels = [
    { label: formatKiB(maxValue), value: maxValue },
    { label: formatKiB(maxValue / 2), value: maxValue / 2 },
    { label: "0", value: 0 },
  ];

  return (
    <div className="mb-5 rounded-[7px] border border-[#d9e0e7] bg-white px-4 py-4 dark:border-[#38444d] dark:bg-[#192734]">
      <div className="mb-3 flex items-center justify-between gap-3 max-[680px]:flex-col max-[680px]:items-start">
        <div>
          <h3 className="m-0 text-[18px] font-extrabold text-[#111827] dark:text-[#f7f9f9]">Loaded size trend</h3>
          <p className="m-0 mt-1 text-sm font-[650] text-[#5b6678] dark:text-[#8b98a5]">
            {rows.length} loaded {rows.length === 1 ? "version" : "versions"}
          </p>
        </div>
        {latest ? (
          <div className="flex flex-wrap justify-end gap-2 max-[680px]:justify-start">
            <span className="inline-flex h-7 items-center rounded-[5px] border border-[#d9e0e7] px-2 text-sm font-bold text-[#354153] dark:border-[#38444d] dark:text-[#d6dde4]">
              {latest.version}
            </span>
            {latestSummaries.map((summary) => (
              <span
                className={`inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-[#d9e0e7] px-2 text-sm font-bold dark:border-[#38444d] ${summary.text}`}
                key={summary.key}
              >
                <i
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: summary.color }}
                  aria-hidden="true"
                />
                {summary.label} {formatKiB(summary.value)}
                {previous ? (
                  <em className={`${summary.tone.text} not-italic`}>
                    {summary.tone.label}
                  </em>
                ) : null}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-sm font-bold text-[#5b6678] dark:text-[#8b98a5]">
            Measure another version for change
          </span>
        )}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[13px] font-bold text-[#5b6678] dark:text-[#8b98a5]">
        {sizeTrendSeries.map((series) => (
          <span className="inline-flex items-center gap-2" key={series.key}>
            <i
              className="h-3 w-3 rounded-[2px]"
              style={{ backgroundColor: series.color }}
              aria-hidden="true"
            />
            {series.label}
          </span>
        ))}
      </div>
      {rows.length ? (
        <svg
          className="block h-[240px] w-full overflow-visible"
          role="img"
          aria-label="Loaded version size graph"
          viewBox={`0 0 ${width} ${height}`}
        >
          <line
            x1={padding.left}
            x2={padding.left}
            y1={padding.top}
            y2={padding.top + innerHeight}
            stroke="currentColor"
            className="text-[#d9e0e7] dark:text-[#38444d]"
          />
          <line
            x1={padding.left}
            x2={padding.left + innerWidth}
            y1={padding.top + innerHeight}
            y2={padding.top + innerHeight}
            stroke="currentColor"
            className="text-[#d9e0e7] dark:text-[#38444d]"
          />
          {yAxisLabels.map((tick) => {
            const y = yFor(tick.value);
            return (
              <g key={tick.label}>
                <line
                  x1={padding.left}
                  x2={padding.left + innerWidth}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeDasharray={tick.value === 0 ? undefined : "4 6"}
                  className="text-[#edf1f5] dark:text-[#253341]"
                />
                <text x="0" y={y + 4} className="fill-[#5b6678] text-[12px] dark:fill-[#8b98a5]">
                  {tick.label}
                </text>
              </g>
            );
          })}
          {lineSeries.map((series) => {
            const path = series.points
              .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
              .join(" ");
            return (
              <g key={series.key}>
                {series.points.length > 1 ? (
                  <path
                    d={path}
                    fill="none"
                    stroke={series.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="3.5"
                  />
                ) : null}
                {series.points.map((point) => (
                  <circle
                    key={`${series.key}-${point.version}`}
                    cx={point.x}
                    cy={point.y}
                    r="5"
                    fill={series.color}
                    stroke="white"
                    strokeWidth="2"
                    className="dark:stroke-[#192734]"
                  >
                    <title>{`${point.version} ${series.label}: ${formatKiB(point.value)}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
          {rows.map((row, index) => (
            labelIndexes.has(index) ? (
              <text
                className="fill-[#5b6678] text-[12px] font-bold dark:fill-[#8b98a5]"
                key={`${row.version}-label`}
                textAnchor={index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"}
                x={xFor(index)}
                y={height - 12}
              >
                {row.version}
              </text>
            ) : null
          ))}
        </svg>
      ) : (
        <div className="flex min-h-[150px] items-center justify-center border-y border-[#e1e7ed] font-[650] text-[#5b6678] dark:border-[#38444d] dark:text-[#8b98a5]">
          No loaded version sizes yet.
        </div>
      )}
    </div>
  );
}

function VersionHistoryPanel({ result, state, onLoadMore, onSelect, onTestVisible, testing }) {
  const entries = state.entries ?? [];
  const graphSourceEntries = state.graphEntries ?? entries;
  const isLoading = state.status === "loading";
  const isRefreshing = Boolean(state.refreshing);
  const showLoadingPanel = isLoading && !entries.length;
  const hasLoaded = state.status === "loaded" || state.status === "error";
  const canLoadMore = hasLoaded && state.hasMore;
  const [showGraph, setShowGraph] = useState(getPreferredVersionHistoryGraph);
  const graphEntries = useMemo(() => loadedTrendEntries(graphSourceEntries), [graphSourceEntries]);
  const canShowGraph = hasLoaded && graphEntries.length > 0;
  const toggleGraph = () => {
    setShowGraph((current) => {
      const next = !current;
      writeVersionHistoryGraphPreference(next);
      return next;
    });
  };

  return (
    <section className="mb-[34px] border-b border-[#d9e0e7] pb-8 dark:border-[#38444d]" aria-label="Version history">
      <div className="mb-[18px] flex items-center justify-between gap-4">
        <div>
          <h2 className="m-0 text-[23px] font-extrabold text-[#111827] dark:text-[#f7f9f9]">Version history</h2>
          {graphEntries.length ? (
            <p className="m-0 mt-1 text-sm font-[650] text-[#5b6678] dark:text-[#8b98a5]">
              {graphEntries.length} local measurements
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 max-[680px]:flex-wrap max-[680px]:justify-end">
          {entries.length ? (
            <button
              className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[7px] border border-[#cbd4de] bg-white px-3.5 text-[15px] font-bold text-[#1d9bf0] hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] disabled:cursor-wait disabled:opacity-80 dark:border-[#38444d] dark:bg-[#192734] dark:text-[#8ecdf8] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
              type="button"
              onClick={onTestVisible}
              disabled={testing}
              aria-label="Reload and test visible versions"
            >
              {testing ? <Loader2 className="animate-spin" size={18} /> : <RotateCcw size={18} />}
              <span>{testing ? "Testing" : "Reload/test"}</span>
            </button>
          ) : null}
          {canShowGraph ? (
            <button
              className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[7px] border border-[#cbd4de] bg-white px-3.5 text-[15px] font-bold text-[#1d9bf0] hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:border-[#38444d] dark:bg-[#192734] dark:text-[#8ecdf8] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
              type="button"
              onClick={toggleGraph}
              aria-pressed={showGraph}
            >
              <TrendingUp size={18} />
              <span>{showGraph ? "Hide graph" : "Show graph"}</span>
            </button>
          ) : null}
          <span className="inline-flex h-10 items-center gap-2 rounded-[7px] border border-[#cbd4de] bg-white px-3.5 text-[15px] font-bold text-[#1d9bf0] dark:border-[#38444d] dark:bg-[#192734] dark:text-[#8ecdf8]">
            {showLoadingPanel || isRefreshing ? <Loader2 className="animate-spin" size={18} /> : <History size={18} />}
            <span>{showLoadingPanel ? "Loading" : isRefreshing ? "Refreshing" : "Stable releases"}</span>
          </span>
        </div>
      </div>

      {state.status === "error" ? (
        <div
          className="mb-4 rounded-[7px] border border-[#fac9be] bg-[#fff4f1] px-3.5 py-[11px] text-[15px] font-semibold text-[#a43d28] dark:border-[#8c3d32] dark:bg-[#3a2526] dark:text-[#ffb4a8]"
          role="alert"
        >
          {state.message}
        </div>
      ) : null}

      {showLoadingPanel ? (
        <div className="flex min-h-[92px] items-center justify-center gap-2.5 border-y border-[#e1e7ed] font-[650] text-[#5b6678] dark:border-[#38444d] dark:text-[#8b98a5]">
          <Loader2 className="animate-spin" size={22} />
          <span>Loading version history</span>
        </div>
      ) : null}

      {!showLoadingPanel && showGraph && canShowGraph ? (
        <VersionSizeTrendChart entries={graphSourceEntries} />
      ) : null}

      {!showLoadingPanel && (hasLoaded || entries.length) && entries.length ? (
        <div className="overflow-x-auto max-[680px]:overflow-visible">
          <table className="w-full min-w-[820px] border-collapse max-[680px]:min-w-0">
            <thead className="max-[680px]:hidden">
              <tr>
                <th className={thClass}>Version</th>
                <th className={thClass}>Minified</th>
                <th className={thClass}>Gzip</th>
                <th className={thClass}>Brotli</th>
                <th className={thClass}>Published</th>
                <th className={thClass} aria-label="Action" />
              </tr>
            </thead>
            <tbody className="max-[680px]:grid max-[680px]:gap-3.5">
              {entries.map((entry) => {
                const packageSpec = packageSpecFromResolved(entry.package ?? result.package, entry.version);
                return (
                  <tr
                    className="max-[680px]:relative max-[680px]:grid max-[680px]:grid-cols-2 max-[680px]:gap-x-[18px] max-[680px]:gap-y-2.5 max-[680px]:border-b max-[680px]:border-[#e1e7ed] max-[680px]:pt-[13px] max-[680px]:pr-[42px] max-[680px]:pb-3.5 max-[680px]:pl-0 dark:max-[680px]:border-[#38444d]"
                    key={entry.resolvedUrl ?? packageSpec}
                  >
                    <td className={`${tdClass} max-[680px]:col-span-2`}>
                      <button
                        className="inline-flex cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 font-[750] text-[#111827] hover:text-[#0f6fb8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:text-[#f7f9f9] dark:hover:text-[#8ecdf8] dark:focus-visible:outline-[#1d9bf0]"
                        type="button"
                        onClick={() => onSelect(packageSpec, result.options)}
                        aria-label={`Load ${packageSpec} from version history`}
                      >
                        {entry.version}
                      </button>
                    </td>
                    <td className={`${tdClass} ${typeof entry.rawBytes === "number" ? toneStyles.minified.text : ""}`}>
                      <MobileLabel>Minified</MobileLabel>
                      {formatHistorySize(entry.rawBytes)}
                    </td>
                    <td className={`${tdClass} ${typeof entry.gzipBytes === "number" ? toneStyles.gzip.text : ""}`}>
                      <MobileLabel>Gzip</MobileLabel>
                      {formatHistorySize(entry.gzipBytes)}
                    </td>
                    <td className={`${tdClass} ${typeof entry.brotliBytes === "number" ? toneStyles.brotli.text : ""}`}>
                      <MobileLabel>Brotli</MobileLabel>
                      {formatHistorySize(entry.brotliBytes)}
                    </td>
                    <td className={tdClass}>
                      <MobileLabel>Published</MobileLabel>
                      {formatDate(entry.publishedAt)}
                    </td>
                    <td className={`${tdClass} max-[680px]:absolute max-[680px]:top-3 max-[680px]:right-0`}>
                      <button
                        className="inline-grid h-8 w-8 place-items-center rounded-[7px] border-0 bg-transparent text-[#657284] hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:text-[#8b98a5] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
                        type="button"
                        onClick={() => onSelect(packageSpec, result.options)}
                        aria-label={`Load ${packageSpec}`}
                        title={`Load ${packageSpec}`}
                      >
                        <Download size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {canLoadMore ? (
            <button
              className="mx-auto mt-5 flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[7px] border border-[#cbd4de] bg-white px-4 text-[15px] font-bold text-[#1d9bf0] hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] disabled:cursor-wait disabled:opacity-80 dark:border-[#38444d] dark:bg-[#192734] dark:text-[#8ecdf8] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
              type="button"
              onClick={onLoadMore}
              disabled={isLoading}
              aria-label="Load more version history"
            >
              <ChevronDown size={18} />
              <span>Load more</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {!showLoadingPanel && hasLoaded && !entries.length ? (
        <div className="flex min-h-[92px] items-center justify-center gap-2.5 border-y border-[#e1e7ed] font-[650] text-[#5b6678] dark:border-[#38444d] dark:text-[#8b98a5]">
          <History size={24} />
          <span>No local version history yet.</span>
        </div>
      ) : null}
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

function DashboardPage({
  busyIds,
  onAdd,
  onOpen,
  onRefresh,
  onRefreshAll,
  onRemove,
  setTrackingQuery,
  trackedPackages,
  trackingError,
  trackingQuery,
}) {
  const busySet = new Set(busyIds);
  const anyBusy = busyIds.length > 0;

  return (
    <section aria-label="Package dashboard">
      <div className="mb-5 flex items-start justify-between gap-4 max-[680px]:flex-col max-[680px]:items-stretch">
        <div>
          <h2 className="m-0 text-[32px] leading-[1.1] font-black text-[#0c1118] dark:text-[#f7f9f9]">
            Package dashboard
          </h2>
          <p className="m-0 mt-2 text-[15px] font-[650] text-[#5b6678] dark:text-[#8b98a5]">
            {trackedPackages.length} tracked {trackedPackages.length === 1 ? "package" : "packages"}
          </p>
        </div>
        <button
          className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[7px] border border-[#cbd4de] bg-white px-3.5 text-[15px] font-bold text-[#1d9bf0] hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] disabled:cursor-wait disabled:opacity-80 dark:border-[#38444d] dark:bg-[#192734] dark:text-[#8ecdf8] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
          type="button"
          onClick={onRefreshAll}
          disabled={!trackedPackages.length || anyBusy}
          aria-label="Refresh all tracked packages"
        >
          {anyBusy ? <Loader2 className="animate-spin" size={18} /> : <RotateCcw size={18} />}
          <span>Refresh all</span>
        </button>
      </div>

      <form
        className="mb-7 grid grid-cols-[minmax(220px,1fr)_auto] gap-3 max-[760px]:grid-cols-1"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd();
        }}
      >
        <label className="grid gap-1.5 text-sm font-bold text-[#354153] dark:text-[#d6dde4]">
          Tracked packages
          <input
            className={fieldClass}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            value={trackingQuery}
            onChange={(event) => setTrackingQuery(event.target.value)}
            placeholder="@async/framework, @async/json"
          />
        </label>
        <button
          className="mt-[22px] inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[7px] border-0 bg-linear-to-b from-[#1d9bf0] to-[#1a8cd8] px-4 text-[15px] font-bold text-white shadow-[0_10px_24px_rgba(29,155,240,0.20)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d9bf0] disabled:cursor-wait disabled:opacity-80 dark:from-[#1d9bf0] dark:to-[#1a8cd8] dark:shadow-[0_12px_28px_rgba(29,155,240,0.18)] max-[760px]:mt-0"
          type="submit"
          disabled={anyBusy}
        >
          <Plus size={18} />
          Track packages
        </button>
      </form>

      {trackingError ? (
        <div
          className="mb-4 rounded-[7px] border border-[#fac9be] bg-[#fff4f1] px-3.5 py-[11px] text-[15px] font-semibold text-[#a43d28] dark:border-[#8c3d32] dark:bg-[#3a2526] dark:text-[#ffb4a8]"
          role="alert"
        >
          {trackingError}
        </div>
      ) : null}

      {trackedPackages.length ? (
        <div className="overflow-x-auto max-[680px]:overflow-visible">
          <table className="w-full border-collapse">
            <thead className="max-[680px]:hidden">
              <tr>
                <th className={thClass}>Package</th>
                <th className={thClass}>Version</th>
                <th className={thClass}>Minified</th>
                <th className={thClass}>Gzip</th>
                <th className={thClass}>Brotli</th>
                <th className={`${thClass} max-[980px]:hidden`}>Last checked</th>
                <th className={`${thClass} w-[108px]`} aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="max-[680px]:grid max-[680px]:gap-3.5">
              {trackedPackages.map((item) => {
                const result = item.result;
                const busy = busySet.has(item.id);
                const displayName = result?.package ?? item.packageSpec;
                return (
                  <tr
                    className="max-[680px]:relative max-[680px]:grid max-[680px]:grid-cols-2 max-[680px]:gap-x-[18px] max-[680px]:gap-y-2.5 max-[680px]:border-b max-[680px]:border-[#e1e7ed] max-[680px]:pt-[13px] max-[680px]:pr-[42px] max-[680px]:pb-3.5 max-[680px]:pl-0 dark:max-[680px]:border-[#38444d]"
                    key={item.id}
                  >
                    <td className={`${tdClass} max-[680px]:col-span-2`}>
                      <button
                        className="inline-flex cursor-pointer items-center gap-3.5 border-0 bg-transparent p-0 font-[750] text-[#111827] dark:text-[#f7f9f9]"
                        type="button"
                        onClick={() => onOpen(item)}
                      >
                        <PackageIcon name={displayName} />
                        <span>{displayName}</span>
                      </button>
                      {item.error ? (
                        <p className="m-0 mt-1 text-sm font-[650] text-[#a43d28] dark:text-[#ffb4a8]">
                          {item.error}
                        </p>
                      ) : null}
                      <p className="m-0 mt-1 hidden text-sm font-[650] text-[#8b95a4] max-[980px]:block max-[680px]:hidden dark:text-[#8b98a5]">
                        {busy ? "Checking" : item.updatedAt ? `Checked ${relativeTime(item.updatedAt)}` : "Not checked"}
                      </p>
                    </td>
                    <td className={tdClass}>
                      <MobileLabel>Version</MobileLabel>
                      {busy ? "Checking" : result?.version ?? "Not checked"}
                    </td>
                    <td className={`${tdClass} ${result ? toneStyles.minified.text : ""}`}>
                      <MobileLabel>Minified</MobileLabel>
                      {result ? formatKiB(result.rawBytes) : "Not checked"}
                    </td>
                    <td className={`${tdClass} ${result ? toneStyles.gzip.text : ""}`}>
                      <MobileLabel>Gzip</MobileLabel>
                      {result ? formatKiB(result.gzipBytes) : "Not checked"}
                    </td>
                    <td className={`${tdClass} ${result ? toneStyles.brotli.text : ""}`}>
                      <MobileLabel>Brotli</MobileLabel>
                      {result ? formatKiB(result.brotliBytes) : "Not checked"}
                    </td>
                    <td className={`${tdClass} max-[980px]:hidden`}>
                      <MobileLabel>Last</MobileLabel>
                      {item.updatedAt ? relativeTime(item.updatedAt) : "Not checked"}
                    </td>
                    <td className={`${tdClass} max-[680px]:absolute max-[680px]:top-3 max-[680px]:right-0`}>
                      <div className="flex items-center gap-1.5">
                        <button
                          className="inline-grid h-8 w-8 place-items-center rounded-[7px] border-0 bg-transparent text-[#657284] hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] disabled:cursor-wait disabled:opacity-70 dark:text-[#8b98a5] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
                          type="button"
                          onClick={() => onRefresh(item)}
                          disabled={busy}
                          aria-label={`Refresh ${item.packageSpec}`}
                        >
                          {busy ? <Loader2 className="animate-spin" size={18} /> : <RotateCcw size={18} />}
                        </button>
                        <button
                          className="inline-grid h-8 w-8 place-items-center rounded-[7px] border-0 bg-transparent text-[#657284] hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:text-[#8b98a5] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
                          type="button"
                          onClick={() => onOpen(item)}
                          aria-label={`Open ${item.packageSpec} in measure`}
                        >
                          <ChevronRight size={20} />
                        </button>
                        <button
                          className="inline-grid h-8 w-8 place-items-center rounded-[7px] border-0 bg-transparent text-[#657284] hover:bg-[#f5f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:text-[#8b98a5] dark:hover:bg-[#253341] dark:focus-visible:outline-[#1d9bf0]"
                          type="button"
                          onClick={() => onRemove(item.id)}
                          aria-label={`Remove ${item.packageSpec}`}
                        >
                          <X size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex min-h-[130px] items-center justify-center gap-2.5 border-y border-[#e1e7ed] font-[650] text-[#5b6678] dark:border-[#38444d] dark:text-[#8b98a5]">
          <BarChart3 size={26} />
          <span>No tracked packages yet.</span>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [initialDashboardState] = useState(readDashboardStateFromLocation);
  const [initialTrackedPackages] = useState(() => {
    if (typeof window === "undefined") {
      return [];
    }
    return readTrackedPackages();
  });
  const [query, setQuery] = useState(initialDashboardState.query);
  const [sizeOptions, setSizeOptions] = useState(initialDashboardState.sizeOptions);
  const [result, setResult] = useState(sampleResult);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(() => pageFromLocationHash(initialTrackedPackages));
  const [theme, setTheme] = useState(getPreferredTheme);
  const [versionHistory, setVersionHistory] = useState({
    status: "idle",
    entries: [],
    graphEntries: [],
    hasMore: false,
    limit: DEFAULT_VERSION_HISTORY_LIMIT,
    loadedFor: "",
    npm: null,
    refreshing: false,
  });
  const [testingVersionHistory, setTestingVersionHistory] = useState(false);
  const [recents, setRecents] = useState(() => {
    if (typeof window === "undefined") {
      return [];
    }
    return readRecents();
  });
  const [trackedPackages, setTrackedPackages] = useState(initialTrackedPackages);
  const [trackingQuery, setTrackingQuery] = useState("@async/framework");
  const [trackingError, setTrackingError] = useState("");
  const [trackingBusyIds, setTrackingBusyIds] = useState([]);
  const didAutoMeasure = useRef(false);
  const searchRequestId = useRef(0);
  const historyRequestId = useRef(0);
  const historyTestRequestId = useRef(0);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (initialTrackedPackages.length && !window.location.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/dashboard`);
    }

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
  }, [initialTrackedPackages.length]);

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

  const updateTrackedPackages = useCallback((updater) => {
    setTrackedPackages((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      writeTrackedPackages(next);
      return next;
    });
  }, []);

  const setTrackedPackageBusy = useCallback((id, busy) => {
    setTrackingBusyIds((current) => {
      if (busy) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((item) => item !== id);
    });
  }, []);

  const refreshTrackedPackage = useCallback(async (item) => {
    const tracked = normalizeTrackedPackage(item);
    if (!tracked) {
      return null;
    }

    setTrackedPackageBusy(tracked.id, true);
    try {
      const nextResult = await fetchPackageSize(tracked.packageSpec, tracked.options);
      const checkedAt = new Date().toISOString();
      const nextTracked = {
        ...tracked,
        result: normalizeTrackedResult(nextResult),
        updatedAt: checkedAt,
        error: "",
      };
      updateTrackedPackages((current) => current.map((entry) => (
        entry.id === tracked.id ? nextTracked : entry
      )));
      return nextResult;
    } catch (nextError) {
      updateTrackedPackages((current) => current.map((entry) => (
        entry.id === tracked.id
          ? {
              ...entry,
              error: nextError.message || "Package size request failed.",
              updatedAt: new Date().toISOString(),
            }
          : entry
      )));
      return null;
    } finally {
      setTrackedPackageBusy(tracked.id, false);
    }
  }, [setTrackedPackageBusy, updateTrackedPackages]);

  const addTrackedPackage = useCallback(async (
    packageSpecs = trackingQuery,
    options = sizeOptions,
  ) => {
    const specs = splitTrackedPackageSpecs(packageSpecs);
    if (!specs.length) {
      setTrackingError("Enter one or more package names.");
      return [];
    }

    let trackedItems;
    try {
      const seen = new Set();
      trackedItems = specs
        .map((packageSpec) => trackedPackageFromSpec(packageSpec, options))
        .filter((item) => {
          if (seen.has(item.id)) {
            return false;
          }
          seen.add(item.id);
          return true;
        });
    } catch (nextError) {
      setTrackingError(nextError.message);
      return [];
    }

    setTrackingError("");
    updateTrackedPackages((current) => {
      const currentById = new Map(current.map((item) => [item.id, item]));
      const nextTrackedItems = trackedItems.map((item) => {
        const existing = currentById.get(item.id);
        return existing
          ? {
              ...item,
              result: existing.result,
              addedAt: existing.addedAt,
              updatedAt: existing.updatedAt,
            }
          : item;
      });
      return [
        ...nextTrackedItems,
        ...current.filter((item) => !nextTrackedItems.some((nextItem) => nextItem.id === item.id)),
      ].slice(0, MAX_TRACKED_PACKAGES);
    });
    setTrackingQuery("");
    await Promise.all(trackedItems.map((item) => refreshTrackedPackage(item)));
    return trackedItems;
  }, [refreshTrackedPackage, sizeOptions, trackingQuery, updateTrackedPackages]);

  const loadVersionHistoryForResult = useCallback(async (
    nextResult,
    limit = DEFAULT_VERSION_HISTORY_LIMIT,
  ) => {
    const nextLimit = Math.min(MAX_VERSION_HISTORY, Math.max(1, limit));
    const loadedFor = historyContextKey(nextResult);
    const immediateLocalEntries = dedupeHistoryEntries(localHistoryEntries(recents, nextResult));
    const requestId = historyRequestId.current + 1;
    historyRequestId.current = requestId;
    const immediateEntries = mergeVersionRows([], immediateLocalEntries);

    setVersionHistory({
      status: immediateEntries.length ? "loaded" : "loading",
      entries: immediateEntries,
      graphEntries: immediateLocalEntries,
      hasMore: false,
      limit: nextLimit,
      loadedFor,
      npm: npmPackageMetadata(nextResult.package),
      refreshing: true,
    });

    try {
      const [browserEntries, cachedHistory] = await Promise.all([
        readBrowserCachedPackageHistory({
          packageName: nextResult.package,
          sizeOptions: nextResult.options,
        }),
        readBrowserVersionHistory({
          packageName: nextResult.package,
          sizeOptions: nextResult.options,
          limit: nextLimit,
        }),
      ]);
      const localEntries = dedupeHistoryEntries([
        ...immediateLocalEntries,
        ...browserEntries,
      ]);
      if (historyRequestId.current !== requestId) {
        return;
      }
      const cachedEntries = cachedHistory
        ? mergeVersionRows(cachedHistory.versions ?? [], localEntries)
        : mergeVersionRows([], localEntries);
      if (cachedEntries.length) {
        setVersionHistory({
          status: "loaded",
          entries: cachedEntries,
          graphEntries: dedupeHistoryEntries([
            ...cachedEntries,
            ...localEntries,
          ]),
          hasMore: Boolean(cachedHistory?.hasMore),
          limit: nextLimit,
          loadedFor,
          npm: npmPackageMetadata(nextResult.package, cachedHistory?.npm),
          refreshing: true,
        });
      }
      const history = await fetchPackageVersionHistory(nextResult.package, nextResult.options, {
        browserEntries,
        cachedHistory,
        limit: nextLimit,
      });
      if (historyRequestId.current !== requestId) {
        return;
      }
      const entries = mergeVersionRows(history.versions ?? [], localEntries);
      setVersionHistory({
        status: "loaded",
        entries,
        graphEntries: dedupeHistoryEntries([
          ...entries,
          ...localEntries,
        ]),
        hasMore: Boolean(history.hasMore),
        limit: nextLimit,
        loadedFor,
        npm: npmPackageMetadata(nextResult.package, history.npm),
        refreshing: false,
      });
    } catch (nextError) {
      if (historyRequestId.current !== requestId) {
        return;
      }
      const browserEntries = await readBrowserCachedPackageHistory({
        packageName: nextResult.package,
        sizeOptions: nextResult.options,
      });
      const localEntries = dedupeHistoryEntries([
        ...immediateLocalEntries,
        ...browserEntries,
      ]);
      setVersionHistory({
        status: "error",
        entries: mergeVersionRows([], localEntries),
        graphEntries: dedupeHistoryEntries(localEntries),
        hasMore: false,
        limit: nextLimit,
        loadedFor,
        npm: npmPackageMetadata(nextResult.package),
        message: nextError.message || "Version history is unavailable.",
        refreshing: false,
      });
    }
  }, [recents]);

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
      const requestId = searchRequestId.current + 1;
      searchRequestId.current = requestId;

      try {
        const nextResult = await fetchPackageSize(trimmed, normalizedOptions);
        if (searchRequestId.current !== requestId) {
          return null;
        }
        const nextHistoryLimit = versionHistory.loadedFor === historyContextKey(nextResult)
          ? versionHistory.limit
          : DEFAULT_VERSION_HISTORY_LIMIT;
        setResult(nextResult);
        saveRecent(nextResult);
        loadVersionHistoryForResult(nextResult, nextHistoryLimit);
        if (options.history !== false) {
          writeDashboardStateToLocation(trimmed, normalizedOptions, options.history ?? "push");
        }
        return nextResult;
      } catch (nextError) {
        if (searchRequestId.current === requestId) {
          setError(nextError.message);
        }
        return null;
      } finally {
        if (searchRequestId.current === requestId) {
          setLoading(false);
        }
      }
    },
    [loadVersionHistoryForResult, query, saveRecent, sizeOptions, versionHistory.limit, versionHistory.loadedFor],
  );

  useEffect(() => {
    if (didAutoMeasure.current) {
      return;
    }
    didAutoMeasure.current = true;
    if (currentPage !== "measure") {
      return;
    }
    runSearch(initialDashboardState.query, initialDashboardState.sizeOptions, { history: "replace" });
  }, [currentPage, initialDashboardState, runSearch]);

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
  const visiblePackageMetadata = versionHistory.loadedFor === historyContextKey(visibleResult)
    ? versionHistory.npm
    : null;

  const loadMoreVersionHistory = useCallback(() => {
    loadVersionHistoryForResult(
      visibleResult,
      Math.min(MAX_VERSION_HISTORY, (versionHistory.limit ?? DEFAULT_VERSION_HISTORY_LIMIT) + VERSION_HISTORY_PAGE_SIZE),
    );
  }, [loadVersionHistoryForResult, versionHistory.limit, visibleResult]);

  const testVisibleVersionHistory = useCallback(async () => {
    if (testingVersionHistory) {
      return;
    }

    const visibleEntries = (versionHistory.entries ?? [])
      .filter((entry) => entry?.version && isStableVersion(entry.version));
    if (!visibleEntries.length) {
      return;
    }

    const unloadedEntries = visibleEntries.filter((entry) => !entry.loaded);
    const entriesToTest = unloadedEntries.length ? unloadedEntries : visibleEntries;
    const requestId = historyTestRequestId.current + 1;
    historyTestRequestId.current = requestId;
    setTestingVersionHistory(true);

    let firstFailure = "";
    try {
      for (const entry of entriesToTest) {
        if (historyTestRequestId.current !== requestId) {
          return;
        }

        const packageSpec = packageSpecFromResolved(entry.package ?? visibleResult.package, entry.version);
        try {
          const measured = await fetchPackageSize(packageSpec, visibleResult.options);
          if (historyTestRequestId.current !== requestId) {
            return;
          }
          setVersionHistory((current) => ({
            ...current,
            status: current.status === "idle" ? "loaded" : current.status,
            entries: mergeMeasuredHistoryEntry(current.entries ?? [], measured),
            graphEntries: mergeMeasuredHistoryEntry(
              current.graphEntries?.length ? current.graphEntries : current.entries ?? [],
              measured,
            ),
          }));
        } catch (nextError) {
          firstFailure ||= `Failed to test ${packageSpec}: ${nextError.message || "Package size request failed."}`;
        }
      }
    } finally {
      if (historyTestRequestId.current === requestId) {
        setTestingVersionHistory(false);
        if (firstFailure) {
          setVersionHistory((current) => ({
            ...current,
            status: "error",
            message: firstFailure,
          }));
        }
      }
    }
  }, [testingVersionHistory, versionHistory.entries, visibleResult]);

  const versionEntriesForResult = versionHistory.loadedFor === historyContextKey(visibleResult)
    ? versionHistory.entries
    : [];

  const loadResultVersion = useCallback((version) => {
    if (!version || version === visibleResult.version) {
      return;
    }
    runSearch(packageSpecFromResolved(visibleResult.package, version), visibleResult.options);
  }, [runSearch, visibleResult]);

  const loadLatestResultVersion = useCallback(() => {
    const latestStable = versionEntriesForResult
      .filter((entry) => isStableVersion(entry.version))
      .sort((left, right) => compareStableVersionsDesc(left.version, right.version))[0];
    const packageSpec = latestStable?.version
      ? packageSpecFromResolved(visibleResult.package, latestStable.version)
      : visibleResult.package;
    runSearch(packageSpec, visibleResult.options, { history: "push" });
  }, [runSearch, versionEntriesForResult, visibleResult]);

  const refreshAllTrackedPackages = useCallback(async () => {
    await Promise.all(trackedPackages.map((item) => refreshTrackedPackage(item)));
  }, [refreshTrackedPackage, trackedPackages]);

  const removeTrackedPackage = useCallback((id) => {
    updateTrackedPackages((current) => current.filter((item) => item.id !== id));
  }, [updateTrackedPackages]);

  const openTrackedPackage = useCallback((item) => {
    const tracked = normalizeTrackedPackage(item);
    if (!tracked) {
      return;
    }
    const packageSpec = tracked.result?.pinnedQuery ?? tracked.packageSpec;
    const search = buildDashboardSearchParams(packageSpec, tracked.options);
    window.history.pushState(null, "", `${window.location.pathname}?${search}#/`);
    setCurrentPage("measure");
    runSearch(packageSpec, tracked.options, { history: "replace" });
  }, [runSearch]);

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
        ) : currentPage === "dashboard" ? (
          <DashboardPage
            busyIds={trackingBusyIds}
            trackedPackages={trackedPackages}
            trackingError={trackingError}
            trackingQuery={trackingQuery}
            setTrackingQuery={setTrackingQuery}
            onAdd={addTrackedPackage}
            onRefresh={refreshTrackedPackage}
            onRefreshAll={refreshAllTrackedPackages}
            onRemove={removeTrackedPackage}
            onOpen={openTrackedPackage}
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
              packageMetadata={visiblePackageMetadata}
              loading={loading}
              versionEntries={versionEntriesForResult}
              onLoadVersion={loadResultVersion}
              onLoadLatest={loadLatestResultVersion}
              onRefresh={() => runSearch(visibleResult.query, visibleResult.options, { history: "replace" })}
            />
            <MetricsPanel result={visibleResult} />
            <VersionHistoryPanel
              result={visibleResult}
              state={versionHistory}
              onLoadMore={loadMoreVersionHistory}
              onSelect={runSearch}
              onTestVisible={testVisibleVersionHistory}
              testing={testingVersionHistory}
            />
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
