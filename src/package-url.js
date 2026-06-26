export const SOURCE_ORIGIN = "https://esm.unpkg.com";
export const NPM_REGISTRY_ORIGIN = "https://registry.npmjs.org";
export const NPM_WEB_ORIGIN = "https://www.npmjs.com";

export const DEFAULT_SIZE_OPTIONS = Object.freeze({
  subpath: "",
  target: "es2022",
  conditions: Object.freeze(["browser"]),
  env: "production",
  bundle: "default",
  min: false,
  sourcemap: false,
  meta: false,
});

const VALID_TARGETS = new Set([
  "es2015",
  "es2016",
  "es2017",
  "es2018",
  "es2019",
  "es2020",
  "es2021",
  "es2022",
  "es2023",
  "es2024",
  "esnext",
  "node",
  "deno",
  "denonext",
]);

const VALID_ENVIRONMENTS = new Set(["production", "development"]);
const VALID_BUNDLE_MODES = new Set(["default", "bundle", "standalone", "no-bundle"]);

export class PackageUrlError extends Error {
  constructor(message, { code = "INVALID_PACKAGE_SPEC", statusCode = 400 } = {}) {
    super(message);
    this.name = "PackageUrlError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function booleanOption(value) {
  return value === true || value === "true" || value === "1" || value === "";
}

function stringList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item ?? "").split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function normalizeSubpath(value) {
  const subpath = String(value ?? "")
    .trim()
    .replace(/^\/+/, "");

  if (!subpath) {
    return "";
  }

  if (/[\s\\]/.test(subpath) || subpath.includes("://") || subpath.includes("..")) {
    throw new PackageUrlError("Subpath must be a package file or export path.", {
      code: "INVALID_SUBPATH",
    });
  }

  return subpath;
}

export function parsePackageSpec(input) {
  const query = String(input ?? "").trim();

  if (!query) {
    throw new PackageUrlError("Enter a package name.");
  }

  if (query.length > 214) {
    throw new PackageUrlError("Package spec is too long.");
  }

  if (
    /[\s\\]/.test(query) ||
    query.includes("://") ||
    query.startsWith("//") ||
    query.includes("..")
  ) {
    throw new PackageUrlError("Package spec must be an npm package name.");
  }

  const scoped = query.match(
    /^@([a-z0-9][a-z0-9._~-]*)\/([a-z0-9][a-z0-9._~-]*)(?:@([a-z0-9._~+-]+))?$/i,
  );
  if (scoped) {
    return {
      query,
      packageName: `@${scoped[1]}/${scoped[2]}`,
      version: scoped[3] ?? null,
    };
  }

  const unscoped = query.match(/^([a-z0-9][a-z0-9._~-]*)(?:@([a-z0-9._~+-]+))?$/i);
  if (unscoped) {
    return {
      query,
      packageName: unscoped[1],
      version: unscoped[2] ?? null,
    };
  }

  throw new PackageUrlError("Package spec must be an npm package name.");
}

export function isExactVersion(version) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
    String(version ?? ""),
  );
}

export function isStableVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(String(version ?? ""));
}

export function compareStableVersionsDesc(left, right) {
  const leftMatch = String(left ?? "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  const rightMatch = String(right ?? "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!leftMatch || !rightMatch) {
    return 0;
  }

  for (let index = 1; index <= 3; index += 1) {
    const order = Number(rightMatch[index]) - Number(leftMatch[index]);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

export function normalizeSizeOptions(input = {}) {
  const target = String(input.target ?? DEFAULT_SIZE_OPTIONS.target).trim();
  if (!VALID_TARGETS.has(target)) {
    throw new PackageUrlError("Target must be a supported esm.unpkg.com target.", {
      code: "INVALID_TARGET",
    });
  }

  const env = input.dev ? "development" : String(input.env ?? DEFAULT_SIZE_OPTIONS.env).trim();
  if (!VALID_ENVIRONMENTS.has(env)) {
    throw new PackageUrlError("Environment must be production or development.", {
      code: "INVALID_ENVIRONMENT",
    });
  }

  const bundle = String(input.bundle ?? DEFAULT_SIZE_OPTIONS.bundle).trim();
  if (!VALID_BUNDLE_MODES.has(bundle)) {
    throw new PackageUrlError("Bundle mode must be default, bundle, standalone, or no-bundle.", {
      code: "INVALID_BUNDLE_MODE",
    });
  }

  const conditions = uniqueStrings(
    stringList(input.conditions ?? DEFAULT_SIZE_OPTIONS.conditions),
  );

  return {
    subpath: normalizeSubpath(input.subpath),
    target,
    conditions: conditions.length ? conditions : [...DEFAULT_SIZE_OPTIONS.conditions],
    env,
    bundle,
    min: booleanOption(input.min),
    sourcemap: booleanOption(input.sourcemap),
    meta: booleanOption(input.meta),
  };
}

export function sizeOptionsSignature(sizeOptions = {}) {
  const options = normalizeSizeOptions(sizeOptions);
  return JSON.stringify({
    subpath: options.subpath,
    target: options.target,
    conditions: options.conditions,
    env: options.env,
    bundle: options.bundle,
    min: options.min,
    sourcemap: options.sourcemap,
    meta: options.meta,
  });
}

export function packageSpecFromResolved(packageName, version) {
  return version ? `${packageName}@${version}` : packageName;
}

function npmWebOrigin(origin) {
  return String(origin ?? NPM_WEB_ORIGIN).replace(/\/+$/, "");
}

function encodedPackagePath(packageName) {
  const parsed = parsePackageSpec(packageName);
  return parsed.packageName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function buildNpmRegistryPackageUrl(packageName, registryOrigin = NPM_REGISTRY_ORIGIN) {
  const parsed = parsePackageSpec(packageName);
  const origin = String(registryOrigin ?? NPM_REGISTRY_ORIGIN).replace(/\/+$/, "");
  return `${origin}/${encodeURIComponent(parsed.packageName)}`;
}

export function npmPackageScope(packageName) {
  const parsed = parsePackageSpec(packageName);
  if (!parsed.packageName.startsWith("@")) {
    return null;
  }
  return parsed.packageName.slice(1).split("/")[0] || null;
}

export function buildNpmPackageUrl(packageName, webOrigin = NPM_WEB_ORIGIN) {
  return `${npmWebOrigin(webOrigin)}/package/${encodedPackagePath(packageName)}`;
}

export function buildNpmScopeUrl(packageName, webOrigin = NPM_WEB_ORIGIN) {
  const scope = npmPackageScope(packageName);
  return scope ? `${npmWebOrigin(webOrigin)}/org/${encodeURIComponent(scope)}` : null;
}

export function buildNpmMaintainerUrl(name, webOrigin = NPM_WEB_ORIGIN) {
  return `${npmWebOrigin(webOrigin)}/~${encodeURIComponent(String(name ?? "").trim())}`;
}

function formatSearchParams(params) {
  return params.toString().replace(/=(?=&|$)/g, "").replace(/%2C/g, ",");
}

export function buildUnpkgSearchParams(sizeOptions = {}) {
  const options = normalizeSizeOptions(sizeOptions);
  const params = new URLSearchParams();

  if (options.conditions.length) {
    params.set("conditions", options.conditions.join(","));
  }
  if (options.target) {
    params.set("target", options.target);
  }
  if (options.env === "development") {
    params.set("dev", "");
  }
  if (options.bundle !== "default") {
    params.set(options.bundle, "");
  }
  if (options.min) {
    params.set("min", "");
  }
  if (options.sourcemap) {
    params.set("sourcemap", "");
  }
  if (options.meta) {
    params.set("meta", "");
  }

  return params;
}

export function buildUnpkgQueryString(sizeOptions = {}) {
  return formatSearchParams(buildUnpkgSearchParams(sizeOptions));
}

export function parseResolvedPackage(resolvedUrl, fallback) {
  try {
    const url = new URL(resolvedUrl);
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (segments[0]?.startsWith("@") && segments[1]) {
      const versionAt = segments[1].lastIndexOf("@");
      if (versionAt > 0) {
        return {
          packageName: `${segments[0]}/${segments[1].slice(0, versionAt)}`,
          version: segments[1].slice(versionAt + 1),
        };
      }
    }

    const root = segments[0] ?? "";
    const versionAt = root.lastIndexOf("@");
    if (versionAt > 0) {
      return {
        packageName: root.slice(0, versionAt),
        version: root.slice(versionAt + 1),
      };
    }
  } catch {
    // Fall through to the requested package spec.
  }

  return {
    packageName: fallback.packageName,
    version: fallback.version ?? "latest",
  };
}

export function buildEsmUnpkgUrl(packageSpec, sizeOptions = {}) {
  const parsed =
    typeof packageSpec === "string" ? parsePackageSpec(packageSpec) : packageSpec;
  const options = normalizeSizeOptions(sizeOptions);
  const encodedPackage = parsed.packageName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const encodedVersion = parsed.version ? `@${encodeURIComponent(parsed.version)}` : "";
  const subpath = options.subpath
    ? `/${options.subpath.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`
    : "";
  const url = new URL(`${SOURCE_ORIGIN}/${encodedPackage}${encodedVersion}${subpath}`);
  const query = buildUnpkgQueryString(options);

  if (query) {
    url.search = query;
  }

  return url.toString();
}

export function sizeOptionsFromSearchParams(searchParams) {
  const repeatedConditions = searchParams.getAll("conditions");
  const conditions = repeatedConditions.length
    ? repeatedConditions
    : searchParams.get("condition");
  const bundleParam = searchParams.get("bundle");

  return normalizeSizeOptions({
    subpath: searchParams.get("subpath") ?? "",
    target: searchParams.get("target") ?? DEFAULT_SIZE_OPTIONS.target,
    conditions,
    env: searchParams.has("dev")
      ? "development"
      : searchParams.get("env") ?? DEFAULT_SIZE_OPTIONS.env,
    bundle: searchParams.has("standalone")
        ? "standalone"
        : searchParams.has("no-bundle")
          ? "no-bundle"
          : searchParams.has("bundle")
            ? bundleParam && bundleParam !== "true"
              ? bundleParam
              : "bundle"
            : DEFAULT_SIZE_OPTIONS.bundle,
    min: searchParams.has("min") ? searchParams.get("min") ?? "" : false,
    sourcemap: searchParams.has("sourcemap") ? searchParams.get("sourcemap") ?? "" : false,
    meta: searchParams.has("meta") ? searchParams.get("meta") ?? "" : false,
  });
}

export function buildSizeApiSearchParams(packageSpec, sizeOptions = {}) {
  const options = normalizeSizeOptions(sizeOptions);
  const params = new URLSearchParams();
  params.set("pkg", String(packageSpec ?? "").trim());

  if (options.subpath) {
    params.set("subpath", options.subpath);
  }
  if (options.target !== DEFAULT_SIZE_OPTIONS.target) {
    params.set("target", options.target);
  }
  if (options.conditions.join(",") !== DEFAULT_SIZE_OPTIONS.conditions.join(",")) {
    params.set("conditions", options.conditions.join(","));
  }
  if (options.env === "development") {
    params.set("env", "development");
  }
  if (options.bundle !== DEFAULT_SIZE_OPTIONS.bundle) {
    params.set("bundle", options.bundle);
  }
  if (options.min) {
    params.set("min", "true");
  }
  if (options.sourcemap) {
    params.set("sourcemap", "true");
  }
  if (options.meta) {
    params.set("meta", "true");
  }

  return params;
}
