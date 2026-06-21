import {
  buildEsmUnpkgUrl,
  isExactVersion,
  normalizeSizeOptions,
  parsePackageSpec,
  parseResolvedPackage,
} from "./package-url.js";

const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
const DB_NAME = "package-size";
const STORE_NAME = "measurements";
const CACHE_PREFIX = "package-size.browser-cache.v1:";

let brotliModulePromise;

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openCacheDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "resolvedUrl" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function localStorageKey(resolvedUrl) {
  return `${CACHE_PREFIX}${resolvedUrl}`;
}

async function readBrowserCache(resolvedUrl) {
  try {
    const db = await openCacheDb();
    if (db) {
      try {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const entry = await requestAsPromise(transaction.objectStore(STORE_NAME).get(resolvedUrl));
        db.close();
        return entry ?? null;
      } catch {
        db.close();
      }
    }
  } catch {
    // Fall back to localStorage below.
  }

  try {
    const raw = window.localStorage.getItem(localStorageKey(resolvedUrl));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeBrowserCache(entry) {
  try {
    const db = await openCacheDb();
    if (db) {
      try {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        await requestAsPromise(transaction.objectStore(STORE_NAME).put(entry));
        db.close();
        return;
      } catch {
        db.close();
      }
    }
  } catch {
    // Fall back to localStorage below.
  }

  try {
    window.localStorage.setItem(localStorageKey(entry.resolvedUrl), JSON.stringify(entry));
  } catch {
    // Cache writes are best effort in static mode.
  }
}

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
    const cached = await readBrowserCache(requestUrl);
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
  const cached = await readBrowserCache(resolvedUrl);
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

  await writeBrowserCache({
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
