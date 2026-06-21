// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEsmUnpkgUrl,
  measurePackageSize,
  parsePackageSpec,
  PackageSizeError,
} from "../server/size-service.js";
import { readMeasurementCache } from "../server/measurement-cache.js";

const tempDirs = [];

function makeResponse(body, options = {}) {
  const buffer = Buffer.from(body);
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? "OK",
    url: options.url ?? "https://esm.unpkg.com/react@19.2.7?conditions=browser&target=es2022",
    headers: new Headers({
      "content-length": String(options.contentLength ?? buffer.byteLength),
      "content-type": options.contentType ?? "application/javascript; charset=utf-8",
    }),
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

async function cacheFile() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "package-size-test-"));
  tempDirs.push(directory);
  return path.join(directory, "cache.json");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("parsePackageSpec", () => {
  it("accepts npm package names with optional versions", () => {
    expect(parsePackageSpec("react")).toEqual({
      query: "react",
      packageName: "react",
      version: null,
    });
    expect(parsePackageSpec("react@18.3.1")).toEqual({
      query: "react@18.3.1",
      packageName: "react",
      version: "18.3.1",
    });
    expect(parsePackageSpec("@scope/package@beta")).toEqual({
      query: "@scope/package@beta",
      packageName: "@scope/package",
      version: "beta",
    });
  });

  it("rejects URLs and path-like input", () => {
    expect(() => parsePackageSpec("https://example.com/react")).toThrow(PackageSizeError);
    expect(() => parsePackageSpec("../react")).toThrow(PackageSizeError);
    expect(() => parsePackageSpec("react dom")).toThrow(PackageSizeError);
    expect(() => parsePackageSpec("")).toThrow(PackageSizeError);
  });
});

describe("buildEsmUnpkgUrl", () => {
  it("builds default browser ESM resolver URLs", () => {
    expect(buildEsmUnpkgUrl("react")).toBe(
      "https://esm.unpkg.com/react?conditions=browser&target=es2022",
    );
    expect(buildEsmUnpkgUrl("@scope/package@1.2.3")).toBe(
      "https://esm.unpkg.com/%40scope/package@1.2.3?conditions=browser&target=es2022",
    );
  });

  it("builds common package URL variations with stable query output", () => {
    expect(
      buildEsmUnpkgUrl("react@18.3.1", {
        subpath: "jsx-runtime",
        target: "es2020",
        conditions: ["browser", "react-server"],
        env: "development",
        bundle: "standalone",
        min: true,
        sourcemap: true,
      }),
    ).toBe(
      "https://esm.unpkg.com/react@18.3.1/jsx-runtime?conditions=browser,react-server&target=es2020&dev&standalone&min&sourcemap",
    );
    expect(buildEsmUnpkgUrl("react", { meta: true })).toBe(
      "https://esm.unpkg.com/react?conditions=browser&target=es2022&meta",
    );
  });
});

describe("measurePackageSize", () => {
  it("returns raw, gzip, and Brotli byte counts", async () => {
    const fetchImpl = vi.fn(async () => makeResponse("export default function hello() {}"));
    const result = await measurePackageSize("react", {
      cache: false,
      fetchImpl,
      now: new Date("2026-06-20T00:00:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://esm.unpkg.com/react?conditions=browser&target=es2022",
      expect.objectContaining({ redirect: "follow" }),
    );
    expect(result).toMatchObject({
      query: "react",
      requestUrl: "https://esm.unpkg.com/react?conditions=browser&target=es2022",
      resolvedUrl: "https://esm.unpkg.com/react@19.2.7?conditions=browser&target=es2022",
      package: "react",
      version: "19.2.7",
      contentType: "application/javascript; charset=utf-8",
      source: "esm.unpkg.com",
      measuredAt: "2026-06-20T00:00:00.000Z",
      warnings: [],
      cacheHit: false,
    });
    expect(result.rawBytes).toBeGreaterThan(0);
    expect(result.gzipBytes).toBeGreaterThan(0);
    expect(result.brotliBytes).toBeGreaterThan(0);
  });

  it("reuses forever cache entries by resolved pinned URL", async () => {
    const file = await cacheFile();
    const fetchImpl = vi.fn(async () => makeResponse("export default 1;"));

    await measurePackageSize("react", {
      cacheFile: file,
      fetchImpl,
      now: new Date("2026-06-20T00:00:00.000Z"),
    });
    const cached = await measurePackageSize("react@19.2.7", {
      cacheFile: file,
      fetchImpl,
      now: new Date("2027-06-20T00:00:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cached).toMatchObject({
      query: "react@19.2.7",
      cacheHit: true,
      resolvedUrl: "https://esm.unpkg.com/react@19.2.7?conditions=browser&target=es2022",
    });
  });

  it("does not read mutable latest specs from cache before resolution", async () => {
    const file = await cacheFile();
    const fetchImpl = vi.fn(async () => makeResponse("export default 1;"));

    await measurePackageSize("react", { cacheFile: file, fetchImpl });
    await measurePackageSize("react", { cacheFile: file, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stores concurrent cache writes as valid JSON", async () => {
    const file = await cacheFile();
    const fetchImpl = vi.fn(async (url) => {
      const packageName = url.includes("zod") ? "zod" : "react";
      const version = packageName === "zod" ? "4.4.3" : "19.2.7";
      return makeResponse(`export default "${packageName}";`, {
        url: `https://esm.unpkg.com/${packageName}@${version}?conditions=browser&target=es2022`,
      });
    });

    await Promise.all([
      measurePackageSize("react", { cacheFile: file, fetchImpl }),
      measurePackageSize("zod", { cacheFile: file, fetchImpl }),
    ]);

    const state = await readMeasurementCache(file);
    expect(Object.keys(state.entries).sort()).toEqual([
      "https://esm.unpkg.com/react@19.2.7?conditions=browser&target=es2022",
      "https://esm.unpkg.com/zod@4.4.3?conditions=browser&target=es2022",
    ]);
  });

  it("maps non-OK UNPKG responses to package errors", async () => {
    await expect(
      measurePackageSize("missing-package", {
        cache: false,
        fetchImpl: async () => makeResponse("not found", { ok: false, status: 404 }),
      }),
    ).rejects.toMatchObject({
      code: "UNPKG_ERROR",
      statusCode: 404,
    });
  });

  it("maps fetch aborts to timeout errors", async () => {
    await expect(
      measurePackageSize("react", {
        cache: false,
        fetchImpl: async () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        },
      }),
    ).rejects.toMatchObject({
      code: "FETCH_TIMEOUT",
      statusCode: 504,
    });
  });

  it("rejects oversized artifacts before reading the body", async () => {
    await expect(
      measurePackageSize("react", {
        cache: false,
        maxBodyBytes: 10,
        fetchImpl: async () => makeResponse("export default 1;", { contentLength: 20 }),
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_TOO_LARGE",
      statusCode: 413,
    });
  });

  it("adds a warning for unexpected content types", async () => {
    const result = await measurePackageSize("react", {
      cache: false,
      fetchImpl: async () => makeResponse("<html></html>", { contentType: "text/html" }),
    });

    expect(result.warnings).toEqual(["Resolved artifact has content type text/html."]);
  });
});
