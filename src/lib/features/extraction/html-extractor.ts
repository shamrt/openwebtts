/**
 * Ticket 0008 — extract generic HTML article content into speakable chunks.
 *
 * Uses Mozilla @mozilla/readability to get the article body, then segments it
 * into chunks at paragraph/heading boundaries. Each chunk carries its original
 * DOM anchor and heading level so the overlay can navigate by structure and
 * highlight the active unit.
 */

import { Readability } from "@mozilla/readability";

/** A speakable chunk of the article. */
export interface ArticleChunk {
  /** 0-based index in reading order. */
  readonly index: number;
  /** Plain text to speak. */
  readonly text: string;
  /** CSS selector pointing to the source element in the host page. */
  readonly anchor: string;
  /** Heading level if this chunk begins a heading, otherwise `null`. */
  readonly headingLevel: number | null;
  /** The chunk's own heading text, if it is a heading. */
  readonly headingText: string | null;
}

/** Result of extracting an article. */
export interface ExtractedArticle {
  /** Article title, if Readability found one. */
  readonly title: string;
  /** Speakable chunks in reading order. */
  readonly chunks: readonly ArticleChunk[];
}

const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

function headingLevel(tag: string): number | null {
  const match = /^H([1-6])$/i.exec(tag);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

/** Build a stable CSS selector for an element relative to `document.body`. */
function buildAnchor(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body) {
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

  const chunks: ArticleChunk[] = [];
  let chunkIndex = 0;

  function addChunk(
    text: string,
    _element: Element,
    headingLevelValue: number | null,
    headingTextValue: string | null,
  ): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Readability parses a detached clone, so the walker's `element` lives in a
    // detached container and its `buildAnchor` selector would not resolve in the
    // live document. Match the chunk back to a live page element by text and
    // build the anchor from THAT so the highlighter can find it.
    const live = findLiveElement(trimmed);
    chunks.push({
      index: chunkIndex++,
      text: trimmed,
      anchor: live ? buildAnchor(live) : "",
      headingLevel: headingLevelValue,
      headingText: headingTextValue,
    });
  }

  function findLiveElement(text: string): Element | null {
    const candidates = document.querySelectorAll("p, h1, h2, h3, h4, h5, h6");
    for (const candidate of candidates) {
      if ((candidate.textContent ?? "").trim() === text) return candidate;
    }
    return null;
  }

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;
      if (el.tagName === "P" || HEADING_TAGS.has(el.tagName)) {
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

    if (HEADING_TAGS.has(tag)) {
      addChunk(text, el, headingLevel(tag), text.trim() || null);
    } else if (tag === "P") {
      addChunk(text, el, null, null);
    }
  }

  return { title: article.title, chunks };
}

/** Convenience: extract only the chunk list. */
export function extractChunks(): readonly ArticleChunk[] {
  return extractArticle()?.chunks ?? [];
}

/** Convenience: total number of chunks. */
export function chunkCount(): number {
  return extractChunks().length;
}
