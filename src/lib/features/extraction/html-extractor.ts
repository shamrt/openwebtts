/**
 * Ticket 0008 — extract generic HTML article content into speakable chunks.
 *
 * Uses Mozilla `@mozilla/readability` to get the article body, then segments it
 * into chunks at paragraph/heading boundaries. Each chunk carries its original
 * DOM anchor and heading level so the overlay can navigate by structure and
 * highlight the active unit.
 *
 * Output feeds [[0011-track-reading-position-and-progress]] and
 * [[0016-as-you-read-highlighting-configurable-granularity]].
 */

import { Readability } from "@mozilla/readability";

/** A speakable chunk of an article. Shared chunk model for all extractors. */
export interface ArticleChunk {
  /** 0-based index in reading order. */
  readonly index: number;
  /** Plain text to speak. */
  readonly text: string;
  /**
   * Anchor pointing back to the source. For HTML this is a CSS selector
   * resolvable against the host `document`; for non-DOM sources (e.g. PDF) it
   * is a synthetic string such as `pdf:page=2`.
   */
  readonly anchor: string;
  /** Heading level if this chunk begins a heading, otherwise `null`. */
  readonly headingLevel: number | null;
  /** The chunk's own heading text, if it is a heading. */
  readonly headingText: string | null;
}

/** Result of extracting an article. */
export interface ExtractedArticle {
  /** Article title, if the extractor found one. */
  readonly title: string;
  /** Speakable chunks in reading order. */
  readonly chunks: readonly ArticleChunk[];
}

/** Heading level for a tag name, or `null` when the tag is not a heading. */
function headingLevel(tag: string): number | null {
  const match = /^H([1-6])$/i.exec(tag);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

/**
 * Build a stable CSS selector for an element relative to `doc.body`.
 *
 * Exported for the reader-mode extractor, which segments a sub-region of the
 * page using the same anchor scheme as the generic extractor.
 */
export function buildAnchor(element: Element, doc: Document = document): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== doc.body) {
    const tag = current.tagName.toLowerCase();
    const id = current.id ? `#${CSS.escape(current.id)}` : "";
    const index = current.parentElement
      ? Array.from(current.parentElement.children)
          .filter((c) => c.tagName === current!.tagName)
          .indexOf(current) + 1
      : 0;
    const nth = index > 1 ? `:nth-of-type(${index})` : "";
    parts.unshift(`${tag}${id}${nth}`);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

/**
 * Walk `root` in document order, emitting one chunk per paragraph or heading.
 * `doc` supplies the TreeWalker factory and the `body` the anchor is rooted at.
 */
export function segmentElement(root: Element, doc: Document = document): ArticleChunk[] {
  const chunks: ArticleChunk[] = [];
  let chunkIndex = 0;

  function addChunk(
    text: string,
    element: Element,
    level: number | null,
    headingText: string | null,
  ): void {
    if (!text.trim()) return;
    chunks.push({
      index: chunkIndex++,
      text: text.trim(),
      anchor: buildAnchor(element, doc),
      headingLevel: level,
      headingText,
    });
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;
      if (el.tagName === "P" || headingLevel(el.tagName) !== null) {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const el = node as HTMLElement;
    const tag = el.tagName;
    const text = el.textContent ?? "";
    const level = headingLevel(tag);
    if (level !== null) {
      addChunk(text, el, level, text.trim() || null);
    } else if (tag === "P") {
      addChunk(text, el, null, null);
    }
  }
  return chunks;
}

/**
 * Extract the readable article from the current document and split it into
 * speakable chunks.
 *
 * Safe to call in a content-script context where `document` exists. If
 * Readability cannot parse the page, returns `null`.
 */
export function extractArticle(): ExtractedArticle | null {
  const documentClone = document.cloneNode(true) as Document;
  const reader = new Readability(documentClone);
  const article = reader.parse();
  if (!article) return null;

  const container = document.createElement("div");
  container.innerHTML = article.content;

  return { title: article.title, chunks: segmentElement(container, document) };
}
