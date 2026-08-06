import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
    },
  },
  fmt: {
    sortImports: {
      groups: [
        "type-import",
        ["value-builtin", "value-external"],
        "type-internal",
        "value-internal",
        ["type-parent", "type-sibling", "type-index"],
        ["value-parent", "value-sibling", "value-index"],
        "unknown",
      ],
    },
    sortTailwindcss: {
      stylesheet: "src/app.css",
      functions: ["cn"],
    },
    sortPackageJson: true,
  },
  lint: {
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      "eslint-plugin-boundaries",
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "boundaries/no-unknown-dependencies": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            {
              allow: {
                dependency: {
                  relationship: {
                    to: "internal",
                  },
                },
              },
            },
            {
              from: {
                element: {
                  type: "feature",
                },
              },
              allow: {
                to: {
                  element: {
                    type: ["shared", "ui", "server"],
                  },
                },
              },
            },
            {
              from: {
                element: {
                  type: "feature",
                },
              },
              allow: {
                to: {
                  element: {
                    type: "feature",
                    fileInternalPath: "index.ts",
                    captured: {
                      featureName: "!{{ from.element.captured.featureName }}",
                    },
                  },
                },
              },
            },
            {
              from: {
                element: {
                  type: "ui",
                },
              },
              allow: {
                to: {
                  element: {
                    type: "shared",
                  },
                },
              },
            },
            {
              from: {
                element: {
                  type: "server",
                },
              },
              allow: {
                to: {
                  element: {
                    type: "shared",
                  },
                },
              },
            },
            {
              from: {
                element: {
                  type: ["feature", "ui", "server", "shared"],
                },
              },
              allow: {
                to: {
                  file: {
                    categories: "utils",
                  },
                },
              },
            },
            {
              disallow: {
                to: {
                  file: {
                    categories: "test",
                  },
                },
              },
              message: "Do not import test files from production code",
            },
          ],
        },
      ],
    },
    settings: {
      "boundaries/include": ["src/**/*.ts"],
      "boundaries/ignore": [
        "src/background.ts",
        "src/content/**",
        "src/offscreen/**",
        "src/sidebar/**",
      ],
      "boundaries/elements": [
        {
          type: "feature",
          pattern: "src/lib/features/*",
          capture: ["featureName"],
        },
        {
          type: "ui",
          pattern: "src/lib/components/ui/*",
          capture: ["componentName"],
        },
        {
          type: "server",
          pattern: "src/lib/server",
        },
        {
          type: "shared",
          pattern: "src/lib/shared",
        },
      ],
      "boundaries/files": [
        {
          pattern: "**/*.test.ts",
          category: "test",
        },
        {
          pattern: "src/lib/utils.ts",
          category: "utils",
        },
      ],
      "import/resolver": {
        oxc: {
          tsconfig: {
            configFile: "./tsconfig.json",
            references: "auto",
          },
        },
      },
    },
    options: { typeAware: true, typeCheck: false },
  },
});
