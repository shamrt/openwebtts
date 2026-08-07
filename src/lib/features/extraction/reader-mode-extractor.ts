/**
 * Ticket 0009 — reader-mode / paywall extraction.
 *
 * Many publishers (Medium, NYT, Substack) and AMP pages expose a reader-mode
 * container that holds the unlocked article body, separate from nav and
 * paywall boilerplate. When such a container is present we segment only it,
 * so spoken chunks come from article prose rather than "Subscribe to continue"
 * prompts. When no reader container is detected we fall back to the generic
 * {@link extractArticle} (Mozilla Readability over the full DOM).
 *
 * Output feeds [[0011-track-reading-position-and-progress]] and
 * [[0016-as-you-read-highlighting-configurable-granularity]].
 */

import { extractArticle, segmentElement, type ExtractedArticle } from "./html-extractor.js";

/** A hostname matcher paired with the reader-mode selectors to try, in order. */
interface ReaderStrategy {
  /** Returns true when the strategy applies to the given hostname. */
  match: (hostname: string) => boolean;
  /** Selectors tried in order; the first match wins. */
  selectors: string[];
}

/**
 * Site-specific reader-mode / AMP container strategies.
 *
 * Selectors are ordered most-specific first; the first selector that matches
 * an element wins. Boilerplate (paywall prompts, nav) lives outside these
 * containers and is therefore excluded from segmentation.
 */
const siteStrategies: readonly ReaderStrategy[] = [
  {
    match: (host) => host === "medium.com" || host.endsWith(".medium.com"),
    selectors: [
      'article section[name="postContent"]',
      'div[data-testid="storyContent"]',
      "article",
    ],
  },
  {
    match: (host) => host === "nytimes.com" || host.endsWith(".nytimes.com"),
    selectors: ['section[name="articleBody"]', "section#story", "div.g-body"],
  },
  {
    match: (host) => host.endsWith(".substack.com"),
    selectors: [".available-content", ".body.markup", "div.post-content"],
  },
];

/** AMP selectors, tried on any document whose `<html>` is marked `amp`/`⚡`. */
const ampSelectors = ["amp-story", "article", 'div[role="article"]'];

/** Return the first element matching any selector in `selectors`, else null. */
function firstMatch(doc: Document, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (el) return el;
  }
  return null;
}

/**
 * Detect a site-specific reader-mode / AMP container in `doc`, or `null`.
 *
 * Hostname is read from `doc.location?.hostname`. Site strategies are tried
 * first; if none match, an AMP document (whose `<html>` carries an `amp` or
 * `⚡` attribute) is detected generically.
 */
export function detectReaderContainer(doc: Document): Element | null {
  const hostname = doc.location?.hostname ?? "";
  for (const strategy of siteStrategies) {
    if (strategy.match(hostname)) {
      const el = firstMatch(doc, strategy.selectors);
      if (el) return el;
    }
  }
  const html = doc.documentElement;
  if (html?.hasAttribute("amp") || html?.hasAttribute("⚡")) {
    return firstMatch(doc, ampSelectors);
  }
  return null;
}

/**
 * Extract the article using the reader-mode/AMP container when present, else
 * the Readability fallback over the full DOM.
 *
 * When a container is found but yields zero chunks (e.g. empty placeholder),
 * the Readability fallback runs so the reader still gets the article prose.
 * The title is taken from `document.title`, falling back to the first heading
 * in the container, then to `"Article"`.
 */
export function extractReaderMode(): ExtractedArticle | null {
  const doc = document;
  const container = detectReaderContainer(doc);
  if (container) {
    const chunks = segmentElement(container, doc);
    if (chunks.length > 0) {
      const firstHeading = chunks.find((c) => c.headingLevel !== null);
      const title = doc.title || firstHeading?.headingText || "Article";
      return { title, chunks };
    }
  }
  return extractArticle();
}
