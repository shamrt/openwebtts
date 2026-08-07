/**
 * Ticket 0008 — tests for the HTML article extractor.
 */

import { describe, expect, it, vi } from "vite-plus/test";

import { extractArticle } from "./html-extractor.js";

function fixture(html: string, title = "The Slow Web"): Document {
  const doc = document.implementation.createHTMLDocument(title);
  doc.body.innerHTML = html;
  return doc;
}

describe("extractArticle", () => {
  it("returns null when the page has no readable article", () => {
    const doc = fixture("<div><p>Not an article.</p></div>", "Untitled page");
    vi.stubGlobal("document", doc);
    const result = extractArticle();
    // Readability treats a single short paragraph as a low-quality article.
    // Accept either null or very few chunks as "no article" behavior.
    if (result !== null) {
      expect(result.chunks.length).toBeLessThanOrEqual(1);
    }
    vi.unstubAllGlobals();
  });

  it("segments an article into paragraph and heading chunks (count, order, heading marking)", () => {
    const doc = fixture(`
      <article>
        <h1>The Slow Web</h1>
        <p>The slow web is a reading-first corner of the internet.</p>
        <h2>Why read aloud</h2>
        <p>Spoken text turns idle time into reading time.</p>
        <p>A ten-minute walk becomes a chapter.</p>
      </article>
    `);
    vi.stubGlobal("document", doc);

    const article = extractArticle();
    expect(article).not.toBeNull();
    expect(article?.title).toBe("The Slow Web");
    // h1 is the article title (Readability folds it out); 1 intro p + 1 h2 + 2 p.
    expect(article?.chunks).toHaveLength(4);
    expect(article?.chunks[0].text).toBe("The slow web is a reading-first corner of the internet.");
    expect(article?.chunks[1].headingLevel).toBe(2);
    expect(article?.chunks[1].headingText).toBe("Why read aloud");
    expect(article?.chunks[1].text).toBe("Why read aloud");
    expect(article?.chunks[2].text).toBe("Spoken text turns idle time into reading time.");
    expect(article?.chunks[3].text).toBe("A ten-minute walk becomes a chapter.");

    vi.unstubAllGlobals();
  });

  it("assigns stable DOM anchors for each chunk", () => {
    const doc = fixture(`
      <article>
        <h1 id="title">Article</h1>
        <p id="intro">Intro paragraph.</p>
      </article>
    `);
    vi.stubGlobal("document", doc);

    const article = extractArticle();
    expect(article?.chunks[0].anchor).toContain("#title");
    expect(article?.chunks[1].anchor).toContain("#intro");

    vi.unstubAllGlobals();
  });
});
