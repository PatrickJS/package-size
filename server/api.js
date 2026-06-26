import { measurePackageSize, PackageSizeError } from "./size-service.js";
import {
  PackageUrlError,
  parsePackageSpec,
  sizeOptionsFromSearchParams,
} from "../src/package-url.js";
import {
  fetchPackageVersionHistory,
  PackageVersionHistoryError,
} from "./version-history.js";

export function writeJson(response, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(body);
}

const API_PATHS = new Set(["/api/size", "/api/versions"]);

function isTypedApiError(error) {
  return (
    error instanceof PackageSizeError ||
    error instanceof PackageUrlError ||
    error instanceof PackageVersionHistoryError
  );
}

export function createSizeApiHandler({
  fetchVersions = fetchPackageVersionHistory,
  measure = measurePackageSize,
} = {}) {
  return async function handleSizeApi(request, response) {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (!API_PATHS.has(url.pathname)) {
      return false;
    }

    if (request.method === "OPTIONS") {
      writeJson(response, 204, {}, {
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET, OPTIONS",
      });
      return true;
    }

    if (request.method !== "GET") {
      writeJson(response, 405, {
        ok: false,
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Only GET is supported.",
        },
      });
      return true;
    }

    try {
      const sizeOptions = sizeOptionsFromSearchParams(url.searchParams);
      if (url.pathname === "/api/versions") {
        const parsed = parsePackageSpec(url.searchParams.get("pkg") ?? "");
        const result = await fetchVersions({
          limit: url.searchParams.get("limit"),
          packageName: parsed.packageName,
          sizeOptions,
        });
        writeJson(response, 200, { ok: true, result });
        return true;
      }

      const result = await measure(url.searchParams.get("pkg") ?? "", { sizeOptions });
      writeJson(response, 200, { ok: true, result });
    } catch (error) {
      const isTypedError = isTypedApiError(error);
      const statusCode = isTypedError ? error.statusCode : 500;
      const code = isTypedError ? error.code : "INTERNAL_ERROR";
      writeJson(response, statusCode, {
        ok: false,
        error: {
          code,
          message: error.message || "Package size measurement failed.",
        },
      });
    }

    return true;
  };
}
