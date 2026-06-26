import {
  buildNpmMaintainerUrl,
  buildNpmPackageUrl,
  buildNpmRegistryPackageUrl,
  buildNpmScopeUrl,
  compareStableVersionsDesc,
  isStableVersion,
  npmPackageScope,
} from "../src/package-url.js";
import { readCachedPackageHistory } from "./measurement-cache.js";

const DEFAULT_LIMIT = 5;
const DEFAULT_TIMEOUT_MS = 10_000;

export class PackageVersionHistoryError extends Error {
  constructor(message, { code = "VERSION_HISTORY_ERROR", statusCode = 500 } = {}) {
    super(message);
    this.name = "PackageVersionHistoryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function limitValue(value) {
  const limit = Number.parseInt(value ?? DEFAULT_LIMIT, 10);
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(100, Math.max(1, limit));
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
    .sort((left, right) => {
      const leftIsPatrick = left.name.toLowerCase() === "patrickjs";
      const rightIsPatrick = right.name.toLowerCase() === "patrickjs";
      if (leftIsPatrick) {
        return rightIsPatrick ? 0 : -1;
      }
      if (rightIsPatrick) {
        return 1;
      }
      return 0;
    });
}

function npmMetadata(packageName, metadata) {
  const scope = npmPackageScope(packageName);
  return {
    packageUrl: buildNpmPackageUrl(packageName),
    scope,
    scopeUrl: buildNpmScopeUrl(packageName),
    maintainers: publicMaintainers(metadata),
  };
}

function registryRows(packageName, metadata, limit) {
  const versions = metadata?.versions;
  if (!versions || typeof versions !== "object" || Array.isArray(versions)) {
    throw new PackageVersionHistoryError("Package metadata did not include versions.", {
      code: "VERSION_METADATA_INVALID",
      statusCode: 502,
    });
  }

  const time = metadata?.time && typeof metadata.time === "object" ? metadata.time : {};
  const stableVersions = Object.keys(versions)
    .filter(isStableVersion)
    .sort(compareStableVersionsDesc);

  return {
    hasMore: stableVersions.length > limit,
    rows: stableVersions
      .slice(0, limit)
      .map((version) => ({
        package: packageName,
        version,
        publishedAt: time[version] ?? null,
        loaded: false,
      })),
  };
}

function mergeCachedRows(rows, cachedEntries) {
  const cachedByVersion = new Map(
    cachedEntries.map((entry) => [entry.version, entry]),
  );
  const merged = rows.map((row) => {
    const cached = cachedByVersion.get(row.version);
    return cached
      ? {
          ...row,
          ...cached,
          publishedAt: row.publishedAt,
          loaded: true,
        }
      : row;
  });

  return merged.sort((left, right) => (
    compareStableVersionsDesc(left.version, right.version)
  ));
}

export async function fetchPackageVersionHistory({
  cacheFile,
  fetchImpl = globalThis.fetch,
  limit = DEFAULT_LIMIT,
  packageName,
  registryOrigin,
  sizeOptions = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!packageName) {
    throw new PackageVersionHistoryError("Enter a package name.", {
      code: "INVALID_PACKAGE_SPEC",
      statusCode: 400,
    });
  }

  const cachedEntries = await readCachedPackageHistory({
    cacheFile,
    packageName,
    sizeOptions,
  });
  const requestedLimit = limitValue(limit);

  if (!fetchImpl) {
    return {
      package: packageName,
      hasMore: cachedEntries.length > requestedLimit,
      npm: npmMetadata(packageName),
      versions: cachedEntries.slice(0, requestedLimit),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetchImpl(buildNpmRegistryPackageUrl(packageName, registryOrigin), {
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (cachedEntries.length) {
      return {
        package: packageName,
        hasMore: cachedEntries.length > requestedLimit,
        npm: npmMetadata(packageName),
        versions: cachedEntries.slice(0, requestedLimit),
      };
    }
    const isAbort = error?.name === "AbortError";
    throw new PackageVersionHistoryError(
      isAbort ? "Timed out while loading version history." : "Failed to load version history.",
      {
        code: isAbort ? "VERSION_HISTORY_TIMEOUT" : "VERSION_HISTORY_FETCH_FAILED",
        statusCode: isAbort ? 504 : 502,
      },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    if (cachedEntries.length) {
      return {
        package: packageName,
        hasMore: cachedEntries.length > requestedLimit,
        npm: npmMetadata(packageName),
        versions: cachedEntries.slice(0, requestedLimit),
      };
    }
    throw new PackageVersionHistoryError(`npm registry returned ${response.status} for this package.`, {
      code: "VERSION_HISTORY_REGISTRY_ERROR",
      statusCode: response.status === 404 ? 404 : 502,
    });
  }

  let metadata;
  try {
    metadata = await response.json();
  } catch {
    if (cachedEntries.length) {
      return {
        package: packageName,
        hasMore: cachedEntries.length > requestedLimit,
        npm: npmMetadata(packageName),
        versions: cachedEntries.slice(0, requestedLimit),
      };
    }
    throw new PackageVersionHistoryError("Version history response was not valid JSON.", {
      code: "VERSION_HISTORY_INVALID_JSON",
      statusCode: 502,
    });
  }

  const history = registryRows(packageName, metadata, requestedLimit);

  return {
    package: packageName,
    hasMore: history.hasMore,
    npm: npmMetadata(packageName, metadata),
    versions: mergeCachedRows(history.rows, cachedEntries),
  };
}
