import {
  buildEsmUnpkgUrl,
  compareStableVersionsDesc,
  isExactVersion,
  isStableVersion,
  normalizeSizeOptions,
  parsePackageSpec,
  sizeOptionsSignature,
} from "./package-url.js";

const DB_NAME = "package-size";
const DB_VERSION = 2;
const MEASUREMENTS_STORE = "measurements";
const VERSION_HISTORY_STORE = "versionHistory";
const MEASUREMENT_STORAGE_PREFIX = "package-size.browser-cache.v1:";
const VERSION_HISTORY_STORAGE_PREFIX = "package-size.version-history.v1:";

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openCacheDb() {
  const indexedDb = globalThis.indexedDB;
  if (!indexedDb) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEASUREMENTS_STORE)) {
        db.createObjectStore(MEASUREMENTS_STORE, { keyPath: "resolvedUrl" });
      }
      if (!db.objectStoreNames.contains(VERSION_HISTORY_STORE)) {
        db.createObjectStore(VERSION_HISTORY_STORE, { keyPath: "cacheKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, callback) {
  const db = await openCacheDb();
  if (!db) {
    return null;
  }

  try {
    const transaction = db.transaction(storeName, mode);
    const result = await callback(transaction.objectStore(storeName));
    db.close();
    return result;
  } catch {
    db.close();
    return null;
  }
}

function readLocalStorage(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocalStorage(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Browser-side cache writes are best effort.
  }
}

function localStorageEntries(prefix) {
  const storage = globalThis.localStorage;
  if (!storage) {
    return [];
  }

  const entries = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) {
        continue;
      }
      const raw = storage.getItem(key);
      if (raw) {
        entries.push(JSON.parse(raw));
      }
    }
  } catch {
    return [];
  }
  return entries;
}

function measurementStorageKey(resolvedUrl) {
  return `${MEASUREMENT_STORAGE_PREFIX}${resolvedUrl}`;
}

function versionHistoryCacheKey({ packageName, sizeOptions = {}, limit }) {
  return [
    packageName,
    sizeOptionsSignature(sizeOptions),
    String(limit),
  ].join("|");
}

function versionHistoryStorageKey(cacheKey) {
  return `${VERSION_HISTORY_STORAGE_PREFIX}${cacheKey}`;
}

function resultFromMeasurementEntry(entry, { parsed, requestUrl, sizeOptions }) {
  return {
    ...entry.result,
    query: parsed.query,
    requestUrl,
    options: sizeOptions,
    subpath: sizeOptions.subpath || undefined,
    cacheHit: true,
  };
}

function historyEntryFromMeasurementEntry(entry) {
  const result = entry?.result;
  if (
    !result ||
    !result.package ||
    !result.version ||
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
    package: result.package,
    version: result.version,
    requestUrl: result.requestUrl ?? result.resolvedUrl ?? entry.resolvedUrl,
    resolvedUrl: result.resolvedUrl ?? entry.resolvedUrl,
    rawBytes: result.rawBytes,
    gzipBytes: result.gzipBytes,
    brotliBytes: result.brotliBytes,
    measuredAt: result.measuredAt,
    cachedAt: entry.cachedAt,
    options,
    loaded: true,
  };
}

function sortHistoryEntries(left, right) {
  const versionOrder = compareStableVersionsDesc(left.version, right.version);
  if (versionOrder !== 0) {
    return versionOrder;
  }

  const rightTime = Date.parse(right.cachedAt ?? right.measuredAt ?? "") || 0;
  const leftTime = Date.parse(left.cachedAt ?? left.measuredAt ?? "") || 0;
  return rightTime - leftTime;
}

function stableVersionRows(rows) {
  return rows
    .filter((row) => row?.version && isStableVersion(row.version))
    .map((row) => ({ ...row }));
}

function normalizeVersionHistoryEntry(entry) {
  const history = entry?.history;
  if (!history || !Array.isArray(history.versions)) {
    return null;
  }

  return {
    package: history.package ?? entry.packageName,
    hasMore: Boolean(history.hasMore),
    npm: history.npm ?? null,
    versions: stableVersionRows(history.versions),
  };
}

export async function readBrowserMeasurementEntry(resolvedUrl) {
  if (!resolvedUrl) {
    return null;
  }

  try {
    const entry = await withStore(MEASUREMENTS_STORE, "readonly", (store) => (
      requestAsPromise(store.get(resolvedUrl))
    ));
    if (entry) {
      return entry;
    }
  } catch {
    // Fall back to localStorage below.
  }

  try {
    const raw = readLocalStorage(measurementStorageKey(resolvedUrl));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function writeBrowserMeasurementEntry(entry) {
  if (!entry?.resolvedUrl) {
    return null;
  }

  try {
    const stored = await withStore(MEASUREMENTS_STORE, "readwrite", (store) => (
      requestAsPromise(store.put(entry))
    ));
    if (stored !== null) {
      return entry;
    }
  } catch {
    // Fall back to localStorage below.
  }

  writeLocalStorage(measurementStorageKey(entry.resolvedUrl), JSON.stringify(entry));
  return entry;
}

export async function readBrowserMeasurement(input, options = {}) {
  let parsed;
  let sizeOptions;
  try {
    parsed = parsePackageSpec(input);
    sizeOptions = normalizeSizeOptions(options);
  } catch {
    return null;
  }

  if (!isExactVersion(parsed.version)) {
    return null;
  }

  const requestUrl = buildEsmUnpkgUrl(parsed, sizeOptions);
  const cached = await readBrowserMeasurementEntry(requestUrl);
  return cached
    ? resultFromMeasurementEntry(cached, { parsed, requestUrl, sizeOptions })
    : null;
}

export async function writeBrowserMeasurement(
  result,
  { headers = {}, cachedAt = new Date().toISOString() } = {},
) {
  if (!result?.resolvedUrl) {
    return null;
  }

  return writeBrowserMeasurementEntry({
    schemaVersion: 1,
    cachedAt,
    resolvedUrl: result.resolvedUrl,
    headers,
    result: {
      ...result,
      cacheHit: false,
    },
  });
}

export async function readBrowserCachedPackageHistory({
  packageName,
  sizeOptions = {},
} = {}) {
  if (!packageName) {
    return [];
  }

  const targetSignature = sizeOptionsSignature(sizeOptions);
  let entries = [];

  try {
    entries = await withStore(MEASUREMENTS_STORE, "readonly", (store) => (
      requestAsPromise(store.getAll())
    )) ?? [];
  } catch {
    entries = [];
  }

  if (!entries.length) {
    entries = localStorageEntries(MEASUREMENT_STORAGE_PREFIX);
  }

  const byVersion = new Map();
  for (const entry of entries) {
    const historyEntry = historyEntryFromMeasurementEntry(entry);
    if (
      !historyEntry ||
      historyEntry.package !== packageName ||
      !isStableVersion(historyEntry.version) ||
      sizeOptionsSignature(historyEntry.options) !== targetSignature
    ) {
      continue;
    }
    const current = byVersion.get(historyEntry.version);
    if (!current || sortHistoryEntries(historyEntry, current) < 0) {
      byVersion.set(historyEntry.version, historyEntry);
    }
  }

  return [...byVersion.values()].sort(sortHistoryEntries);
}

export async function readBrowserVersionHistory({
  packageName,
  sizeOptions = {},
  limit,
} = {}) {
  if (!packageName || !limit) {
    return null;
  }

  const cacheKey = versionHistoryCacheKey({ packageName, sizeOptions, limit });

  try {
    const entry = await withStore(VERSION_HISTORY_STORE, "readonly", (store) => (
      requestAsPromise(store.get(cacheKey))
    ));
    const history = normalizeVersionHistoryEntry(entry);
    if (history) {
      return history;
    }
  } catch {
    // Fall back to localStorage below.
  }

  try {
    const raw = readLocalStorage(versionHistoryStorageKey(cacheKey));
    return raw ? normalizeVersionHistoryEntry(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function writeBrowserVersionHistory({
  packageName,
  sizeOptions = {},
  limit,
  history,
} = {}) {
  if (!packageName || !limit || !history) {
    return null;
  }

  const cacheKey = versionHistoryCacheKey({ packageName, sizeOptions, limit });
  const entry = {
    schemaVersion: 1,
    cacheKey,
    packageName,
    optionsKey: sizeOptionsSignature(sizeOptions),
    limit,
    cachedAt: new Date().toISOString(),
    history: {
      ...history,
      package: history.package ?? packageName,
      versions: stableVersionRows(history.versions ?? []),
    },
  };

  try {
    const stored = await withStore(VERSION_HISTORY_STORE, "readwrite", (store) => (
      requestAsPromise(store.put(entry))
    ));
    if (stored !== null) {
      return entry;
    }
  } catch {
    // Fall back to localStorage below.
  }

  writeLocalStorage(versionHistoryStorageKey(cacheKey), JSON.stringify(entry));
  return entry;
}
