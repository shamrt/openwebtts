import { chromium, type BrowserContext } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

import { OverlayPage } from "./pages/overlay-page";

/**
 * Ticket 0020 — Playwright E2E harness for the Extension.js build.
 *
 * Follows the Extension.js "canonical Playwright flow"
 * (https://extension.js.org/docs/workflows/playwright-e2e):
 *   1. Start `extension dev --no-browser` (compiles the extension without
 *      launching a browser; writes dist/extension-js/<browser>/ready.json).
 *   2. Poll ready.json until `status === "ready"` and read `distPath`.
 *   3. Launch Chromium with the unpacked extension loaded from `distPath`.
 *
 * Chromium cannot load unpacked extensions in headless mode, so the browser is
 * launched headed (`headless: false`); CI on Linux must run under `xvfb-run`.
 */

const BROWSER = "chromium";
const ROOT = resolve(process.cwd());
const READY_JSON = join(ROOT, "dist", "extension-js", BROWSER, "ready.json");
const FIXTURES_DIR = resolve(ROOT, "e2e", "fixtures");
const EXTENSION_BIN = join(ROOT, "node_modules", "extension", "bin", "extension.cjs");

interface ReadyJson {
  status: string;
  distPath: string;
}

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(() => resolve(), ms);
  return promise;
}

/** Poll the Extension.js readiness contract until the build is ready. */
async function waitForReady(timeoutMs = 90_000): Promise<ReadyJson> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const json = JSON.parse(await readFile(READY_JSON, "utf8")) as ReadyJson;
      if (json.status === "ready" && json.distPath) return json;
    } catch {
      // ready.json is not written until the first compile finishes.
    }
    if (Date.now() > deadline) {
      throw new Error(`extension dev did not reach ready within ${timeoutMs}ms`);
    }
    await delay(250);
  }
}

/** Tiny static server for the E2E fixture pages (content scripts match <all_urls>). */
function startFixtureServer(root: string): Promise<Server> {
  const types: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };
  const { promise, resolve } = Promise.withResolvers<Server>();
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const file = url === "/" ? "article.html" : url;
    try {
      const body = await readFile(join(root, file));
      res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  server.listen(0, "127.0.0.1", () => resolve(server));
  return promise;
}

/** Close a server, dropping open keep-alive connections first so teardown is prompt. */
function closeServer(server: Server): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  server.closeAllConnections();
  server.close(() => resolve());
  return promise;
}

/** Kill a process and any children it spawned (Extension.js forks toolchain workers). */
function killTree(proc: ChildProcess): void {
  try {
    proc.kill("SIGTERM");
  } catch {
    // already dead
  }
}

export const test = base.extend<{ serverUrl: string; overlayPage: OverlayPage }>({
  // Override the default context with a persistent Chromium context that has
  // the Extension.js build loaded as an unpacked extension.
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures require a destructured first arg; this one has no deps.
  context: async ({}, use) => {
    // --no-reload strips the content-script hot-reload runtime: with HMR on, a
    // mid-test re-injection disposes the mounted overlay (rootDiv.remove) and
    // remounts a fresh, inactive one — the overlay flashes then vanishes, so
    // post-activate interactions race a disappearing DOM. E2E never edits
    // source mid-run, so live reload buys nothing here.
    const dev = spawn(
      process.execPath,
      [EXTENSION_BIN, "dev", "--no-browser", "--no-reload", `--browser=${BROWSER}`],
      {
        cwd: ROOT,
        stdio: "ignore",
        env: process.env,
      },
    );
    try {
      const { distPath } = await waitForReady();
      const profile = mkdtempSync(join(tmpdir(), "owt-e2e-"));
      const context = await chromium.launchPersistentContext(profile, {
        headless: false,
        args: [
          `--disable-extensions-except=${distPath}`,
          `--load-extension=${distPath}`,
          "--no-first-run",
          "--no-default-browser-check",
        ],
      });
      await use(context);
      await context.close();
    } finally {
      killTree(dev);
    }
  },

  // A local HTTP origin for the fixture pages so content scripts (which match
  // <all_urls>) inject without file:// access-permission caveats.
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures require a destructured first arg; this one has no deps.
  serverUrl: async ({}, use) => {
    const server = await startFixtureServer(FIXTURES_DIR);
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    await use(`http://127.0.0.1:${port}`);
    await closeServer(server);
  },

  // Page Object Model for the overlay — wraps fixture navigation, activation,
  // and the highlight test seams so specs stay declarative. serverUrl is an
  // internal dependency here; tests destructure only { overlayPage }.
  overlayPage: async ({ page, serverUrl }, use) => {
    await use(new OverlayPage(page, serverUrl));
  },
});

export { expect };
export type { BrowserContext };
