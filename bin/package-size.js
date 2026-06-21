#!/usr/bin/env node
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { measurePackageSize, PackageSizeError } from "../server/size-service.js";
import { startServer } from "../server/index.js";

class CliError extends Error {
  constructor(message, { code = "INVALID_CLI_ARGS", statusCode = 1 } = {}) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const helpText = `Usage:
  package-size json <package-spec> [options]
  package-size dashboard [--host 127.0.0.1] [--port 4173] [--open]

JSON options:
  --subpath <path>        Package export or file path
  --target <target>      Output target, default es2022
  --condition <name>     Add an export condition; may be repeated
  --env <name>           production or development
  --dev                  Shortcut for --env development
  --bundle               Bundle dependencies
  --standalone           Produce a standalone build
  --no-bundle            Disable bundling
  --min                  Request minified output
  --sourcemap            Request inline source maps
  --meta                 Request resolved module metadata`;

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new CliError(`${flag} requires a value.`);
  }
  return value;
}

export function parseJsonArgs(args) {
  const spec = args[0];
  if (!spec || spec.startsWith("--")) {
    throw new CliError("package-size json requires a package spec.");
  }

  const options = {
    conditions: [],
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--subpath") {
      options.subpath = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--target") {
      options.target = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--condition") {
      options.conditions.push(readValue(args, index, arg));
      index += 1;
    } else if (arg === "--conditions") {
      options.conditions.push(readValue(args, index, arg));
      index += 1;
    } else if (arg === "--env") {
      options.env = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--dev") {
      options.env = "development";
    } else if (arg === "--bundle") {
      options.bundle = "bundle";
    } else if (arg === "--standalone") {
      options.bundle = "standalone";
    } else if (arg === "--no-bundle") {
      options.bundle = "no-bundle";
    } else if (arg === "--min") {
      options.min = true;
    } else if (arg === "--sourcemap") {
      options.sourcemap = true;
    } else if (arg === "--meta") {
      options.meta = true;
    } else {
      throw new CliError(`Unknown JSON option: ${arg}`);
    }
  }

  if (!options.conditions.length) {
    delete options.conditions;
  }

  return { spec, options };
}

export function parseDashboardArgs(args) {
  const options = {
    host: "127.0.0.1",
    port: 4173,
    open: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--host") {
      options.host = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--port") {
      const value = Number.parseInt(readValue(args, index, arg), 10);
      if (!Number.isInteger(value) || value < 1 || value > 65535) {
        throw new CliError("--port must be a TCP port number.");
      }
      options.port = value;
      index += 1;
    } else if (arg === "--open") {
      options.open = true;
    } else {
      throw new CliError(`Unknown dashboard option: ${arg}`);
    }
  }

  return options;
}

function writeLine(stream, text) {
  stream.write(`${text}\n`);
}

function errorPayload(error) {
  const isTyped = error instanceof CliError || error instanceof PackageSizeError;
  return {
    ok: false,
    error: {
      code: isTyped ? error.code : "INTERNAL_ERROR",
      message: error.message || "Command failed.",
    },
  };
}

function openUrl(url) {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function runCli(
  argv,
  {
    measure = measurePackageSize,
    startDashboard = startServer,
    open = openUrl,
    stdout = process.stdout,
  } = {},
) {
  const [command, ...args] = argv;

  try {
    if (!command || command === "--help" || command === "-h") {
      writeLine(stdout, helpText);
      return 0;
    }

    if (command === "json") {
      const { spec, options } = parseJsonArgs(args);
      const result = await measure(spec, { sizeOptions: options });
      writeLine(stdout, JSON.stringify({ ok: true, result }));
      return 0;
    }

    if (command === "dashboard") {
      const options = parseDashboardArgs(args);
      const server = await startDashboard({
        host: options.host,
        port: options.port,
        log: false,
      });
      writeLine(stdout, `Package Size dashboard running at ${server.url}`);
      if (options.open) {
        open(server.url);
      }
      return 0;
    }

    throw new CliError(`Unknown command: ${command}`);
  } catch (error) {
    writeLine(stdout, JSON.stringify(errorPayload(error)));
    return error instanceof CliError ? error.statusCode : 1;
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  process.exitCode = await runCli(process.argv.slice(2));
}
