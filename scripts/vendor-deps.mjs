/**
 * Vendored Svelte dependencies — Extension.js svelte-loader workaround.
 *
 * Why this exists (ticket 0012 — inject overlay into a Shadow DOM):
 *   Extension.js v4 builds content scripts (and the whole extension) through
 *   `svelte-loader`, whose loader rule only compiles `.svelte` files under the
 *   project `src/`. Two dependencies ship raw `.svelte` source inside
 *   `node_modules` (resolved via the `"svelte"` export condition), so the
 *   loader never compiles them and the build dies with "Module parse failed":
 *
 *     - `bits-ui`        — shadcn-svelte's primitive layer (973 files, all `.svelte` source)
 *     - `@lucide/svelte` — icon components (raw `.svelte` per icon)
 *
 *   Copying those `.svelte` sources into `src/lib/vendor/` moves them under the
 *   loader's compilation scope, so `svelte-loader` compiles them like any other
 *   project `.svelte`. We then rewrite the shadcn-svelte component imports to
 *   point at the vendored copies (and lint forbids the bare package imports —
 *   see `no-restricted-imports` in `.oxlintrc.json`).
 *
 * Scope:
 *   - `bits-ui` is vendored wholesale (its dist barrel re-exports every
 *     primitive; only the imported subset is compiled at build time, so the
 *     extra files cost nothing but disk). Wholesale copy also avoids fragile
 *     per-component dependency-closure tracing.
 *   - `@lucide/svelte` ships 7k+ icons (31 MB); we vendor only the icons the
 *     overlay actually references plus the shared `Icon.svelte` base. Add new
 *     icons to `LUCIDE_ICONS` below when a shadcn component pulls a new one.
 *
 * Lifecycle:
 *   Runs on every `pnpm install` (via the `postinstall` script) so the vendored
 *   tree stays in sync with dependency upgrades. Re-run manually with
 *   `pnpm run vendor` after adding a shadcn-svelte component (it rewrites the
 *   new component's `bits-ui`/`@lucide/svelte` imports to the vendored paths).
 *
 * `src/lib/vendor/` is generated and gitignored — never edit it by hand.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const VENDOR = join(ROOT, "src", "lib", "vendor");

/** @lucide/svelte icons referenced by shadcn-svelte components in this project. */
const LUCIDE_ICONS = ["chevron-down", "chevron-up", "check"];

/**
 * Resolve a package root directory from its installed location. We cannot
 * `require.resolve("<pkg>/package.json")` — both packages restrict `exports`
 * and do not expose `./package.json` — so resolve the package's main entry
 * and walk up to the enclosing `node_modules/<pkg>` directory.
 */
function resolvePackageDir(name) {
  const entry = require.resolve(name);
  const marker = `node_modules/${name}/`;
  const idx = entry.indexOf(marker);
  if (idx < 0) throw new Error(`could not locate ${name} package dir from ${entry}`);
  return entry.slice(0, idx + marker.length - 1);
}

/**
 * Copy a package's `dist/` tree into `<vendor>/<name>/dist/`, replacing any prior
 * copy. Returns the vendored dist path.
 */
function vendorDist(name) {
  const pkgDir = resolvePackageDir(name);
  const src = join(pkgDir, "dist");
  if (!existsSync(src)) throw new Error(`${name} has no dist/ to vendor (${pkgDir})`);
  const dest = join(VENDOR, name, "dist");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  return dest;
}

/**
 * Vendor the @lucide/svelte subset: the shared `Icon.svelte` base + only the
 * icons listed in LUCIDE_ICONS (each with its `.svelte` and `.svelte.d.ts`).
 */
function vendorLucideSubset() {
  const pkgDir = resolvePackageDir("@lucide/svelte");
  const srcDist = join(pkgDir, "dist");
  const destRoot = join(VENDOR, "lucide");
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(join(destRoot, "icons"), { recursive: true });

  // Icon.svelte imports these helpers (self-contained; no further closure).
  for (const file of [
    "Icon.svelte",
    "Icon.svelte.d.ts",
    "defaultAttributes.js",
    "defaultAttributes.d.ts",
    "context.js",
    "context.d.ts",
  ]) {
    const from = join(srcDist, file);
    if (existsSync(from)) cpSync(from, join(destRoot, file));
  }
  mkdirSync(join(destRoot, "utils"), { recursive: true });
  for (const file of ["hasA11yProp.js", "hasA11yProp.d.ts"]) {
    const from = join(srcDist, "utils", file);
    if (existsSync(from)) cpSync(from, join(destRoot, "utils", file));
  }
  for (const icon of LUCIDE_ICONS) {
    for (const ext of ["svelte", "svelte.d.ts"]) {
      const from = join(srcDist, "icons", `${icon}.${ext}`);
      if (existsSync(from)) cpSync(from, join(destRoot, "icons", `${icon}.${ext}`));
    }
  }
}

/**
 * Rewrite shadcn-svelte component imports to the vendored paths. Idempotent:
 * only rewrites bare `bits-ui` and `@lucide/svelte/icons/*` specifiers that are
 * still present, so re-running after a manual edit is safe.
 */
const BITS_UI_RE = /from\s+["']bits-ui["']/g;
const LUCIDE_RE = /from\s+["']@lucide\/svelte\/icons\/([\w-]+)["']/g;

function rewriteShadcnImports() {
  const uiDir = join(ROOT, "src", "lib", "components", "ui");
  if (!existsSync(uiDir)) return;
  for (const file of readdirSync(uiDir, { recursive: true, withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith(".svelte")) continue;
    const path = join(file.parentPath, file.name);
    const original = readFileSync(path, "utf8");
    const next = original
      .replace(BITS_UI_RE, 'from "$lib/vendor/bits-ui/dist/index.js"')
      .replace(LUCIDE_RE, (_, icon) => `from "$lib/vendor/lucide/icons/${icon}.svelte"`);
    if (next !== original) writeFileSync(path, next, "utf8");
  }
}

// --- run --------------------------------------------------------------------

rmSync(VENDOR, { recursive: true, force: true });
mkdirSync(VENDOR, { recursive: true });

console.log("[vendor-deps] vendoring bits-ui/dist -> src/lib/vendor/bits-ui/dist");
vendorDist("bits-ui");

console.log("[vendor-deps] vendoring @lucide/svelte subset -> src/lib/vendor/lucide");
vendorLucideSubset();

console.log("[vendor-deps] rewriting shadcn-svelte component imports to vendored paths");
rewriteShadcnImports();

console.log("[vendor-deps] done");
