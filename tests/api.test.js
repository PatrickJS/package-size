// @vitest-environment node
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createSizeApiHandler } from "../server/api.js";
import { PackageSizeError } from "../server/size-service.js";

const servers = [];

async function startServer(measure) {
  const handler = createSizeApiHandler({ measure });
  const server = http.createServer(async (request, response) => {
    if (!(await handler(request, response))) {
      response.writeHead(404);
      response.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  servers.push(server);
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    ),
  );
});

describe("size API", () => {
  it("returns measured package data", async () => {
    let observed;
    const baseUrl = await startServer(async (pkg, options) => {
      observed = { pkg, options };
      return {
      query: pkg,
      requestUrl: "https://esm.unpkg.com/react?conditions=browser,react-server&target=es2020&dev&standalone&min&meta",
      resolvedUrl: "https://esm.unpkg.com/react@19.2.7?conditions=browser&target=es2022",
      package: "react",
      version: "19.2.7",
      options: options.sizeOptions,
      rawBytes: 20,
      gzipBytes: 12,
      brotliBytes: 10,
      contentType: "application/javascript",
      source: "esm.unpkg.com",
      measuredAt: "2026-06-20T00:00:00.000Z",
      warnings: [],
      cacheHit: false,
    };
    });

    const response = await fetch(
      `${baseUrl}/api/size?pkg=react&target=es2020&conditions=browser&conditions=react-server&env=development&bundle=standalone&min=true&meta=true`,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(observed).toMatchObject({
      pkg: "react",
      options: {
        sizeOptions: {
          target: "es2020",
          conditions: ["browser", "react-server"],
          env: "development",
          bundle: "standalone",
          min: true,
          meta: true,
        },
      },
    });
    expect(payload).toEqual({
      ok: true,
      result: expect.objectContaining({
        query: "react",
        package: "react",
        brotliBytes: 10,
      }),
    });
  });

  it("returns typed errors from the measurement layer", async () => {
    const baseUrl = await startServer(async () => {
      throw new PackageSizeError("Invalid package.", {
        code: "INVALID_PACKAGE_SPEC",
        statusCode: 400,
      });
    });

    const response = await fetch(`${baseUrl}/api/size?pkg=bad`);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      ok: false,
      error: {
        code: "INVALID_PACKAGE_SPEC",
        message: "Invalid package.",
      },
    });
  });

  it("rejects non-GET requests", async () => {
    const baseUrl = await startServer(async () => ({}));
    const response = await fetch(`${baseUrl}/api/size?pkg=react`, { method: "POST" });
    const payload = await response.json();

    expect(response.status).toBe(405);
    expect(payload.error.code).toBe("METHOD_NOT_ALLOWED");
  });
});
