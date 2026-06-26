import {
  createSignal,
  defineApp,
} from "@async/framework/browser";
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

function pageHash(page) {
  if (page === "dashboard") {
    return "#/dashboard";
  }
  if (page === "tools") {
    return "#/tools";
  }
  return "#/";
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
  let parsed;
  try {
    parsed = parsePackageSpec(packageSpec);
    options = normalizeSizeOptions(item.options ?? {});
  } catch {
    return null;
  }

  const trackingSpec = parsed.packageName;
  const result = normalizeTrackedResult(item.result);
  return {
    id: trackedPackageId(trackingSpec, options),
    packageSpec: trackingSpec,
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
  const spec = parsed.packageName;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function icon(name, size = 18, extraClass = "") {
  const common = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const paths = {
    package: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 8 7.5 4.2L19.5 8"/><path d="M12 12.2V21"/><path d="m9 4.6 8 4.5"/>',
    gauge: '<path d="M12 14l4-5"/><path d="M3.3 15a9 9 0 1 1 17.4 0"/><path d="M5 19h14"/>',
    chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16V9"/><path d="M12 16V7"/><path d="M16 16v-4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.2-1.2"/>',
    git: '<path d="M6 3v12"/><path d="M18 9a3 3 0 1 0-3-3"/><path d="M6 15a3 3 0 1 0 3 3"/><path d="M18 9v3a6 6 0 0 1-6 6H9"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/>',
    terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    code: '<path d="m8 18-6-6 6-6"/><path d="m16 6 6 6-6 6"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    refresh: '<path d="M20 12a8 8 0 0 1-14.2 5"/><path d="M4 12a8 8 0 0 1 14.2-5"/><path d="M6 17H2v4"/><path d="M18 7h4V3"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    clipboard: '<rect x="8" y="4" width="8" height="4" rx="1"/><path d="M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/><path d="M12 7v5l3 2"/>',
    trend: '<path d="m3 17 6-6 4 4 7-8"/><path d="M14 7h6v6"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    loader: '<path d="M21 12a9 9 0 0 1-9 9"/>',
    npm: '<rect x="3" y="6" width="18" height="12" rx="1"/><path d="M7 15V9h10v6"/><path d="M12 15V9"/>',
  };
  return `<svg class="${extraClass}" ${common}>${paths[name] ?? paths.package}</svg>`;
}

function buttonClass(variant = "secondary", extra = "") {
  const base = "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[7px] px-4 text-[15px] font-bold no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d9bf0] disabled:cursor-not-allowed disabled:opacity-60";
  const variants = {
    primary: "border-0 bg-linear-to-b from-[#1d9bf0] to-[#1a8cd8] text-white shadow-[0_10px_24px_rgba(29,155,240,0.20)] dark:shadow-[0_12px_28px_rgba(29,155,240,0.18)]",
    secondary: "border border-[#cbd4de] bg-white text-[#0f6fb8] hover:bg-[#f5f8fa] dark:border-[#38444d] dark:bg-[#192734] dark:text-[#8ecdf8] dark:hover:bg-[#253341]",
    ghost: "border-0 bg-transparent text-[#5b6678] hover:bg-[#f5f8fa] dark:text-[#8b98a5] dark:hover:bg-[#253341]",
    danger: "border-0 bg-transparent text-[#8b98a5] hover:bg-[#f5f8fa] hover:text-[#b95000] dark:hover:bg-[#253341] dark:hover:text-[#ffb86b]",
  };
  return `${base} ${variants[variant] ?? variants.secondary} ${extra}`;
}

function renderBrandMark() {
  return `
    <div
      class="inline-grid h-[38px] w-[38px] flex-none place-items-center rounded-[7px] border border-[#b9e3ff] bg-[#e8f5fe] text-[#1d9bf0] dark:border-[#38444d] dark:bg-[#223949] dark:text-[#1d9bf0]"
      aria-hidden="true"
    >
      ${icon("package", 25)}
    </div>
  `;
}

function renderHeader(state) {
  const isDark = state.theme === "dark";
  const tabClass = (page) => {
    const isActive = state.currentPage === page;
    return [
      "inline-flex h-[34px] items-center gap-2 rounded-[7px] px-3 text-[15px] font-[700] no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7ae8] dark:focus-visible:outline-[#1d9bf0]",
      isActive
        ? "bg-[#e8f5fe] text-[#0f6fb8] dark:bg-[#223949] dark:text-[#8ecdf8]"
        : "text-[#354153] hover:bg-[#f5f8fa] dark:text-[#d6dde4] dark:hover:bg-[#253341]",
    ].join(" ");
  };

  const navLink = (page, label, iconName) => `
    <a
      class="${tabClass(page)}"
      href="${pageHash(page)}"
      aria-current="${state.currentPage === page ? "page" : "false"}"
      data-page="${page}"
      on:click="nav.go"
    >
      ${icon(iconName, 17)}
      ${escapeHtml(label)}
    </a>
  `;

  return `
    <header class="flex h-[66px] items-center justify-between border-b border-[#d9e0e7] bg-white/80 px-7 backdrop-blur-md dark:border-[#38444d] dark:bg-[#15202b]/88 max-[980px]:h-auto max-[980px]:min-h-[66px] max-[980px]:items-start max-[980px]:gap-4 max-[980px]:px-5 max-[980px]:py-[18px] max-[680px]:flex-col max-[680px]:items-stretch">
      <div class="flex min-w-0 items-center gap-[18px] max-[980px]:flex-wrap max-[980px]:gap-x-3.5 max-[980px]:gap-y-2.5">
        ${renderBrandMark()}
        <h1 class="m-0 text-[22px] leading-[1.1] font-[750] text-[#111827] dark:text-[#f7f9f9] max-[680px]:text-xl">
          Package Size
        </h1>
      </div>
      <nav
        class="flex items-center gap-3.5 max-[680px]:w-full max-[680px]:flex-wrap max-[680px]:items-start max-[680px]:justify-start"
        aria-label="Primary navigation"
      >
        <div class="flex items-center gap-1.5 max-[680px]:flex-wrap">
          ${navLink("measure", "Measure", "gauge")}
          ${navLink("dashboard", "Dashboard", "chart")}
          ${navLink("tools", "Tools", "link")}
        </div>
        <div class="flex items-center gap-3.5 max-[680px]:flex-wrap">
          <a
            class="${iconButtonClass}"
            href="https://github.com/PatrickJS/package-size"
            aria-label="GitHub repository"
            target="_blank"
            rel="noreferrer"
            data-no-external-marker
          >
            ${icon("git", 21)}
          </a>
          <span class="h-6 w-px bg-[#d9e0e7] dark:bg-[#38444d]" aria-hidden="true"></span>
          <button
            class="${iconButtonClass}"
            type="button"
            aria-label="${isDark ? "Switch to light theme" : "Switch to dark theme"}"
            aria-pressed="${isDark ? "true" : "false"}"
            on:click="theme.toggle"
          >
            ${isDark ? icon("moon", 22) : icon("sun", 22)}
          </button>
        </div>
      </nav>
    </header>
  `;
}

function selected(value, selectedValue) {
  return value === selectedValue ? " selected" : "";
}

function checked(condition, options) {
  return options.conditions.includes(condition) ? " checked" : "";
}

function checkbox(name, label, isChecked) {
  return `
    <label class="flex items-center gap-2 text-[15px] font-[650] text-[#354153] dark:text-[#d6dde4]">
      <input class="h-4 w-4 accent-[#1d9bf0]" type="checkbox" name="${escapeAttr(name)}"${isChecked ? " checked" : ""} />
      ${escapeHtml(label)}
    </label>
  `;
}

function currentPreviewUrl(state) {
  try {
    return buildEsmUnpkgUrl(parsePackageSpec(state.query), state.sizeOptions);
  } catch {
    return "";
  }
}

function renderToolsPage(state) {
  const previewUrl = currentPreviewUrl(state);
  return `
    <section
      class="grid grid-cols-[minmax(0,0.9fr)_minmax(380px,0.8fr)] gap-7 max-[980px]:grid-cols-1"
      aria-label="Package Size tools"
    >
      <div class="pt-2">
        <h2 class="m-0 max-w-[760px] text-[42px] leading-[1.04] font-black tracking-normal text-[#0c1118] dark:text-[#f7f9f9] max-[680px]:text-[32px]">
          Self-serve tools for exact resolver URLs.
        </h2>
        <p class="mt-5 mb-6 max-w-[760px] text-[18px] leading-[1.45] text-[#5b6678] dark:text-[#8b98a5]">
          Local commands and URL construction live here so the measure page stays focused on package search, resolved versions, and size results.
        </p>
        <div class="grid max-w-[860px] grid-cols-2 gap-3.5 max-[680px]:grid-cols-1">
          ${renderCommandBlock("terminal", "Local JSON", "node bin/package-size.js json react")}
          ${renderCommandBlock("code", "Dev dashboard", "pnpm run dev")}
        </div>
        <div class="mt-5 flex items-center gap-2.5 text-[15px] font-[650] text-[#354153] dark:text-[#d6dde4]">
          ${icon("database", 18)}
          <span>Resolved versions are pinned in recents so later runs use the stable URL UNPKG selected.</span>
        </div>
      </div>
      <aside class="rounded-[7px] border border-[#cbd4de] bg-white shadow-[0_8px_22px_rgba(15,23,42,0.05)] dark:border-[#38444d] dark:bg-[#192734] dark:shadow-none">
        <details class="shareable-details" open>
          <summary class="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-5 py-4 text-[15px] font-bold text-[#1d9bf0] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#1d9bf0] dark:text-[#8ecdf8]">
            <span class="flex items-center gap-2.5">
              ${icon("link", 18)}
              <span>Shareable resolver URL</span>
            </span>
            ${icon("chevronDown", 19, "shareable-chevron transition-transform")}
          </summary>
          <div class="px-5 pb-5">
            <h3 class="m-0 text-[22px] font-extrabold text-[#111827] dark:text-[#f7f9f9]">Build a UNPKG variant</h3>
            <p class="m-0 mt-2 text-[15px] leading-[1.4] text-[#5b6678] dark:text-[#8b98a5]">
              Open the builder to set package, subpath, target, export conditions, metadata, and bundle flags. Resolving updates the dashboard URL with the package and UNPKG query parameters.
            </p>
            <code class="mt-4 block max-h-[88px] overflow-auto wrap-anywhere rounded-[7px] border border-[#e1e7ed] bg-[#f7fafc] px-3 py-2.5 text-[13px] leading-[1.35] text-[#111827] dark:border-[#38444d] dark:bg-[#15202b] dark:text-[#f7f9f9]">
              ${escapeHtml(previewUrl || "Enter a valid package spec to preview the URL.")}
            </code>
            <button
              class="${buttonClass("primary", "mt-4 h-11 w-full text-[16px]")}"
              type="button"
              popovertarget="${URL_BUILDER_POPOVER_ID}"
            >
              ${icon("link", 18)}
              URL builder
            </button>
          </div>
        </details>
      </aside>
    </section>
  `;
}

function renderCommandBlock(iconName, title, command) {
  return `
    <div class="rounded-[7px] border border-[#d9e0e7] bg-white px-3.5 py-3 dark:border-[#38444d] dark:bg-[#192734]">
      <div class="mb-2 flex items-center gap-2 text-sm font-bold text-[#5b6678] dark:text-[#8b98a5]">
        ${icon(iconName, 18)}
        <span>${escapeHtml(title)}</span>
      </div>
      <code class="block wrap-anywhere text-[15px] leading-[1.35] font-bold text-[#111827] dark:text-[#f7f9f9]">
        ${escapeHtml(command)}
      </code>
    </div>
  `;
}

function renderUrlBuilderPopover(state) {
  const options = state.sizeOptions;
  const previewUrl = currentPreviewUrl(state);
  return `
    <div
      id="${URL_BUILDER_POPOVER_ID}"
      popover
      class="url-builder-popover rounded-[7px] border border-[#cbd4de] bg-white p-0 shadow-[0_18px_44px_rgba(15,23,42,0.20)] dark:border-[#38444d] dark:bg-[#192734]"
    >
      <form class="grid gap-5 p-5" aria-label="URL builder" on:submit="builder.resolve">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="m-0 text-[24px] font-black text-[#111827] dark:text-[#f7f9f9]">Shareable resolver URL</h2>
            <p class="m-0 mt-1 text-[15px] text-[#5b6678] dark:text-[#8b98a5]">Configure the browser-resolved ESM artifact request.</p>
          </div>
          <button class="${iconButtonClass}" type="button" popovertarget="${URL_BUILDER_POPOVER_ID}" popovertargetaction="hide" aria-label="Close URL builder">
            ${icon("x", 22)}
          </button>
        </div>
        <label class="grid gap-2 text-[15px] font-bold text-[#354153] dark:text-[#d6dde4]">
          Package spec
          <input class="${fieldClass}" name="query" value="${escapeAttr(state.query)}" />
        </label>
        <label class="grid gap-2 text-[15px] font-bold text-[#354153] dark:text-[#d6dde4]">
          Subpath
          <input class="${fieldClass}" name="subpath" value="${escapeAttr(options.subpath)}" placeholder="/jsx/runtime" />
        </label>
        <div class="grid grid-cols-2 gap-3 max-[680px]:grid-cols-1">
          <label class="grid gap-2 text-[15px] font-bold text-[#354153] dark:text-[#d6dde4]">
            Target
            <select class="${fieldClass}" name="target">
              ${["es2022", "es2020", "es2019", "es2017"].map((target) => (
                `<option value="${target}"${selected(target, options.target)}>${target}</option>`
              )).join("")}
            </select>
          </label>
          <label class="grid gap-2 text-[15px] font-bold text-[#354153] dark:text-[#d6dde4]">
            Bundle mode
            <select class="${fieldClass}" name="bundle">
              ${["default", "standalone"].map((bundle) => (
                `<option value="${bundle}"${selected(bundle, options.bundle)}>${bundle}</option>`
              )).join("")}
            </select>
          </label>
        </div>
        <fieldset class="grid gap-3 rounded-[7px] border border-[#e1e7ed] p-3 dark:border-[#38444d]">
          <legend class="px-1 text-[15px] font-bold text-[#354153] dark:text-[#d6dde4]">Export conditions</legend>
          <div class="grid grid-cols-3 gap-3 max-[680px]:grid-cols-1">
            ${conditionOptions.map((condition) => `
              <label class="flex items-center gap-2 text-[15px] font-[650] text-[#354153] dark:text-[#d6dde4]">
                <input class="h-4 w-4 accent-[#1d9bf0]" type="checkbox" name="conditions" value="${condition}"${checked(condition, options)} />
                ${escapeHtml(condition)}
              </label>
            `).join("")}
          </div>
        </fieldset>
        <div class="grid grid-cols-2 gap-3 max-[680px]:grid-cols-1">
          ${checkbox("development", "Development", options.env === "development")}
          ${checkbox("meta", "Metadata", options.meta)}
          ${checkbox("min", "Minified CDN variant", options.min)}
          ${checkbox("sourcemap", "Sourcemap", options.sourcemap)}
        </div>
        <code class="block max-h-[92px] overflow-auto wrap-anywhere rounded-[7px] border border-[#e1e7ed] bg-[#f7fafc] px-3 py-2.5 text-[13px] leading-[1.35] text-[#111827] dark:border-[#38444d] dark:bg-[#15202b] dark:text-[#f7f9f9]">
          ${escapeHtml(previewUrl || "Enter a valid package spec to preview the URL.")}
        </code>
        ${state.error ? `<p class="m-0 rounded-[7px] border border-[#ffd7c2] bg-[#fff4ed] px-3 py-2 text-sm font-bold text-[#b95000] dark:border-[#6b321d] dark:bg-[#2c1c16] dark:text-[#ffb86b]">${escapeHtml(state.error)}</p>` : ""}
        <button class="${buttonClass("primary", "h-11 text-[16px]")}" type="submit">
          ${state.loading ? icon("loader", 18, "animate-spin") : icon("search", 18)}
          Resolve package
        </button>
      </form>
    </div>
  `;
}

function renderSearchForm(state) {
  return `
    <form class="mb-7 grid gap-4" on:submit="search.submit" aria-label="Package search">
      <label class="relative block">
        <span class="sr-only">Package name</span>
        <span class="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-[#8b98a5]">
          ${icon("search", 25)}
        </span>
        <input
          class="h-[62px] w-full rounded-[7px] border-2 border-[#1d9bf0] bg-white px-16 text-[22px] font-[520] text-[#111827] shadow-[0_0_0_1px_rgba(29,155,240,0.08)] outline-0 transition-colors placeholder:text-[#8b98a5] focus:ring-3 focus:ring-[#1d9bf0]/20 dark:bg-[#15202b] dark:text-[#f7f9f9]"
          name="query"
          aria-label="Package name"
          value="${escapeAttr(state.query)}"
          autocomplete="off"
          spellcheck="false"
        />
        <button class="absolute top-1/2 right-4 -translate-y-1/2 text-[#8b98a5] hover:text-[#354153] dark:hover:text-[#f7f9f9]" type="reset" aria-label="Clear package name">
          ${icon("x", 24)}
        </button>
      </label>
      <button
        class="${buttonClass("primary", "h-[58px] text-[22px]")}"
        type="submit"
        ${state.loading ? "disabled" : ""}
      >
        ${state.loading ? icon("loader", 22, "animate-spin") : ""}
        Search
      </button>
    </form>
  `;
}

function renderPackageIcon(name) {
  return `
    <span class="inline-grid h-9 w-9 flex-none place-items-center rounded-[7px] border border-[#cbd4de] bg-[#e8f5fe] text-[13px] font-black text-[#1d5f90] dark:border-[#38444d] dark:bg-[#223949] dark:text-[#c7e9ff]" aria-hidden="true">
      ${escapeHtml(packageInitial(name))}
    </span>
  `;
}

function resultKind(result) {
  if (result?.options?.meta || /json/i.test(result?.contentType ?? "")) {
    return "Resolved metadata";
  }
  return "Resolved browser artifact";
}

function renderNpmMark() {
  return '<span class="inline-flex h-[18px] min-w-[34px] items-center justify-center rounded-[3px] bg-[#cb3837] px-1.5 text-[11px] leading-none font-black tracking-normal text-white" aria-hidden="true">npm</span>';
}

function renderPackageRegistryLinks(metadata, packageName) {
  if (!packageName) {
    return "";
  }
  const npm = npmPackageMetadata(packageName, metadata);
  const maintainerLinks = npm.maintainers.map((maintainer) => `
    <a
      class="${buttonClass("secondary", "h-9 px-3")}"
      href="${escapeAttr(maintainer.url)}"
      target="_blank"
      rel="noreferrer"
    >
      ${escapeHtml(maintainer.name)}
    </a>
  `).join("");

  return `
    <div class="mt-4 flex flex-wrap items-center gap-2.5">
      <a
        class="${buttonClass("secondary", "h-9 px-3")}"
        href="${escapeAttr(npm.packageUrl)}"
        target="_blank"
        rel="noreferrer"
        aria-label="View ${escapeAttr(packageName)} on npm"
      >
        ${renderNpmMark()}
        Package
      </a>
      ${npm.scope ? `
        <a
          class="${buttonClass("secondary", "h-9 px-3")}"
          href="${escapeAttr(npm.scopeUrl)}"
          target="_blank"
          rel="noreferrer"
          aria-label="View @${escapeAttr(npm.scope)} scope on npm"
        >
          @${escapeHtml(npm.scope)}
        </a>
      ` : ""}
      ${maintainerLinks ? `
        <span class="text-[15px] font-bold text-[#8b98a5]">Maintainers</span>
        ${maintainerLinks}
      ` : ""}
    </div>
  `;
}

function versionSelectOptions(result, entries) {
  if (!result?.version) {
    return [];
  }
  return dedupeHistoryEntries([
    {
      package: result.package,
      version: result.version,
      loaded: true,
    },
    ...entries,
  ]);
}

function renderResultHeader(state) {
  const { result, history } = state;
  const options = versionSelectOptions(result, history.entries);
  const selectedVersion = result.version;
  return `
    <div>
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="m-0 text-[36px] leading-[1.05] font-black tracking-normal text-[#111827] dark:text-[#f7f9f9] max-[680px]:text-[30px]">
          ${escapeHtml(result.package)}
        </h2>
        <span class="h-6 w-6 rounded-full bg-[#1d9bf0]" aria-hidden="true"></span>
      </div>
      <p class="mt-2 mb-0 wrap-anywhere text-[17px] leading-[1.35] text-[#5b6678] dark:text-[#8b98a5]">
        ${escapeHtml(result.resolvedUrl.replace("https://", ""))}
      </p>
      <div class="mt-5 flex flex-wrap items-center gap-3 text-[17px] text-[#8b98a5]">
        <label class="sr-only" for="version-select">Version</label>
        <select
          id="version-select"
          class="h-10 min-w-[130px] rounded-[7px] border border-[#cbd4de] bg-white px-3 text-[17px] font-[650] text-[#354153] outline-0 focus:border-[#1d9bf0] focus:ring-2 focus:ring-[#1d9bf0]/15 dark:border-[#38444d] dark:bg-[#192734] dark:text-[#f7f9f9]"
          aria-label="Version"
          on:change="version.select"
        >
          ${options.map((entry) => `<option value="${escapeAttr(entry.version)}"${selected(entry.version, selectedVersion)}>${escapeHtml(entry.version)}</option>`).join("")}
        </select>
        <span class="h-6 w-px bg-[#d9e0e7] dark:bg-[#38444d]" aria-hidden="true"></span>
        <span>${escapeHtml(resultKind(result))}</span>
        <span class="h-6 w-px bg-[#d9e0e7] dark:bg-[#38444d]" aria-hidden="true"></span>
        <span>${escapeHtml(result.source)}</span>
        <button
          class="${buttonClass("secondary", "h-9 px-3")}"
          type="button"
          data-package="${escapeAttr(result.package)}"
          on:click="version.latest"
          aria-label="Load latest ${escapeAttr(result.package)}"
        >
          ${icon("refresh", 17)}
          Load latest
        </button>
      </div>
      ${renderPackageRegistryLinks(history.npm, result.package)}
    </div>
  `;
}

function renderMetric(title, value, bytes, tone, footnote = "") {
  const note = footnote ? `<span class="mt-3 inline-flex rounded-[6px] px-2.5 py-1 text-[15px] font-black ${tone.note ?? ""}">${escapeHtml(footnote)}</span>` : "";
  return `
    <div class="border-r border-[#d9e0e7] pr-8 last:border-r-0 dark:border-[#38444d] max-[780px]:border-r-0 max-[780px]:border-b max-[780px]:pb-5 max-[780px]:last:border-b-0">
      <div class="flex items-center gap-2 text-[19px] text-[#5b6678] dark:text-[#8b98a5]">
        <span>${escapeHtml(title)}</span>
        <span class="inline-grid h-5 w-5 place-items-center rounded-full border border-current text-[12px]" title="Measured byte count">i</span>
      </div>
      <div class="mt-5 text-[32px] leading-none font-black tracking-normal ${tone.text}">
        ${escapeHtml(value)}
      </div>
      <div class="mt-3 text-[17px] text-[#5b6678] dark:text-[#8b98a5]">${escapeHtml(bytes)}</div>
      ${note}
    </div>
  `;
}

function renderCompressionChart(result) {
  const max = Math.max(result.rawBytes, result.gzipBytes, result.brotliBytes, 1);
  const rows = [
    ["Minified", result.rawBytes, toneStyles.minified.bar],
    ["Gzip", result.gzipBytes, toneStyles.gzip.bar],
    ["Brotli", result.brotliBytes, toneStyles.brotli.bar],
  ];
  return `
    <div class="mt-8" aria-label="Compression size comparison">
      <div class="mb-5 flex justify-center gap-8 text-[15px] text-[#5b6678] dark:text-[#8b98a5]">
        ${rows.map(([label,, bar]) => `
          <span class="inline-flex items-center gap-2">
            <span class="h-3.5 w-3.5 rounded-[3px] ${bar}"></span>
            ${escapeHtml(label)}
          </span>
        `).join("")}
      </div>
      <div class="grid gap-3">
        ${rows.map(([label, bytes, bar]) => {
          const width = Math.max(2, (bytes / max) * 100);
          return `
            <div class="grid grid-cols-[110px_minmax(0,1fr)_150px] items-center gap-4 max-[680px]:grid-cols-1 max-[680px]:gap-1">
              <div class="text-[17px] font-[650] text-[#111827] dark:text-[#f7f9f9]">${escapeHtml(label)}</div>
              <div class="h-[24px] overflow-hidden rounded-[3px] border border-[#d9e0e7] bg-[#f7fafc] dark:border-[#38444d] dark:bg-[#15202b]">
                <div class="h-full rounded-[3px] ${bar}" style="width: ${width}%"></div>
              </div>
              <div class="text-[16px] text-[#5b6678] dark:text-[#8b98a5]">${escapeHtml(formatBytes(bytes))}</div>
            </div>
          `;
        }).join("")}
      </div>
      <div class="mt-2 grid grid-cols-[110px_minmax(0,1fr)_150px] gap-4 text-[15px] text-[#8b98a5] max-[680px]:hidden">
        <span></span>
        <div class="flex justify-between border-t border-[#cbd4de] pt-2 dark:border-[#38444d]">
          <span>0</span>
          <span>${escapeHtml(formatKiB(max / 2))}</span>
          <span>${escapeHtml(formatKiB(max))}</span>
        </div>
        <span></span>
      </div>
    </div>
  `;
}

function renderMetricsPanel(result) {
  return `
    <div class="mt-8">
      <div class="grid grid-cols-3 gap-8 max-[780px]:grid-cols-1 max-[780px]:gap-5">
        ${renderMetric("Minified", formatKiB(result.rawBytes), formatBytes(result.rawBytes), toneStyles.minified)}
        ${renderMetric("Gzip", formatKiB(result.gzipBytes), formatBytes(result.gzipBytes), toneStyles.gzip, smallerBy(result.rawBytes, result.gzipBytes))}
        ${renderMetric("Brotli", formatKiB(result.brotliBytes), formatBytes(result.brotliBytes), toneStyles.brotli, smallerBy(result.rawBytes, result.brotliBytes))}
      </div>
      ${renderCompressionChart(result)}
    </div>
  `;
}

function renderVersionSizeTrendChart(entries) {
  const loadedEntries = loadedTrendEntries(entries);
  if (loadedEntries.length < 2) {
    return "";
  }

  const width = 820;
  const height = 260;
  const padding = { top: 24, right: 30, bottom: 42, left: 70 };
  const values = loadedEntries.flatMap((entry) => sizeTrendSeries.map((series) => entry[series.key]));
  const max = Math.max(...values, 1);
  const min = 0;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const xFor = (index) => padding.left + (loadedEntries.length === 1 ? innerWidth : (innerWidth * index) / (loadedEntries.length - 1));
  const yFor = (value) => padding.top + innerHeight - ((value - min) / Math.max(1, max - min)) * innerHeight;
  const gridValues = [0, max / 2, max];

  return `
    <div class="mt-5 rounded-[7px] border border-[#cbd4de] bg-white p-4 dark:border-[#38444d] dark:bg-[#192734]">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="m-0 text-[19px] font-black text-[#111827] dark:text-[#f7f9f9]">Loaded size trend</h3>
          <p class="m-0 mt-1 text-sm text-[#5b6678] dark:text-[#8b98a5]">Stable versions measured locally or in this session.</p>
        </div>
        <div class="flex flex-wrap gap-3 text-sm font-bold text-[#5b6678] dark:text-[#8b98a5]">
          ${sizeTrendSeries.map((series) => `
            <span class="inline-flex items-center gap-2">
              <span class="h-2.5 w-5 rounded-full" style="background:${series.color}"></span>
              ${escapeHtml(series.label)}
            </span>
          `).join("")}
        </div>
      </div>
      <svg class="h-auto w-full overflow-visible" viewBox="0 0 ${width} ${height}" role="img" aria-label="Loaded version size graph">
        ${gridValues.map((value) => {
          const y = yFor(value);
          return `
            <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="currentColor" class="text-[#e1e7ed] dark:text-[#38444d]" stroke-width="1"></line>
            <text x="${padding.left - 12}" y="${y + 4}" text-anchor="end" class="fill-[#8b98a5] text-[12px]">${escapeHtml(formatKiB(value))}</text>
          `;
        }).join("")}
        ${sizeTrendSeries.map((series) => {
          const points = loadedEntries.map((entry, index) => `${xFor(index)},${yFor(entry[series.key])}`).join(" ");
          return `
            <polyline points="${points}" fill="none" stroke="${series.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
            ${loadedEntries.map((entry, index) => `
              <circle cx="${xFor(index)}" cy="${yFor(entry[series.key])}" r="4" fill="${series.color}"></circle>
            `).join("")}
          `;
        }).join("")}
        ${loadedEntries.map((entry, index) => `
          <text x="${xFor(index)}" y="${height - 12}" text-anchor="middle" class="fill-[#5b6678] text-[12px] dark:fill-[#8b98a5]">${escapeHtml(entry.version)}</text>
        `).join("")}
      </svg>
    </div>
  `;
}

function renderVersionHistoryPanel(state) {
  const { result, history } = state;
  if (!result?.package) {
    return "";
  }

  const loadedEntries = loadedTrendEntries(history.entries);
  const previousByVersion = new Map();
  for (let index = 0; index < loadedEntries.length; index += 1) {
    previousByVersion.set(loadedEntries[index].version, loadedEntries[index - 1]);
  }

  const rows = history.entries.map((entry) => {
    const previous = previousByVersion.get(entry.version);
    const delta = entry.loaded && previous ? entry.rawBytes - previous.rawBytes : null;
    const tone = typeof delta === "number" ? trendTone(delta) : null;
    const packageSpec = `${result.package}@${entry.version}`;
    return `
      <tr class="max-[680px]:grid max-[680px]:grid-cols-2 max-[680px]:gap-x-4 max-[680px]:gap-y-2 max-[680px]:border-b max-[680px]:border-[#e1e7ed] max-[680px]:py-4 dark:max-[680px]:border-[#38444d]">
        <td class="${tdClass}">
          <span class="${mobileLabelClass}">Version</span>
          <button class="text-left text-[15px] font-black text-[#111827] underline-offset-4 hover:underline dark:text-[#f7f9f9]" type="button" data-version="${escapeAttr(entry.version)}" on:click="history.select" aria-label="Load ${escapeAttr(packageSpec)} from version history">
            ${escapeHtml(entry.version)}
          </button>
        </td>
        <td class="${tdClass}">
          <span class="${mobileLabelClass}">Published</span>
          ${escapeHtml(formatDate(entry.publishedAt))}
        </td>
        <td class="${tdClass}">
          <span class="${mobileLabelClass}">Minified</span>
          ${escapeHtml(formatHistorySize(entry.rawBytes))}
        </td>
        <td class="${tdClass}">
          <span class="${mobileLabelClass}">Gzip</span>
          ${escapeHtml(formatHistorySize(entry.gzipBytes))}
        </td>
        <td class="${tdClass}">
          <span class="${mobileLabelClass}">Brotli</span>
          ${escapeHtml(formatHistorySize(entry.brotliBytes))}
        </td>
        <td class="${tdClass}">
          <span class="${mobileLabelClass}">Diff</span>
          ${tone ? `<span class="${tone.text}">${escapeHtml(tone.label)}</span>` : "Not loaded"}
        </td>
        <td class="${tdClass}">
          <button class="${buttonClass("secondary", "h-9 px-3")}" type="button" data-version="${escapeAttr(entry.version)}" on:click="history.select" aria-label="Load ${escapeAttr(packageSpec)} from version history">
            ${entry.loaded ? icon("check", 16) : icon("download", 16)}
            Load
          </button>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <section class="mt-10 border-t border-[#d9e0e7] pt-8 dark:border-[#38444d]" aria-label="Version history">
      <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="m-0 text-[26px] font-black text-[#111827] dark:text-[#f7f9f9]">Version history</h2>
          <p class="m-0 mt-1 text-[16px] font-bold text-[#5b6678] dark:text-[#8b98a5]">
            ${escapeHtml(String(loadedEntries.length))} local measurements ${history.refreshing ? "<span class=\"ml-2 text-[#1d9bf0]\">Refreshing</span>" : ""}
          </p>
        </div>
        <div class="flex flex-wrap gap-2.5">
          <button class="${buttonClass("secondary")}" type="button" on:click="history.testVisible" aria-label="Reload and test visible versions" ${history.testing ? "disabled" : ""}>
            ${history.testing ? icon("loader", 18, "animate-spin") : icon("refresh", 18)}
            Reload/test
          </button>
          <button class="${buttonClass("secondary")}" type="button" on:click="history.toggleGraph" aria-pressed="${state.showHistoryGraph ? "true" : "false"}">
            ${icon("trend", 18)}
            ${state.showHistoryGraph ? "Hide graph" : "Show graph"}
          </button>
          <button class="${buttonClass("secondary")}" type="button" on:click="history.refresh">
            ${icon("history", 18)}
            Stable releases
          </button>
        </div>
      </div>
      ${state.showHistoryGraph ? renderVersionSizeTrendChart(history.entries) : ""}
      ${history.error ? renderErrorMessage(history.error) : ""}
      <div class="overflow-hidden rounded-[7px] border border-[#cbd4de] bg-white dark:border-[#38444d] dark:bg-[#192734]">
        <table class="w-full border-collapse max-[680px]:block">
          <thead class="max-[680px]:hidden">
            <tr>
              <th class="${thClass}">Version</th>
              <th class="${thClass}">Published</th>
              <th class="${thClass}">Minified</th>
              <th class="${thClass}">Gzip</th>
              <th class="${thClass}">Brotli</th>
              <th class="${thClass}">Diff</th>
              <th class="${thClass}">Action</th>
            </tr>
          </thead>
          <tbody class="max-[680px]:block">
            ${rows || `<tr><td class="${tdClass}" colspan="7">No stable versions loaded yet.</td></tr>`}
          </tbody>
        </table>
      </div>
      ${history.hasMore ? `
        <button class="${buttonClass("secondary", "mt-4 w-full")}" type="button" on:click="history.loadMore" aria-label="Load more version history">
          ${icon("plus", 18)}
          Load more
        </button>
      ` : ""}
    </section>
  `;
}

function renderErrorMessage(message) {
  if (!message) {
    return "";
  }
  return `
    <div class="mb-5 rounded-[7px] border border-[#ffd7c2] bg-[#fff4ed] px-4 py-3 text-[15px] font-bold text-[#b95000] dark:border-[#6b321d] dark:bg-[#2c1c16] dark:text-[#ffb86b]" role="alert">
      ${escapeHtml(message)}
    </div>
  `;
}

function renderResultSection(state) {
  if (state.loading && !state.result) {
    return `
      <section class="rounded-[7px] border border-[#cbd4de] bg-white p-6 dark:border-[#38444d] dark:bg-[#192734]" aria-label="Package result">
        <div class="flex items-center gap-3 text-[17px] font-bold text-[#5b6678] dark:text-[#8b98a5]">
          ${icon("loader", 22, "animate-spin")}
          Loading package size
        </div>
      </section>
    `;
  }
  if (!state.result) {
    return "";
  }
  const cacheText = state.result.cacheHit ? "Cache hit" : "Measured";
  const measuredAt = state.result.measuredAt ? relativeTime(state.result.measuredAt) : "now";
  return `
    <section class="mb-10" aria-label="Package result">
      ${renderResultHeader(state)}
      <div class="mt-8 flex items-center gap-3 text-[15px] font-[650] text-[#354153] dark:text-[#d6dde4]">
        <span class="h-2.5 w-2.5 rounded-full ${state.result.cacheHit ? "bg-[#00ba7c]" : "bg-[#1d9bf0]"}" aria-hidden="true"></span>
        <span>${cacheText}</span>
        <span>${escapeHtml(measuredAt)}</span>
        <button class="${iconButtonClass}" type="button" on:click="search.reload" aria-label="Reload current package">
          ${state.loading ? icon("loader", 18, "animate-spin") : icon("refresh", 18)}
        </button>
      </div>
      ${state.result.warnings?.length ? `
        <ul class="mt-4 rounded-[7px] border border-[#ffd7c2] bg-[#fff4ed] px-4 py-3 text-[15px] font-bold text-[#b95000] dark:border-[#6b321d] dark:bg-[#2c1c16] dark:text-[#ffb86b]">
          ${state.result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}
        </ul>
      ` : ""}
      ${renderMetricsPanel(state.result)}
      ${renderVersionHistoryPanel(state)}
    </section>
  `;
}

function renderRecentsTable(recents) {
  if (recents.length === 0) {
    return "";
  }
  return `
    <section class="mt-10" aria-label="Recently searched packages">
      <div class="mb-4 flex items-center justify-between gap-4">
        <h2 class="m-0 text-[24px] font-black text-[#111827] dark:text-[#f7f9f9]">Recent searches</h2>
        <button class="${buttonClass("ghost", "h-9 px-3")}" type="button" on:click="recent.clear">Clear</button>
      </div>
      <div class="overflow-hidden rounded-[7px] border border-[#cbd4de] bg-white dark:border-[#38444d] dark:bg-[#192734]">
        <table class="w-full border-collapse max-[680px]:block">
          <thead class="max-[680px]:hidden">
            <tr>
              <th class="${thClass}">Package</th>
              <th class="${thClass}">Version</th>
              <th class="${thClass}">Minified</th>
              <th class="${thClass}">Gzip</th>
              <th class="${thClass}">Brotli</th>
              <th class="${thClass}">Action</th>
            </tr>
          </thead>
          <tbody class="max-[680px]:block">
            ${recents.map((recent) => `
              <tr class="max-[680px]:grid max-[680px]:grid-cols-2 max-[680px]:gap-x-4 max-[680px]:gap-y-2 max-[680px]:border-b max-[680px]:border-[#e1e7ed] max-[680px]:py-4 dark:max-[680px]:border-[#38444d]">
                <td class="${tdClass}">
                  <span class="${mobileLabelClass}">Package</span>
                  <div class="flex items-center gap-3">
                    ${renderPackageIcon(recent.package)}
                    <span class="font-black text-[#111827] dark:text-[#f7f9f9]">${escapeHtml(recent.package)}</span>
                  </div>
                </td>
                <td class="${tdClass}"><span class="${mobileLabelClass}">Version</span>${escapeHtml(recent.version)}</td>
                <td class="${tdClass}"><span class="${mobileLabelClass}">Minified</span>${escapeHtml(formatKiB(recent.rawBytes))}</td>
                <td class="${tdClass}"><span class="${mobileLabelClass}">Gzip</span>${escapeHtml(formatKiB(recent.gzipBytes))}</td>
                <td class="${tdClass}"><span class="${mobileLabelClass}">Brotli</span>${escapeHtml(formatKiB(recent.brotliBytes))}</td>
                <td class="${tdClass}">
                  <button class="${buttonClass("secondary", "h-9 px-3")}" type="button" data-query="${escapeAttr(recent.pinnedQuery)}" on:click="recent.search" aria-label="Search ${escapeAttr(recent.pinnedQuery)}">
                    ${icon("search", 16)}
                    Search
                  </button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderMeasurePage(state) {
  return `
    <section aria-label="Measure package">
      ${renderSearchForm(state)}
      ${renderErrorMessage(state.error)}
      ${renderResultSection(state)}
      ${renderRecentsTable(state.recents)}
    </section>
  `;
}

function trackedGraphRows(trackedPackages) {
  return trackedPackages
    .filter((item) => (
      item.result &&
      typeof item.result.rawBytes === "number" &&
      typeof item.result.gzipBytes === "number" &&
      typeof item.result.brotliBytes === "number"
    ))
    .map((item) => ({
      packageName: item.packageSpec,
      version: item.result.version,
      rawBytes: item.result.rawBytes,
      gzipBytes: item.result.gzipBytes,
      brotliBytes: item.result.brotliBytes,
    }));
}

function compactPackageLabel(packageName) {
  if (packageName.startsWith("@")) {
    return packageName.split("/")[1] ?? packageName;
  }
  return packageName;
}

function renderTrackedPackagesGraph(trackedPackages) {
  const rows = trackedGraphRows(trackedPackages);
  if (rows.length === 0) {
    return "";
  }

  const width = 840;
  const height = 320;
  const padding = { top: 26, right: 24, bottom: 74, left: 76 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const max = Math.max(...rows.flatMap((row) => sizeTrendSeries.map((series) => row[series.key])), 1);
  const groupWidth = innerWidth / rows.length;
  const barWidth = Math.min(26, Math.max(10, (groupWidth - 18) / sizeTrendSeries.length));
  const yFor = (value) => padding.top + innerHeight - (value / max) * innerHeight;

  return `
    <div class="mb-7 rounded-[7px] border border-[#cbd4de] bg-white p-4 dark:border-[#38444d] dark:bg-[#192734]">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="m-0 text-[22px] font-black text-[#111827] dark:text-[#f7f9f9]">Tracked size graph</h2>
          <p class="m-0 mt-1 text-sm text-[#5b6678] dark:text-[#8b98a5]">Latest measured sizes for tracked packages.</p>
        </div>
        <div class="flex flex-wrap gap-3 text-sm font-bold text-[#5b6678] dark:text-[#8b98a5]">
          ${sizeTrendSeries.map((series) => `
            <span class="inline-flex items-center gap-2">
              <span class="h-2.5 w-5 rounded-full" style="background:${series.color}"></span>
              ${escapeHtml(series.label)}
            </span>
          `).join("")}
        </div>
      </div>
      <svg class="h-auto w-full overflow-visible" viewBox="0 0 ${width} ${height}" role="img" aria-label="Tracked package size graph">
        ${[0, max / 2, max].map((value) => {
          const y = yFor(value);
          return `
            <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="currentColor" class="text-[#e1e7ed] dark:text-[#38444d]" stroke-width="1"></line>
            <text x="${padding.left - 12}" y="${y + 4}" text-anchor="end" class="fill-[#8b98a5] text-[12px]">${escapeHtml(formatKiB(value))}</text>
          `;
        }).join("")}
        ${rows.map((row, rowIndex) => {
          const groupX = padding.left + rowIndex * groupWidth + groupWidth / 2;
          return `
            ${sizeTrendSeries.map((series, seriesIndex) => {
              const value = row[series.key];
              const x = groupX - (barWidth * sizeTrendSeries.length) / 2 + seriesIndex * barWidth;
              const y = yFor(value);
              return `<rect x="${x}" y="${y}" width="${barWidth - 3}" height="${padding.top + innerHeight - y}" rx="4" fill="${series.color}"></rect>`;
            }).join("")}
            <text x="${groupX}" y="${height - 38}" text-anchor="middle" class="fill-[#5b6678] text-[12px] font-bold dark:fill-[#8b98a5]">${escapeHtml(compactPackageLabel(row.packageName))}</text>
            <text x="${groupX}" y="${height - 20}" text-anchor="middle" class="fill-[#8b98a5] text-[11px]">${escapeHtml(row.version)}</text>
          `;
        }).join("")}
      </svg>
    </div>
  `;
}

function renderDashboardPage(state) {
  const rows = state.trackedPackages.map((item) => {
    const result = item.result;
    return `
      <tr class="max-[680px]:grid max-[680px]:grid-cols-2 max-[680px]:gap-x-4 max-[680px]:gap-y-2 max-[680px]:border-b max-[680px]:border-[#e1e7ed] max-[680px]:py-4 dark:max-[680px]:border-[#38444d]">
        <td class="${tdClass}">
          <span class="${mobileLabelClass}">Package</span>
          <div class="flex items-center gap-3">
            ${renderPackageIcon(item.packageSpec)}
            <span class="font-black text-[#111827] dark:text-[#f7f9f9]">${escapeHtml(item.packageSpec)}</span>
          </div>
        </td>
        <td class="${tdClass}"><span class="${mobileLabelClass}">Version</span>${escapeHtml(result?.version ?? "Not loaded")}</td>
        <td class="${tdClass}"><span class="${mobileLabelClass}">Minified</span><span class="${toneStyles.minified.text}">${result ? escapeHtml(formatKiB(result.rawBytes)) : "Not loaded"}</span></td>
        <td class="${tdClass}"><span class="${mobileLabelClass}">Gzip</span>${result ? escapeHtml(formatKiB(result.gzipBytes)) : "Not loaded"}</td>
        <td class="${tdClass}"><span class="${mobileLabelClass}">Brotli</span><span class="${toneStyles.brotli.text}">${result ? escapeHtml(formatKiB(result.brotliBytes)) : "Not loaded"}</span></td>
        <td class="${tdClass}">
          <div class="flex items-center gap-1.5">
            <button class="${iconButtonClass}" type="button" data-id="${escapeAttr(item.id)}" on:click="tracking.refreshOne" aria-label="Refresh latest ${escapeAttr(item.packageSpec)}">
              ${state.trackingRefreshing.includes(item.id) ? icon("loader", 18, "animate-spin") : icon("refresh", 18)}
            </button>
            <button class="${iconButtonClass}" type="button" data-id="${escapeAttr(item.id)}" on:click="tracking.open" aria-label="Open ${escapeAttr(item.packageSpec)} in measure">
              ${icon("chevronRight", 20)}
            </button>
            <button class="${iconButtonClass}" type="button" data-id="${escapeAttr(item.id)}" on:click="tracking.remove" aria-label="Remove ${escapeAttr(item.packageSpec)}">
              ${icon("x", 19)}
            </button>
          </div>
          ${item.error ? `<div class="mt-2 text-sm font-bold text-[#b95000] dark:text-[#ffb86b]">${escapeHtml(item.error)}</div>` : ""}
        </td>
      </tr>
    `;
  }).join("");

  return `
    <section aria-label="Package dashboard">
      <div class="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="m-0 text-[42px] leading-[1.04] font-black tracking-normal text-[#0c1118] dark:text-[#f7f9f9] max-[680px]:text-[32px]">
            Package dashboard
          </h2>
          <p class="m-0 mt-3 text-[17px] font-bold text-[#5b6678] dark:text-[#8b98a5]">
            ${escapeHtml(String(state.trackedPackages.length))} tracked packages
          </p>
        </div>
        <button class="${buttonClass("secondary")}" type="button" on:click="tracking.refreshAll" aria-label="Refresh latest for all tracked packages">
          ${state.trackingAll ? icon("loader", 18, "animate-spin") : icon("refresh", 18)}
          Refresh latest
        </button>
      </div>
      <form class="mb-7 grid grid-cols-[minmax(0,1fr)_auto] gap-3 max-[780px]:grid-cols-1" on:submit="tracking.add">
        <label class="grid gap-2 text-[15px] font-bold text-[#354153] dark:text-[#d6dde4]">
          Tracked packages
          <input class="${fieldClass}" name="packages" aria-label="Tracked packages" value="${escapeAttr(state.trackingInput)}" placeholder="@async/framework, @async/json" />
        </label>
        <button class="${buttonClass("primary", "mt-[26px] h-10 max-[780px]:mt-0")}" type="submit">
          ${icon("plus", 18)}
          Track packages
        </button>
      </form>
      ${state.trackingError ? renderErrorMessage(state.trackingError) : ""}
      ${renderTrackedPackagesGraph(state.trackedPackages)}
      ${rows ? `
        <div class="overflow-hidden rounded-[7px] border border-[#cbd4de] bg-white dark:border-[#38444d] dark:bg-[#192734]">
          <table class="w-full border-collapse max-[680px]:block">
            <thead class="max-[680px]:hidden">
              <tr>
                <th class="${thClass}">Package</th>
                <th class="${thClass}">Version</th>
                <th class="${thClass}">Minified</th>
                <th class="${thClass}">Gzip</th>
                <th class="${thClass}">Brotli</th>
                <th class="${thClass}">Actions</th>
              </tr>
            </thead>
            <tbody class="max-[680px]:block">
              ${rows}
            </tbody>
          </table>
        </div>
      ` : `
        <div class="rounded-[7px] border border-[#cbd4de] bg-white px-4 py-4 text-[16px] font-[650] text-[#5b6678] dark:border-[#38444d] dark:bg-[#192734] dark:text-[#8b98a5]">
          Track one or more packages to build a dashboard.
        </div>
      `}
    </section>
  `;
}

function renderMain(state) {
  if (state.currentPage === "dashboard") {
    return renderDashboardPage(state);
  }
  if (state.currentPage === "tools") {
    return renderToolsPage(state);
  }
  return renderMeasurePage(state);
}

function renderShell(state) {
  return `
    <div async:container>
      ${renderHeader(state)}
      <main class="mx-auto w-full max-w-[1080px] px-7 pt-8 pb-14 max-[680px]:px-5">
        ${renderMain(state)}
      </main>
      ${renderUrlBuilderPopover(state)}
    </div>
  `;
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "";
  window.localStorage.setItem(THEME_KEY, theme);
}

function readBuilderOptions(form) {
  const formData = new FormData(form);
  const conditions = formData.getAll("conditions").map(String);
  return normalizeSizeOptions({
    subpath: String(formData.get("subpath") ?? ""),
    target: String(formData.get("target") ?? DEFAULT_SIZE_OPTIONS.target),
    conditions: conditions.length ? conditions : ["browser"],
    env: formData.has("development") ? "development" : "production",
    bundle: String(formData.get("bundle") ?? "default"),
    min: formData.has("min"),
    sourcemap: formData.has("sourcemap"),
    meta: formData.has("meta"),
  });
}

function initialHistoryState() {
  return {
    contextKey: "",
    entries: [],
    hasMore: false,
    npm: null,
    limit: DEFAULT_VERSION_HISTORY_LIMIT,
    refreshing: false,
    testing: false,
    error: "",
  };
}

function initialState() {
  const dashboardState = readDashboardStateFromLocation();
  const trackedPackages = readTrackedPackages();
  const currentPage = pageFromLocationHash(trackedPackages);
  if (typeof window !== "undefined" && !window.location.hash && trackedPackages.length > 0) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/dashboard`);
  }
  return {
    currentPage,
    theme: getPreferredTheme(),
    query: dashboardState.query,
    sizeOptions: dashboardState.sizeOptions,
    result: null,
    loading: false,
    error: "",
    recents: readRecents(),
    history: initialHistoryState(),
    showHistoryGraph: getPreferredVersionHistoryGraph(),
    trackedPackages,
    trackingInput: trackedPackages[0]?.packageSpec ?? "",
    trackingError: "",
    trackingRefreshing: [],
    trackingAll: false,
  };
}

export function mountApp({ root = document.getElementById("root"), autoLoad = true } = {}) {
  if (!root) {
    throw new Error("Package Size root element was not found.");
  }

  const app = defineApp();
  const stateSignal = createSignal(initialState());
  let runtime;
  let destroyed = false;
  let renderQueued = false;
  let loadVersion = 0;

  function getState() {
    return stateSignal.value;
  }

  function setState(updater) {
    if (destroyed) {
      return;
    }
    const current = getState();
    const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
    stateSignal.set(next);
  }

  function patchState(patch) {
    setState((current) => ({ ...current, ...patch }));
  }

  function patchHistory(patch) {
    setState((current) => ({
      ...current,
      history: {
        ...current.history,
        ...patch,
      },
    }));
  }

  function render() {
    if (destroyed || renderQueued) {
      return;
    }
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      if (destroyed) {
        return;
      }
      const state = getState();
      applyTheme(state.theme);
      root.innerHTML = renderShell(state);
      runtime?.loader?.scan?.(root);
    });
  }

  async function loadPackage({ query, sizeOptions, locationMode = "push", historyLimit = DEFAULT_VERSION_HISTORY_LIMIT } = {}) {
    const requestedQuery = String(query ?? getState().query ?? DEFAULT_QUERY).trim() || DEFAULT_QUERY;
    const requestedOptions = normalizeSizeOptions(sizeOptions ?? getState().sizeOptions);
    const version = ++loadVersion;
    patchState({
      query: requestedQuery,
      sizeOptions: requestedOptions,
      loading: true,
      error: "",
    });
    writeDashboardStateToLocation(requestedQuery, requestedOptions, locationMode);

    try {
      const result = await fetchPackageSize(requestedQuery, requestedOptions);
      if (version !== loadVersion || destroyed) {
        return null;
      }

      const normalizedRecent = normalizeResultForRecent(result);
      const nextRecents = [
        normalizedRecent,
        ...getState().recents.filter((recent) => recent.resolvedUrl !== normalizedRecent.resolvedUrl),
      ].slice(0, MAX_RECENTS);
      writeRecents(nextRecents);

      setState((current) => ({
        ...current,
        query: result.query ?? requestedQuery,
        sizeOptions: normalizeSizeOptions(result.options ?? requestedOptions),
        result,
        loading: false,
        error: "",
        recents: nextRecents,
        history: {
          ...initialHistoryState(),
          contextKey: historyContextKey(result),
          limit: historyLimit,
          entries: dedupeHistoryEntries(localHistoryEntries(nextRecents, result)),
          refreshing: true,
        },
      }));

      loadVersionHistory({ result, recents: nextRecents, limit: historyLimit });
      return result;
    } catch (error) {
      if (version !== loadVersion || destroyed) {
        return null;
      }
      patchState({
        loading: false,
        error: error instanceof Error ? error.message : "Package size request failed.",
      });
      return null;
    }
  }

  async function loadVersionHistory({ result = getState().result, recents = getState().recents, limit = getState().history.limit } = {}) {
    if (!result?.package) {
      return null;
    }
    const contextKey = historyContextKey(result);
    const requestedLimit = Math.min(MAX_VERSION_HISTORY, Math.max(1, limit));
    const localEntries = localHistoryEntries(recents, result);

    patchHistory({
      contextKey,
      limit: requestedLimit,
      entries: dedupeHistoryEntries([
        ...getState().history.entries,
        ...localEntries,
      ]),
      refreshing: true,
      error: "",
    });

    const packageName = result.package;
    const sizeOptions = normalizeSizeOptions(result.options ?? getState().sizeOptions);
    const cachedHistory = await readBrowserVersionHistory({
      packageName,
      sizeOptions,
      limit: requestedLimit,
    }).catch(() => null);
    const browserEntries = await readBrowserCachedPackageHistory({
      packageName,
      sizeOptions,
    }).catch(() => []);

    if (cachedHistory && contextKey === getState().history.contextKey) {
      const optimistic = await enrichVersionHistoryWithBrowserCache(
        cachedHistory,
        packageName,
        sizeOptions,
        browserEntries,
      );
      patchHistory({
        npm: optimistic.npm,
        hasMore: optimistic.hasMore,
        entries: dedupeHistoryEntries([
          ...mergeVersionRows(optimistic.versions ?? [], localEntries),
          ...localEntries,
        ]),
        refreshing: true,
      });
    }

    try {
      const history = await fetchPackageVersionHistory(result.package, sizeOptions, {
        browserEntries,
        cachedHistory,
        limit: requestedLimit,
      });
      if (contextKey !== getState().history.contextKey || destroyed) {
        return null;
      }
      patchHistory({
        npm: history.npm,
        hasMore: history.hasMore,
        entries: dedupeHistoryEntries([
          ...mergeVersionRows(history.versions ?? [], localEntries),
          ...localEntries,
        ]),
        refreshing: false,
        error: "",
      });
      return history;
    } catch (error) {
      if (contextKey !== getState().history.contextKey || destroyed) {
        return null;
      }
      patchHistory({
        refreshing: false,
        error: error instanceof Error ? error.message : "Version history is unavailable.",
      });
      return null;
    }
  }

  async function loadHistoryVersion(version) {
    const result = getState().result;
    if (!result?.package || !version) {
      return null;
    }
    return loadPackage({
      query: `${result.package}@${version}`,
      sizeOptions: result.options ?? getState().sizeOptions,
      historyLimit: getState().history.limit,
    });
  }

  async function testVisibleHistoryVersions() {
    const state = getState();
    const result = state.result;
    if (!result?.package || state.history.testing) {
      return;
    }

    patchHistory({ testing: true, error: "" });
    const entries = state.history.entries.slice(0, state.history.limit);
    let nextEntries = state.history.entries;
    for (const entry of entries) {
      if (entry.loaded) {
        continue;
      }
      try {
        const measurement = await fetchPackageSize(`${result.package}@${entry.version}`, result.options ?? state.sizeOptions);
        nextEntries = mergeMeasuredHistoryEntry(nextEntries, measurement);
        patchHistory({ entries: nextEntries });
      } catch (error) {
        patchHistory({
          error: error instanceof Error ? error.message : "Version test failed.",
        });
      }
    }
    patchHistory({ testing: false });
  }

  async function refreshTrackedPackage(id) {
    const item = getState().trackedPackages.find((candidate) => candidate.id === id);
    if (!item) {
      return null;
    }
    setState((current) => ({
      ...current,
      trackingRefreshing: [...new Set([...current.trackingRefreshing, id])],
    }));
    try {
      const result = await fetchPackageSize(item.packageSpec, item.options);
      const normalized = normalizeTrackedResult(result);
      setState((current) => {
        const nextPackages = current.trackedPackages.map((candidate) => (
          candidate.id === id
            ? {
                ...candidate,
                result: normalized,
                updatedAt: normalized?.measuredAt ?? new Date().toISOString(),
                error: "",
              }
            : candidate
        ));
        writeTrackedPackages(nextPackages);
        return {
          ...current,
          trackedPackages: nextPackages,
          trackingRefreshing: current.trackingRefreshing.filter((trackedId) => trackedId !== id),
        };
      });
      return normalized;
    } catch (error) {
      setState((current) => {
        const nextPackages = current.trackedPackages.map((candidate) => (
          candidate.id === id
            ? {
                ...candidate,
                error: error instanceof Error ? error.message : "Package size request failed.",
              }
            : candidate
        ));
        writeTrackedPackages(nextPackages);
        return {
          ...current,
          trackedPackages: nextPackages,
          trackingRefreshing: current.trackingRefreshing.filter((trackedId) => trackedId !== id),
        };
      });
      return null;
    }
  }

  async function addTrackedPackages(value) {
    const specs = splitTrackedPackageSpecs(value);
    if (specs.length === 0) {
      patchState({ trackingError: "Enter at least one package to track." });
      return;
    }

    const currentPackages = getState().trackedPackages;
    const addedPackages = [];
    const idsToRefresh = [];
    try {
      for (const spec of specs) {
        const next = trackedPackageFromSpec(spec, getState().sizeOptions);
        const existing = currentPackages.find((item) => item.id === next.id);
        addedPackages.push(existing ? { ...next, ...existing, error: "" } : next);
        idsToRefresh.push(next.id);
      }
    } catch (error) {
      patchState({
        trackingError: error instanceof Error ? error.message : "Package spec must be an npm package name.",
      });
      return;
    }

    const addedIds = new Set(addedPackages.map((item) => item.id));
    const nextPackages = [
      ...addedPackages,
      ...currentPackages.filter((item) => !addedIds.has(item.id)),
    ].slice(0, MAX_TRACKED_PACKAGES);
    writeTrackedPackages(nextPackages);
    patchState({
      trackedPackages: nextPackages,
      trackingInput: specs.join(", "),
      trackingError: "",
    });
    await Promise.all(idsToRefresh.map((id) => refreshTrackedPackage(id)));
  }

  function goToPage(page) {
    const nextPage = page === "dashboard" || page === "tools" ? page : "measure";
    if (window.location.hash !== pageHash(nextPage)) {
      window.location.hash = pageHash(nextPage);
    }
    patchState({ currentPage: nextPage });
  }

  app.use({
    signal: {
      appState: stateSignal,
    },
    handler: {
      "nav.go"({ event, element }) {
        event?.preventDefault();
        goToPage(element?.dataset.page);
      },
      "theme.toggle"() {
        const nextTheme = getState().theme === "dark" ? "light" : "dark";
        patchState({ theme: nextTheme });
      },
      "search.submit"({ event }) {
        event?.preventDefault();
        const form = event?.target;
        const formData = new FormData(form);
        loadPackage({
          query: formData.get("query"),
          sizeOptions: getState().sizeOptions,
        });
      },
      "search.reload"() {
        const state = getState();
        loadPackage({
          query: state.result?.query ?? state.query,
          sizeOptions: state.result?.options ?? state.sizeOptions,
          locationMode: "replace",
          historyLimit: state.history.limit,
        });
      },
      "builder.resolve"({ event }) {
        event?.preventDefault();
        const form = event?.target;
        const formData = new FormData(form);
        try {
          const query = String(formData.get("query") ?? "").trim() || DEFAULT_QUERY;
          const sizeOptions = readBuilderOptions(form);
          loadPackage({ query, sizeOptions });
          goToPage("measure");
        } catch (error) {
          patchState({
            error: error instanceof Error ? error.message : "Package spec must be an npm package name.",
          });
        }
      },
      "recent.search"({ element }) {
        const query = element?.dataset.query;
        if (query) {
          loadPackage({ query, sizeOptions: getState().sizeOptions });
        }
      },
      "recent.clear"() {
        writeRecents([]);
        patchState({ recents: [] });
      },
      "version.select"({ element }) {
        loadHistoryVersion(element?.value);
      },
      "version.latest"({ element }) {
        const packageName = element?.dataset.package ?? getState().result?.package;
        if (packageName) {
          loadPackage({
            query: packageName,
            sizeOptions: getState().result?.options ?? getState().sizeOptions,
            historyLimit: getState().history.limit,
          });
        }
      },
      "history.select"({ element }) {
        loadHistoryVersion(element?.dataset.version);
      },
      "history.toggleGraph"() {
        const next = !getState().showHistoryGraph;
        writeVersionHistoryGraphPreference(next);
        patchState({ showHistoryGraph: next });
      },
      "history.refresh"() {
        loadVersionHistory({ limit: getState().history.limit });
      },
      "history.loadMore"() {
        loadVersionHistory({
          limit: Math.min(MAX_VERSION_HISTORY, getState().history.limit + VERSION_HISTORY_PAGE_SIZE),
        });
      },
      "history.testVisible"() {
        testVisibleHistoryVersions();
      },
      "tracking.add"({ event }) {
        event?.preventDefault();
        const formData = new FormData(event?.target);
        addTrackedPackages(formData.get("packages"));
      },
      "tracking.refreshOne"({ element }) {
        refreshTrackedPackage(element?.dataset.id);
      },
      async "tracking.refreshAll"() {
        patchState({ trackingAll: true });
        try {
          const ids = getState().trackedPackages.map((item) => item.id);
          await Promise.all(ids.map((id) => refreshTrackedPackage(id)));
        } finally {
          patchState({ trackingAll: false });
        }
      },
      "tracking.open"({ element }) {
        const item = getState().trackedPackages.find((candidate) => candidate.id === element?.dataset.id);
        if (item) {
          goToPage("measure");
          loadPackage({
            query: item.result?.pinnedQuery ?? item.packageSpec,
            sizeOptions: item.options,
          });
        }
      },
      "tracking.remove"({ element }) {
        const id = element?.dataset.id;
        setState((current) => {
          const nextPackages = current.trackedPackages.filter((item) => item.id !== id);
          writeTrackedPackages(nextPackages);
          return {
            ...current,
            trackedPackages: nextPackages,
          };
        });
      },
    },
  });

  const unsubscribe = stateSignal.subscribe(render);
  root.innerHTML = renderShell(getState());
  runtime = app.start({ root });
  applyTheme(getState().theme);
  runtime.loader?.scan?.(root);

  const onHashChange = () => {
    patchState({ currentPage: pageFromLocationHash(getState().trackedPackages) });
  };
  window.addEventListener("hashchange", onHashChange);

  if (autoLoad) {
    loadPackage({
      query: getState().query,
      sizeOptions: getState().sizeOptions,
      locationMode: "replace",
    });
  }

  return {
    app,
    runtime,
    state: stateSignal,
    destroy() {
      destroyed = true;
      unsubscribe();
      window.removeEventListener("hashchange", onHashChange);
      runtime?.destroy?.();
      root.innerHTML = "";
    },
    loadPackage,
    loadVersionHistory,
    addTrackedPackages,
    refreshTrackedPackage,
  };
}

export default mountApp;
