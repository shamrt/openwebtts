# OpenWebTTS

A free, open-source text-to-speech web reader for Firefox (Android-first) and Chrome. It reads web pages aloud — generic HTML articles, reader-mode pages, and PDFs — with a page-integrated accordion overlay, a skip-to-section slider with heading markers, saved voice/speed settings, and configurable as-you-read highlighting (`off | paragraph | sentence`).

Built from scratch in TypeScript. Logic is ported from [Read Aloud](https://github.com/ken107/read-aloud) (MIT) with attribution — this is **not** a fork.

## Status

Greenfield. The ticket backlog lives in the Obsidian vault at `~/notes/Obsidian/Vault/dev/ideas/tts-extension/tickets/` (see the development plan at `../development-plan.md`).

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
