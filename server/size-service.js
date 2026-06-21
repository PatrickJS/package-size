import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import {
  buildEsmUnpkgUrl as buildSharedEsmUnpkgUrl,
  isExactVersion,
  normalizeSizeOptions,
  PackageUrlError,
  parseResolvedPackage,
  parsePackageSpec as parseSharedPackageSpec,
} from "../src/package-url.js";
import {
  clearMeasurementCacheFile,
  defaultMeasurementCacheFile,
  readCachedMeasurement,
  writeCachedMeasurement,
} from "./measurement-cache.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

export class PackageSizeError extends Error {
  constructor(message, { code = "PACKAGE_SIZE_ERROR", statusCode = 500 } = {}) {
    super(message);
    this.name = "PackageSizeError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function toPackageSizeError(error) {
  if (error instanceof PackageSizeError) {
    return error;
  }

  if (error instanceof PackageUrlError) {
    return new PackageSizeError(error.message, {
      code: error.code,
      statusCode: error.statusCode,
    });
  }

  return error;
}

export function parsePackageSpec(input) {
  try {
    return parseSharedPackageSpec(input);
  } catch (error) {
    throw toPackageSizeError(error);
  }
}

export function buildEsmUnpkgUrl(packageSpec, sizeOptions = {}) {
  try {
    return buildSharedEsmUnpkgUrl(packageSpec, sizeOptions);
  } catch (error) {
    throw toPackageSizeError(error);
  }
}

export async function clearMeasurementCache(options = {}) {
  if (options.cacheFile) {
    await clearMeasurementCacheFile(options.cacheFile);
  }
}

async function readResponseBuffer(response, maxBodyBytes) {
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    throw new PackageSizeError("Resolved artifact is too large to measure.", {
      code: "ARTIFACT_TOO_LARGE",
      statusCode: 413,
    });
  }

  if (!response.body?.getReader) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBodyBytes) {
      throw new PackageSizeError("Resolved artifact is too large to measure.", {
        code: "ARTIFACT_TOO_LARGE",
        statusCode: 413,
      });
    }
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBodyBytes) {
      throw new PackageSizeError("Resolved artifact is too large to measure.", {
        code: "ARTIFACT_TOO_LARGE",
        statusCode: 413,
      });
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

function compressionMetrics(buffer) {
  return {
    rawBytes: buffer.byteLength,
    gzipBytes: gzipSync(buffer, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(buffer, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
      },
    }).byteLength,
  };
}

function resultFromCache(cached, { parsed, requestUrl, sizeOptions }) {
  return {
    ...cached.result,
    query: parsed.query,
    requestUrl,
    options: sizeOptions,
    subpath: sizeOptions.subpath || undefined,
    cacheHit: true,
  };
}

function contentTypeWarnings(contentType, sizeOptions) {
  if (!contentType) {
    return [];
  }

  const expected = sizeOptions.meta
    ? /json|javascript|ecmascript|text\/plain/i
    : /javascript|ecmascript|text\/plain/i;

  return expected.test(contentType)
    ? []
    : [`Resolved artifact has content type ${contentType}.`];
}

export async function measurePackageSize(input, options = {}) {
  let parsed;
  let sizeOptions;

  try {
    parsed = parseSharedPackageSpec(input);
    sizeOptions = normalizeSizeOptions(options.sizeOptions ?? options);
  } catch (error) {
    throw toPackageSizeError(error);
  }

  const now = options.now ?? new Date();
  const cacheEnabled = options.cache !== false;
  const cacheFile = options.cacheFile ?? defaultMeasurementCacheFile();
  const requestUrl = buildSharedEsmUnpkgUrl(parsed, sizeOptions);

  if (cacheEnabled && isExactVersion(parsed.version)) {
    const cached = await readCachedMeasurement(requestUrl, cacheFile);
    if (cached) {
      return resultFromCache(cached, { parsed, requestUrl, sizeOptions });
    }
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new PackageSizeError("Fetch is not available in this runtime.", {
      code: "FETCH_UNAVAILABLE",
      statusCode: 500,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response;

  try {
    response = await fetchImpl(requestUrl, {
      headers: {
        accept: sizeOptions.meta
          ? "application/json,application/javascript,text/javascript,*/*;q=0.8"
          : "application/javascript,text/javascript,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    const isAbort = error?.name === "AbortError";
    throw new PackageSizeError(
      isAbort ? "Timed out while resolving the package." : "Failed to fetch resolved package.",
      {
        code: isAbort ? "FETCH_TIMEOUT" : "FETCH_FAILED",
        statusCode: isAbort ? 504 : 502,
      },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new PackageSizeError(`UNPKG returned ${response.status} for this package.`, {
      code: "UNPKG_ERROR",
      statusCode: response.status === 404 ? 404 : 502,
    });
  }

  const resolvedUrl = response.url || requestUrl;
  if (cacheEnabled) {
    const cached = await readCachedMeasurement(resolvedUrl, cacheFile);
    if (cached) {
      return resultFromCache(cached, { parsed, requestUrl, sizeOptions });
    }
  }

  const buffer = await readResponseBuffer(
    response,
    options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
  );
  const resolved = parseResolvedPackage(resolvedUrl, parsed);
  const contentType = response.headers.get("content-type") ?? "";
  const contentLength = response.headers.get("content-length") ?? "";
  const warnings = contentTypeWarnings(contentType, sizeOptions);

  const result = {
    query: parsed.query,
    requestUrl,
    resolvedUrl,
    package: resolved.packageName,
    version: resolved.version,
    subpath: sizeOptions.subpath || undefined,
    options: sizeOptions,
    ...compressionMetrics(buffer),
    contentType,
    source: "esm.unpkg.com",
    measuredAt: now.toISOString(),
    warnings,
    cacheHit: false,
  };

  if (cacheEnabled) {
    await writeCachedMeasurement(resolvedUrl, result, {
      cacheFile,
      cachedAt: now.toISOString(),
      headers: {
        contentLength,
        contentType,
      },
    });
  }

  return result;
}
