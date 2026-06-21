import { measurePackageSize, PackageSizeError } from "./size-service.js";
import { PackageUrlError, sizeOptionsFromSearchParams } from "../src/package-url.js";

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

export function createSizeApiHandler({ measure = measurePackageSize } = {}) {
  return async function handleSizeApi(request, response) {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname !== "/api/size") {
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
      const result = await measure(url.searchParams.get("pkg") ?? "", { sizeOptions });
      writeJson(response, 200, { ok: true, result });
    } catch (error) {
      const isTypedError = error instanceof PackageSizeError || error instanceof PackageUrlError;
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
