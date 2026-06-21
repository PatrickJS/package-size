// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { parseDashboardArgs, parseJsonArgs, runCli } from "../bin/package-size.js";
import { PackageSizeError } from "../server/size-service.js";

function outputStream() {
  const chunks = [];
  return {
    chunks,
    stream: {
      write(chunk) {
        chunks.push(chunk);
      },
    },
  };
}

describe("CLI argument parsing", () => {
  it("parses JSON command options", () => {
    expect(
      parseJsonArgs([
        "react",
        "--subpath",
        "jsx-runtime",
        "--target",
        "es2020",
        "--condition",
        "browser",
        "--condition",
        "react-server",
        "--dev",
        "--standalone",
        "--min",
        "--sourcemap",
        "--meta",
      ]),
    ).toEqual({
      spec: "react",
      options: {
        subpath: "jsx-runtime",
        target: "es2020",
        conditions: ["browser", "react-server"],
        env: "development",
        bundle: "standalone",
        min: true,
        sourcemap: true,
        meta: true,
      },
    });
  });

  it("parses dashboard launch options", () => {
    expect(parseDashboardArgs(["--host", "0.0.0.0", "--port", "5000", "--open"])).toEqual({
      host: "0.0.0.0",
      port: 5000,
      open: true,
    });
  });
});

describe("runCli", () => {
  it("emits compact JSON for size results", async () => {
    const stdout = outputStream();
    const measure = vi.fn(async () => ({
      query: "react",
      package: "react",
      version: "19.2.7",
      rawBytes: 10,
      gzipBytes: 8,
      brotliBytes: 7,
      resolvedUrl: "https://esm.unpkg.com/react@19.2.7?conditions=browser&target=es2022",
    }));

    const exitCode = await runCli(["json", "react", "--target", "es2020", "--meta"], {
      measure,
      stdout: stdout.stream,
    });

    expect(exitCode).toBe(0);
    expect(measure).toHaveBeenCalledWith("react", {
      sizeOptions: {
        target: "es2020",
        meta: true,
      },
    });
    expect(JSON.parse(stdout.chunks.join(""))).toMatchObject({
      ok: true,
      result: {
        package: "react",
        version: "19.2.7",
      },
    });
  });

  it("emits compact JSON for typed errors", async () => {
    const stdout = outputStream();
    const measure = vi.fn(async () => {
      throw new PackageSizeError("Invalid package.", {
        code: "INVALID_PACKAGE_SPEC",
        statusCode: 400,
      });
    });

    const exitCode = await runCli(["json", "../bad"], {
      measure,
      stdout: stdout.stream,
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.chunks.join(""))).toEqual({
      ok: false,
      error: {
        code: "INVALID_PACKAGE_SPEC",
        message: "Invalid package.",
      },
    });
  });

  it("starts the dashboard and optionally opens it", async () => {
    const stdout = outputStream();
    const startDashboard = vi.fn(async ({ host, port }) => ({
      url: `http://${host}:${port}`,
    }));
    const open = vi.fn();

    const exitCode = await runCli(["dashboard", "--host", "127.0.0.1", "--port", "5001", "--open"], {
      open,
      startDashboard,
      stdout: stdout.stream,
    });

    expect(exitCode).toBe(0);
    expect(startDashboard).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 5001,
      log: false,
    });
    expect(open).toHaveBeenCalledWith("http://127.0.0.1:5001");
    expect(stdout.chunks.join("")).toContain("Package Size dashboard running at http://127.0.0.1:5001");
  });
});
