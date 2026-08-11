import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Standalone Vitest config for Storybook component tests (play functions).
// Deliberately separate from vite.config.ts so `vp test` keeps running the
// unit suite only; run with `vp test --config vitest.storybook.config.ts`.
// The storybook project extends this config (svelte plugin + $lib alias) and
// adds the storybookTest plugin, which turns every story into a Vitest test
// rendered in a real browser (Playwright chromium).
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
    },
  },
  test: {
    workspace: [
      {
        extends: true,
        plugins: [storybookTest({ configDir: path.join(dirname, ".storybook") })],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: "playwright",
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
