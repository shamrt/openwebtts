/**
 * Ticket 0009 — tests for reader-mode / paywall extraction.
 *
 * Verifies that site-specific reader-mode / AMP containers are preferred over
 * the full DOM, that paywall/nav boilerplate is excluded, and that pages
 * without a reader container fall back to the Readability extractor.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { detectReaderContainer, extractReaderMode } from "./reader-mode-extractor.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/reader-mode",
);

/** Read a saved reader-mode fixture as an HTML string. */
function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, `${name}.html`), "utf8");
}

/**
 * Parse a full HTML document and expose a `location.hostname` for site
 * strategy matching. jsdom marks `Document.location` as an unforgeable
 * accessor (neither `=` nor `defineProperty` can replace it), so we wrap the
 * real document in a proxy that returns a synthetic location while
 * delegating every other property — including `querySelector`,
 * `createTreeWalker`, `body`, and `title` — to the underlying document.
 */
function loadDoc(html: string, hostname: string): Document {
  const target = new DOMParser().parseFromString(html, "text/html");
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "location") return { hostname } as unknown as Location;
      const value = Reflect.get(t, prop, t);
      return typeof value === "function" ? (value.bind(t) as unknown) : value;
    },
  }) as unknown as Document;
}

/** Concatenate chunk text for substring assertions. */
function joinText(chunks: readonly { text: string }[]): string {
  return chunks.map((c) => c.text).join("\n");
}

describe("detectReaderContainer", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("finds the Medium postContent section", () => {
    const doc = loadDoc(readFixture("medium"), "medium.com");
    const el = detectReaderContainer(doc);
    expect(el).not.toBeNull();
    expect(el?.tagName.toLowerCase()).toBe("section");
    expect(el?.getAttribute("name")).toBe("postContent");
  });

  it("finds the NYT articleBody section", () => {
    const doc = loadDoc(readFixture("nytimes"), "www.nytimes.com");
    const el = detectReaderContainer(doc);
    expect(el).not.toBeNull();
    expect(el?.tagName.toLowerCase()).toBe("section");
    expect(el?.getAttribute("name")).toBe("articleBody");
  });

  it("finds the Substack available-content container", () => {
    const doc = loadDoc(readFixture("substack"), "thequietletter.substack.com");
    const el = detectReaderContainer(doc);
    expect(el).not.toBeNull();
    expect(el?.classList.contains("available-content")).toBe(true);
  });

  it("returns null when no reader-mode container is present", () => {
    const doc = loadDoc(readFixture("no-reader-mode"), "example.com");
    expect(detectReaderContainer(doc)).toBeNull();
  });

  it("prefers the AMP article on an amp-marked document", () => {
    const html = `<!doctype html><html amp lang="en"><head><title>AMP Story</title></head>
      <body>
        <nav><a>Home</a><a>Sections</a></nav>
        <article>
          <h1>AMP Article</h1>
          <p>This article is served as an AMP page.</p>
          <p>AMP markup uses a specialized HTML subset.</p>
        </article>
        <div class="promo">Download our app for more.</div>
      </body></html>`;
    const doc = loadDoc(html, "amp.example.com");
    const el = detectReaderContainer(doc);
    expect(el).not.toBeNull();
    expect(el?.tagName.toLowerCase()).toBe("article");
  });
});

describe("extractReaderMode", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("extracts Medium reader content, excluding paywall and nav", () => {
    const doc = loadDoc(readFixture("medium"), "medium.com");
    vi.stubGlobal("document", doc);

    const result = extractReaderMode();
    expect(result).not.toBeNull();
    expect(result?.title).toBe("On Slow Reading — Medium");
    // h1 + 2 paragraphs from section[name="postContent"].
    expect(result?.chunks).toHaveLength(3);
    const text = joinText(result?.chunks ?? []);
    expect(text).toContain("Slow reading is the practice of savoring each sentence.");
    expect(text).toContain("It resists the scroll and rewards attention.");
    expect(text).not.toContain("Subscribe to continue reading.");
    expect(text).not.toContain("Sign in");
    // The h1 is marked as a level-1 heading.
    const h1 = result?.chunks.find((c) => c.headingLevel === 1);
    expect(h1).toBeDefined();
    expect(h1?.headingText).toBe("On Slow Reading");
  });

  it("extracts NYT reader content, excluding paywall and nav", () => {
    const doc = loadDoc(readFixture("nytimes"), "www.nytimes.com");
    vi.stubGlobal("document", doc);

    const result = extractReaderMode();
    expect(result).not.toBeNull();
    // h1 + 3 paragraphs from section[name="articleBody"].
    expect(result?.chunks).toHaveLength(4);
    const text = joinText(result?.chunks ?? []);
    expect(text).toContain("Print is not dead; it is merely resting.");
    expect(text).not.toContain("Already a subscriber? Log in to continue.");
    expect(text).not.toContain("World");
  });

  it("extracts Substack reader content, excluding paywall and nav", () => {
    const doc = loadDoc(readFixture("substack"), "thequietletter.substack.com");
    vi.stubGlobal("document", doc);

    const result = extractReaderMode();
    expect(result).not.toBeNull();
    // h1 + 2 paragraphs from .available-content.
    expect(result?.chunks).toHaveLength(3);
    const text = joinText(result?.chunks ?? []);
    expect(text).toContain("Attention is the rarest resource we have.");
    expect(text).not.toContain("Subscribe to read the rest of this post.");
    expect(text).not.toContain("Archive");
  });

  it("falls back to Readability when no reader container is present", () => {
    const doc = loadDoc(readFixture("no-reader-mode"), "example.com");
    vi.stubGlobal("document", doc);

    const result = extractReaderMode();
    expect(result).not.toBeNull();
    const text = joinText(result?.chunks ?? []);
    expect(text).toContain("It should fall back to the Readability extractor.");
    // Nav boilerplate is not part of the readable article.
    expect(text).not.toContain("Home");
  });

  it("extracts AMP article content, excluding nav and promo", () => {
    const html = `<!doctype html><html amp lang="en"><head><title>AMP Story</title></head>
      <body>
        <nav><a>Home</a><a>Sections</a></nav>
        <article>
          <h1>AMP Article</h1>
          <p>This article is served as an AMP page.</p>
          <p>AMP markup uses a specialized HTML subset.</p>
        </article>
        <div class="promo">Download our app for more.</div>
      </body></html>`;
    const doc = loadDoc(html, "amp.example.com");
    vi.stubGlobal("document", doc);

    const result = extractReaderMode();
    expect(result).not.toBeNull();
    expect(result?.chunks).toHaveLength(3);
    const text = joinText(result?.chunks ?? []);
    expect(text).toContain("This article is served as an AMP page.");
    expect(text).not.toContain("Download our app for more.");
    expect(text).not.toContain("Sections");
  });
});
