import { beforeEach, describe, expect, it, vi } from "vitest";
import { measurePackageSizeInBrowser } from "../src/browser-measure.js";

vi.mock("brotli-wasm", () => ({
  default: Promise.resolve({
    compress(bytes) {
      return new Uint8Array(Math.max(1, Math.ceil(bytes.byteLength * 0.7)));
    },
  }),
}));

function resolvedResponse(body, url) {
  const response = new Response(body, {
    status: 200,
    headers: {
      "content-length": String(new TextEncoder().encode(body).byteLength),
      "content-type": "application/javascript; charset=utf-8",
    },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("measurePackageSizeInBrowser", () => {
  it("measures through esm.unpkg.com and reuses local browser cache by resolved URL", async () => {
    global.fetch = vi.fn(async () => resolvedResponse(
      "export default 1;",
      "https://esm.unpkg.com/react@19.2.7?conditions=browser&target=es2022",
    ));

    const fresh = await measurePackageSizeInBrowser("react");
    const cached = await measurePackageSizeInBrowser("react@19.2.7");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(fresh).toMatchObject({
      package: "react",
      version: "19.2.7",
      cacheHit: false,
    });
    expect(fresh.gzipBytes).toBeGreaterThan(0);
    expect(fresh.brotliBytes).toBeGreaterThan(0);
    expect(cached).toMatchObject({
      query: "react@19.2.7",
      package: "react",
      version: "19.2.7",
      cacheHit: true,
    });
  });
});
