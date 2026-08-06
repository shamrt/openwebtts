# OpenWebTTS

A free, open-source text-to-speech web reader for Firefox (Android-first) and Chrome. It reads web pages aloud — generic HTML articles, reader-mode pages, and PDFs — with a page-integrated accordion overlay, a skip-to-section slider with heading markers, saved voice/speed settings, and configurable as-you-read highlighting (`off | paragraph | sentence`).

Built from scratch in TypeScript. Logic is ported from [Read Aloud](https://github.com/ken107/read-aloud) (MIT) with attribution — this is **not** a fork.

## Status

Greenfield, under active development.

## Project structure

Svelte-equivalent of [Bulletproof React](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md), under `src/lib/`:

- `features/<feature>/` — feature slices, each with an `index.ts` public barrel (`+page.svelte` / `+component.svelte` for UI); internal files are private to the feature.
- `components/ui/` — shadcn-svelte primitives (added via the shadcn-svelte CLI).
- `server/` — background / offscreen logic.
- `shared/` — cross-feature types and utilities (`src/lib/utils.ts` holds the shadcn `cn` helper).

## Dev commands

| Command                       | What it does                                                     |
| ----------------------------- | ---------------------------------------------------------------- |
| `pnpm dev`                    | `extension dev` — load the extension in a fresh browser profile. |
| `pnpm build`                  | `extension build` — production artifacts.                        |
| `pnpm check`                  | `vp check` — format + lint + type-aware checks.                  |
| `pnpm test`                   | `vp test` — Vitest.                                              |
| `pnpm lint` / `pnpm lint:fix` | standalone Oxlint.                                               |

## Cross-browser targets & Android

A single `src/manifest.json` drives every target. Browser-specific fields use Extension.js prefixed keys (`chromium:` for Chrome/Edge, `firefox:` for Firefox/Gecko) that are filtered per build into `dist/chrome` and `dist/firefox`.

| Target  | Build                | Dev load                                    |
| ------- | -------------------- | ------------------------------------------- |
| Chrome  | `pnpm build:chrome`  | `pnpm exec extension dev --browser chrome`  |
| Firefox | `pnpm build:firefox` | `pnpm exec extension dev --browser firefox` |

Manifest notes:

- Chrome (MV3) declares `sidePanel` + `offscreen` permissions and `<all_urls>` host permissions; the offscreen document hosts the WASM Piper audio pipeline (Firefox has no `chrome.offscreen` — its event-page background already has DOM access, so the permission is Chromium-only).
- Firefox (MV2) declares `<all_urls>` permissions and a `browser_specific_settings.gecko_android.strict_min_version` (`120.0`) so AMO lists the add-on for Firefox for Android as well as desktop. `gecko.id` is `@openwebtts`.

### Firefox for Android dev loop

Firefox for Android is the primary target. Development on a connected Android device/emulator is via manual `web-ext` sideload (Playwright does not drive Android):

1. Build the Firefox artifact: `pnpm build:firefox`.
2. Install [`web-ext`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/) (`pnpm add -g web-ext`).
3. Push and load it on a USB-debug-enabled device/emulator: `web-ext run --target=firefox-android --source=dist/firefox --adb-device <device-id>`.

Release install on Android is via AMO signing: submit `dist/firefox` to [addons.mozilla.org](https://addons.mozilla.org), then install from the device's Firefox Add-ons listing.

## Attribution

OpenWebTTS reuses the following free/open-source software:

- **[Read Aloud](https://github.com/ken107/read-aloud)** — by Hai Phan, MIT License, Copyright (c) 2016 Hai Phan. Foundational reference; TTS/extraction logic ported with attribution.
- **[Mozilla Readability](https://github.com/mozilla/readability)** (`@mozilla/readability`) — article text extraction. Apache-2.0.
- **[pdf.js](https://github.com/mozilla/pdf.js)** (`pdfjs-dist`) — PDF text extraction. Apache-2.0.
- **[Piper](https://github.com/rhasspy/piper) / VITS** — on-device neural TTS (WASM fallback engine). Piper voice models are CC-BY; each model is attributed individually.
- **[shadcn-svelte](https://github.com/huntabyte/shadcn-svelte)** — overlay UI primitives. MIT.
- **[wikimedia sentencex](https://github.com/wikimedia/sentencex)** — sentence segmentation (WASM build) for sentence-granularity highlighting. MIT.

## Built with

- **[Extension.js](https://extension.js.org/)** — cross-browser extension builder (`extension dev` / `extension build`).
- **[Vite+](https://viteplus.dev/)** (`vite-plus`) — unified lint/format/test toolchain (`vp check`, `vp test`).
- **[Oxlint](https://oxc.rs/)** — linter (replaces ESLint).
- **[Oxfmt](https://oxc.rs/)** — formatter (replaces Prettier), with `sortImports`, `sortTailwindcss`, `sortPackageJson`.

## License

MIT — see [LICENSE](./LICENSE). Reused components retain their original licenses (noted above); Piper voice models are CC-BY.
