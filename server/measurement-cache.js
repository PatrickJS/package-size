import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readJsonState,
  withJsonStateWrite,
  writeJsonState,
} from "@async/json";
import {
  compareStableVersionsDesc,
  isStableVersion,
  normalizeSizeOptions,
  sizeOptionsSignature,
} from "../src/package-url.js";

const CACHE_SCHEMA_VERSION = 1;
const CACHE_FILE_NAME = "measurements.json";

function defaultCacheRoot() {
  if (process.env.PACKAGE_SIZE_CACHE_DIR) {
    return process.env.PACKAGE_SIZE_CACHE_DIR;
  }

  if (process.env.XDG_CACHE_HOME) {
    return path.join(process.env.XDG_CACHE_HOME, "package-size");
  }

  return path.join(os.homedir(), ".cache", "package-size");
}

export function defaultMeasurementCacheFile() {
  return path.join(defaultCacheRoot(), CACHE_FILE_NAME);
}

function emptyCache() {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    entries: {},
  };
}

function normalizeCacheState(state) {
  if (
    !state ||
    state.schemaVersion !== CACHE_SCHEMA_VERSION ||
    typeof state.entries !== "object" ||
    state.entries === null ||
    Array.isArray(state.entries)
  ) {
    return emptyCache();
  }

  return state;
}

function historyEntryFromCacheEntry(entry) {
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

async function ensureCacheDir(cacheFile) {
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
}

export async function readMeasurementCache(cacheFile = defaultMeasurementCacheFile()) {
  await ensureCacheDir(cacheFile);
  const state = await readJsonState(cacheFile, emptyCache());
  return normalizeCacheState(state);
}

export async function clearMeasurementCacheFile(cacheFile = defaultMeasurementCacheFile()) {
  await ensureCacheDir(cacheFile);
  await writeJsonState(cacheFile, emptyCache());
}

export async function readCachedMeasurement(cacheKey, cacheFile = defaultMeasurementCacheFile()) {
  const state = await readMeasurementCache(cacheFile);
  return state.entries[cacheKey] ?? null;
}

export async function readCachedPackageHistory({
  cacheFile = defaultMeasurementCacheFile(),
  packageName,
  sizeOptions = {},
} = {}) {
  const targetSignature = sizeOptionsSignature(sizeOptions);
  const state = await readMeasurementCache(cacheFile);

  return Object.values(state.entries)
    .map(historyEntryFromCacheEntry)
    .filter((entry) => (
      entry &&
      entry.package === packageName &&
      isStableVersion(entry.version) &&
      sizeOptionsSignature(entry.options) === targetSignature
    ))
    .sort(sortHistoryEntries);
}

export async function writeCachedMeasurement(
  cacheKey,
  result,
  { cacheFile = defaultMeasurementCacheFile(), headers = {}, cachedAt = new Date().toISOString() } = {},
) {
  await ensureCacheDir(cacheFile);
  return withJsonStateWrite(
    cacheFile,
    async () => {
      const state = await readMeasurementCache(cacheFile);
      const entry = {
        cachedAt,
        resolvedUrl: result.resolvedUrl,
        headers,
        result: {
          ...result,
          cacheHit: false,
        },
      };
      const next = {
        ...state,
        entries: {
          ...state.entries,
          [cacheKey]: entry,
        },
      };

      await writeJsonState(cacheFile, next);
      return entry;
    },
    { crossProcessLock: true },
  );
}
