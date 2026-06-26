// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SIZE_OPTIONS } from "../src/package-url.js";
import { writeCachedMeasurement } from "../server/measurement-cache.js";
import { fetchPackageVersionHistory } from "../server/version-history.js";

const tempDirs = [];

async function cacheFile() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "package-size-version-history-"));
  tempDirs.push(directory);
  return path.join(directory, "cache.json");
}

function cachedResult(version, rawBytes) {
  return {
    query: `react@${version}`,
    requestUrl: `https://esm.unpkg.com/react@${version}?conditions=browser&target=es2022`,
    resolvedUrl: `https://esm.unpkg.com/react@${version}?conditions=browser&target=es2022`,
    package: "react",
    version,
    rawBytes,
    gzipBytes: Math.round(rawBytes / 4),
    brotliBytes: Math.round(rawBytes / 5),
    contentType: "application/javascript",
    source: "esm.unpkg.com",
    measuredAt: "2026-06-20T00:00:00.000Z",
    warnings: [],
    options: DEFAULT_SIZE_OPTIONS,
    cacheHit: false,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("fetchPackageVersionHistory", () => {
  it("joins npm versions with matching local cache measurements", async () => {
    const file = await cacheFile();
    const cached = cachedResult("18.3.1", 25_689);
    const cachedCanary = cachedResult("19.3.0-canary-68631c04-20260626", 30_000);
    await writeCachedMeasurement(cached.resolvedUrl, cached, {
      cacheFile: file,
      cachedAt: "2026-06-21T00:00:00.000Z",
    });
    await writeCachedMeasurement(cachedCanary.resolvedUrl, cachedCanary, {
      cacheFile: file,
      cachedAt: "2026-06-22T00:00:00.000Z",
    });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      versions: {
        "16.14.0": {},
        "17.0.2": {},
        "18.3.1": {},
        "19.2.7": {},
        "19.3.0-canary-68631c04-20260626": {},
        "0.0.0-experimental-68631c04-20260626": {},
      },
      time: {
        "16.14.0": "2020-10-14T00:00:00.000Z",
        "17.0.2": "2021-03-22T00:00:00.000Z",
        "18.3.1": "2024-04-26T00:00:00.000Z",
        "19.2.7": "2026-06-01T00:00:00.000Z",
        "19.3.0-canary-68631c04-20260626": "2026-06-26T00:00:00.000Z",
        "0.0.0-experimental-68631c04-20260626": "2026-06-26T00:00:00.000Z",
      },
      maintainers: [
        {
          name: "gaearon",
        },
        {
          name: "patrickjs",
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const history = await fetchPackageVersionHistory({
      cacheFile: file,
      fetchImpl,
      limit: 3,
      packageName: "react",
      sizeOptions: DEFAULT_SIZE_OPTIONS,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://registry.npmjs.org/react",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(history.versions.map((row) => row.version)).toEqual(["19.2.7", "18.3.1", "17.0.2"]);
    expect(history.hasMore).toBe(true);
    expect(history.npm).toEqual({
      packageUrl: "https://www.npmjs.com/package/react",
      scope: null,
      scopeUrl: null,
      maintainers: [
        {
          name: "patrickjs",
          url: "https://www.npmjs.com/~patrickjs",
        },
        {
          name: "gaearon",
          url: "https://www.npmjs.com/~gaearon",
        },
      ],
    });
    expect(history.versions[1]).toMatchObject({
      version: "18.3.1",
      loaded: true,
      rawBytes: 25_689,
      publishedAt: "2024-04-26T00:00:00.000Z",
    });
    expect(history.versions[0]).toMatchObject({
      version: "19.2.7",
      loaded: false,
    });
  });
});
