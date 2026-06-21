import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSizeApiHandler } from "./api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
]);

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "content-length": Buffer.byteLength(text),
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(text);
}

async function serveStatic(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const decodedPath = decodeURIComponent(url.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const candidate = path.normalize(path.join(distDir, relativePath));
  const safePath = candidate.startsWith(distDir) ? candidate : path.join(distDir, "index.html");

  let filePath = safePath;
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(distDir, "index.html");
    }
  } catch {
    filePath = path.join(distDir, "index.html");
  }

  try {
    const body = await fs.readFile(filePath);
    response.writeHead(200, {
      "cache-control": filePath.endsWith("index.html")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
      "content-length": body.byteLength,
      "content-type": mimeTypes.get(path.extname(filePath)) ?? "application/octet-stream",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    sendText(response, 404, "Not found");
  }
}

export async function createRequestHandler({ dev = false } = {}) {
  const apiHandler = createSizeApiHandler();

  if (!dev) {
    return async function handleProduction(request, response) {
      if (await apiHandler(request, response)) {
        return;
      }
      await serveStatic(request, response);
    };
  }

  const { createServer } = await import("vite");
  const vite = await createServer({
    appType: "spa",
    root,
    server: {
      middlewareMode: true,
    },
  });

  return async function handleDevelopment(request, response) {
    if (await apiHandler(request, response)) {
      return;
    }
    vite.middlewares(request, response);
  };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function hostForUrl(host) {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

export async function startServer({
  dev = false,
  host = process.env.HOST ?? "127.0.0.1",
  port = Number.parseInt(process.env.PORT ?? "4173", 10),
  log = true,
} = {}) {
  const handler = await createRequestHandler({ dev });
  const server = http.createServer((request, response) => {
    handler(request, response).catch((error) => {
      console.error(error);
      sendText(response, 500, "Internal server error");
    });
  });

  await listen(server, port, host);
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${hostForUrl(host)}:${actualPort}`;

  if (log) {
    const mode = dev ? "dev" : "preview";
    console.log(`Package Size ${mode} server running at ${url}`);
  }

  return {
    server,
    url,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  await startServer({
    dev: process.argv.includes("--dev"),
    host: process.env.HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.PORT ?? "4173", 10),
  });
}
