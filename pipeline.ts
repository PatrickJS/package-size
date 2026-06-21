import { definePipeline, env, job, sh, task, trigger } from "@async/pipeline";

const packageInputs = [
  "package.json",
  "pnpm-lock.yaml",
  "vite.config.js",
  "index.html",
  "README.md",
  "bin/**/*.js",
  "server/**/*.js",
  "src/**/*.js",
  "src/**/*.jsx",
  "tests/**/*.js",
  "tests/**/*.jsx",
];

export default definePipeline({
  name: "package-size",
  cache: "file:local",
  triggers: {
    pr: trigger.github({ events: ["pull_request"] }),
    main: trigger.github({ events: ["push"], branches: ["main"] }),
    release: trigger.github({ events: ["release"], types: ["published"] }),
    manual: trigger.manual(),
  },
  sync: {
    github: {
      nodeVersion: 24,
      cache: true,
      packagePreviews: {
        package: ".",
        target: "pack",
        namespace: "patrickjs",
      },
      pages: { target: "docs.site" },
    },
    tasks: {
      prefix: "pipeline",
      runners: ["package"],
      targets: [{ package: "@patrickjs/package-size" }],
      jobs: ["publish", "publish-github", "release-doctor", "snapshot", "verify"],
      tasks: ["build", "docs.site", "pack", "test"],
      scripts: {
        "github:check": "github check",
        "github:generate": "github generate",
        pages: "run-task docs.site",
        publish: "run publish",
        "publish-github": "run publish-github",
        "publish:github:main": "publish github main --package . --namespace patrickjs",
        "publish:github:release": "publish github release --package .",
        "publish:npm": "publish npm --package .",
        "release-doctor": "run release-doctor",
        "release:doctor": "release doctor --package .",
        "release:ensure": "release ensure --package .",
        "sync:check": "sync check",
        "sync:generate": "sync generate",
        verify: "run verify",
      },
    },
  },
  namedInputs: {
    source: packageInputs,
    pipeline: [
      "pipeline.ts",
      ".github/workflows/async-pipeline.yml",
      ".github/async-pipeline.lock.json",
      ".async-pipeline/tasks.lock.json",
      "package.json",
    ],
  },
  tasks: {
    "sync-check": task({
      description: "Generated workflow, lock, and package scripts still match pipeline.ts.",
      inputs: ["pipeline"],
      cache: false,
      run: sh`pnpm async-pipeline sync check`,
    }),
    test: task({
      description: "Run the package test suite.",
      inputs: ["source"],
      cache: true,
      run: sh`pnpm run test`,
    }),
    build: task({
      description: "Build the local dashboard bundle.",
      dependsOn: ["test"],
      inputs: ["source"],
      outputs: ["dist/**"],
      cache: true,
      run: sh`pnpm run build`,
    }),
    "docs.site": task({
      description: "Build the static GitHub Pages dashboard.",
      dependsOn: ["test"],
      inputs: ["source"],
      outputs: [".async/pages/**"],
      cache: false,
      run: sh`pnpm run pages:build`,
    }),
    pack: task({
      description: "Verify the publishable package contents.",
      dependsOn: ["build", "sync-check"],
      inputs: ["source", "pipeline", "dist/**"],
      cache: false,
      run: sh`pnpm run pack:check`,
    }),
    snapshot: task({
      description: "Publish an immutable main-branch snapshot to GitHub Packages.",
      dependsOn: ["pack"],
      inputs: ["source"],
      cache: false,
      run: sh`pnpm async-pipeline publish github main --package . --namespace patrickjs`,
    }),
    "release-ensure": task({
      description: "Create or verify the release tag and GitHub Release before package publishing.",
      dependsOn: ["pack"],
      inputs: ["source"],
      cache: false,
      run: sh`pnpm async-pipeline release ensure --package .`,
    }),
    "publish-github": task({
      description: "Publish the stable GitHub Packages mirror before npm publishing.",
      dependsOn: ["release-ensure"],
      inputs: ["source"],
      cache: false,
      run: sh`pnpm async-pipeline publish github release --package .`,
    }),
    publish: task({
      description: "Publish the verified release to npm, then run release doctor.",
      dependsOn: ["publish-github"],
      inputs: ["source"],
      cache: false,
      run: [
        sh`pnpm async-pipeline publish npm --package .`,
        sh`pnpm async-pipeline release doctor --package .`,
      ],
    }),
    "release-doctor": task({
      description: "Diagnose release consistency for the current version.",
      dependsOn: ["pack"],
      inputs: ["source"],
      cache: false,
      run: sh`pnpm async-pipeline release doctor --package .`,
    }),
  },
  jobs: {
    verify: job({
      target: ["pack", "docs.site"],
      trigger: ["pr", "main", "release"],
    }),
    snapshot: job({
      target: "snapshot",
      trigger: ["main"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN"),
      },
      github: {
        permissions: {
          contents: "write",
          packages: "write",
        },
      },
    }),
    "publish-github": job({
      target: "publish-github",
      trigger: ["manual"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN"),
      },
      github: {
        permissions: {
          contents: "write",
          packages: "write",
        },
      },
    }),
    publish: job({
      target: "publish",
      trigger: ["manual", "release"],
      environment: {
        name: "npm-publish",
        url: "https://www.npmjs.com/package/@patrickjs/package-size",
      },
      requires: {
        provenance: true,
      },
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN"),
        NODE_AUTH_TOKEN: env.secret("npm_token"),
      },
      github: {
        permissions: {
          contents: "write",
          packages: "write",
        },
      },
    }),
    "release-doctor": job({
      target: "release-doctor",
      trigger: ["manual"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN"),
      },
      github: {
        permissions: {
          contents: "read",
          packages: "read",
        },
      },
    }),
  },
});
