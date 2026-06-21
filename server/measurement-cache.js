import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readJsonState,
  withJsonStateWrite,
  writeJsonState,
} from "@async/json";

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
