import {
  buildEsmUnpkgUrl,
  isExactVersion,
  normalizeSizeOptions,
  parsePackageSpec,
  parseResolvedPackage,
} from "./package-url.js";
import {
  readBrowserMeasurementEntry,
  writeBrowserMeasurementEntry,
} from "./browser-cache.js";

const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

let brotliModulePromise;

async function gzipByteLength(buffer) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("This browser does not support gzip measurement.");
  }

  const body = new Response(buffer).body;
  if (!body) {
    throw new Error("This browser does not support gzip measurement.");
  }

  const compressed = await new Response(
    body.pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  return compressed.byteLength;
}

async function brotliByteLength(buffer) {
  brotliModulePromise ??= import("brotli-wasm").then((module) => module.default);
  const brotli = await brotliModulePromise;
  return brotli.compress(new Uint8Array(buffer), { quality: 11 }).byteLength;
}

async function compressionMetrics(buffer) {
  const [gzipBytes, brotliBytes] = await Promise.all([
    gzipByteLength(buffer),
    brotliByteLength(buffer),
  ]);
  return {
    rawBytes: buffer.byteLength,
    gzipBytes,
    brotliBytes,
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

async function readResponseBuffer(response) {
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > DEFAULT_MAX_BODY_BYTES) {
    throw new Error("Resolved artifact is too large to measure.");
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > DEFAULT_MAX_BODY_BYTES) {
    throw new Error("Resolved artifact is too large to measure.");
  }
  return buffer;
}

export async function measurePackageSizeInBrowser(input, options = {}) {
  const parsed = parsePackageSpec(input);
  const sizeOptions = normalizeSizeOptions(options);
  const requestUrl = buildEsmUnpkgUrl(parsed, sizeOptions);

  if (isExactVersion(parsed.version)) {
    const cached = await readBrowserMeasurementEntry(requestUrl);
    if (cached) {
      return resultFromCache(cached, { parsed, requestUrl, sizeOptions });
    }
  }

  const response = await fetch(requestUrl, {
    headers: {
      accept: sizeOptions.meta
        ? "application/json,application/javascript,text/javascript,*/*;q=0.8"
        : "application/javascript,text/javascript,*/*;q=0.8",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`UNPKG returned ${response.status} for this package.`);
  }

  const resolvedUrl = response.url || requestUrl;
  const cached = await readBrowserMeasurementEntry(resolvedUrl);
  if (cached) {
    return resultFromCache(cached, { parsed, requestUrl, sizeOptions });
  }

  const buffer = await readResponseBuffer(response);
  const resolved = parseResolvedPackage(resolvedUrl, parsed);
  const contentType = response.headers.get("content-type") ?? "";
  const now = new Date().toISOString();
  const result = {
    query: parsed.query,
    requestUrl,
    resolvedUrl,
    package: resolved.packageName,
    version: resolved.version,
    subpath: sizeOptions.subpath || undefined,
    options: sizeOptions,
    ...(await compressionMetrics(buffer)),
    contentType,
    source: "esm.unpkg.com",
    measuredAt: now,
    warnings: contentTypeWarnings(contentType, sizeOptions),
    cacheHit: false,
  };

  await writeBrowserMeasurementEntry({
    schemaVersion: 1,
    cachedAt: now,
    resolvedUrl,
    headers: {
      contentLength: response.headers.get("content-length") ?? "",
      contentType,
    },
    result,
  });

  return result;
}
