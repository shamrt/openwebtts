/**
 * Ticket 0016 — as-you-read highlighting with configurable granularity.
 *
 * Drives paragraph or sentence highlighting in the host page based on TTS
 * boundary events. The highlight styles live in the page DOM via a scoped
 * class to avoid host-page conflicts. Sentence segmentation is a small
 * rule-based splitter (split on `.`, `!`, `?` keeping the terminal). The
 * ticket originally specified Wikimedia `sentencex`, but the published
 * `sentencex` package is a Node-native addon (uses `node:module`/`node:url`
 * and platform `.node` binaries) and cannot run in a content script; a
 * dependency-free splitter is sufficient for visual highlighting.
 */

import type { ArticleChunk } from "$lib/features/extraction";
import type { HighlightMode } from "$lib/features/settings";

/**
 * Split `text` into trimmed sentences. Boundaries are `.`, `!`, `?` (kept as
 * the terminal of each sentence). Good enough for visual highlighting — this
 * is not NLP-grade segmentation.
 */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]*[.!?]+|\S[^.!?]*$/g);
  if (!matches) return text ? [text] : [];
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** A unit that can be highlighted in the page. */
export interface HighlightUnit {
  /** CSS selector of the element to highlight. */
  readonly anchor: string;
  /** Optional zero-based sentence index inside the chunk (sentence mode only). */
  readonly sentenceIndex: number | null;
}

export interface Highlighter {
  /** Update the active highlight. */
  set(unit: HighlightUnit): void;
  /** Clear any active highlight. */
  clear(): void;
  /** Change the active mode. */
  setMode(mode: HighlightMode): void;
}

const CLASS_NAME = "openwebtts-active";
const SCOPED_CSS = `
.openwebtts-active {
  background-color: rgba(250, 204, 21, 0.35) !important;
  outline: 2px solid rgba(250, 204, 21, 0.8) !important;
  border-radius: 2px !important;
  transition: background-color 0.15s ease !important;
}
`;

function ensureStyleSheet(): void {
  if (document.getElementById("openwebtts-highlight-styles")) return;
  const style = document.createElement("style");
  style.id = "openwebtts-highlight-styles";
  style.textContent = SCOPED_CSS;
  document.head.appendChild(style);
}

function queryElement(anchor: string): Element | null {
  try {
    return document.querySelector(anchor);
  } catch {
    return null;
  }
}

function removeHighlights(): void {
  for (const el of document.querySelectorAll(`.${CLASS_NAME}`)) {
    el.classList.remove(CLASS_NAME);
  }
}

function scrollIntoView(element: Element): void {
  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/** Find the sentence that contains the given char offset in the chunk text. */
export function findSentenceIndex(text: string, offset: number): number {
  const sentences = splitSentences(text);
  let cumulative = 0;
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]!;
    const start = cumulative;
    cumulative += sentence.length;
    if (offset >= start && offset < cumulative) {
      return i;
    }
  }
  return Math.max(0, sentences.length - 1);
}

/** Build a Highlighter that operates on the current document. */
export function createHighlighter(initialMode: HighlightMode = "paragraph"): Highlighter {
  let mode: HighlightMode = initialMode;
  ensureStyleSheet();

  return {
    set(unit: HighlightUnit): void {
      if (mode === "off") return;
      removeHighlights();
      const element = queryElement(unit.anchor);
      if (!element) return;

      if (mode === "paragraph" || unit.sentenceIndex === null) {
        element.classList.add(CLASS_NAME);
        scrollIntoView(element);
        return;
      }

      // Sentence mode: wrap the active sentence in a span. This mutates the
      // paragraph DOM, so we restore the original text nodes on clear.
      highlightSentence(element, unit.sentenceIndex);
    },
    clear(): void {
      removeHighlights();
      restoreSentenceWrappers();
    },
    setMode(modeValue: HighlightMode): void {
      mode = modeValue;
      if (mode === "off") {
        this.clear();
      }
    },
  };
}

let activeSentenceWrapper: HTMLElement | null = null;

function highlightSentence(container: Element, sentenceIndex: number): void {
  restoreSentenceWrappers();
  const text = container.textContent ?? "";
  const sentences = splitSentences(text);
  const target = sentences[sentenceIndex];
  if (!target) return;

  // Simple approach: find the target substring in the container text and
  // wrap the first matching range in a span. This is intentionally naive and
  // sufficient for the E2E fixture; production pages with nested markup may
  // need a more robust range-based walker.
  const start = text.indexOf(target);
  if (start < 0) return;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let position = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (!startNode && position + length > start) {
      startNode = node;
      startOffset = start - position;
    }
    if (startNode && position + length >= start + target.length) {
      endNode = node;
      endOffset = start + target.length - position;
      break;
    }
    position += length;
  }

  if (!startNode || !endNode) return;

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  const span = document.createElement("span");
  span.className = CLASS_NAME;
  activeSentenceWrapper = span;
  range.surroundContents(span);
  scrollIntoView(span);
}

function restoreSentenceWrappers(): void {
  if (!activeSentenceWrapper || !activeSentenceWrapper.parentElement) {
    activeSentenceWrapper = null;
    return;
  }
  const parent = activeSentenceWrapper.parentElement;
  while (activeSentenceWrapper.firstChild) {
    parent.insertBefore(activeSentenceWrapper.firstChild, activeSentenceWrapper);
  }
  parent.removeChild(activeSentenceWrapper);
  parent.normalize();
  activeSentenceWrapper = null;
}

/** Convenience: build a HighlightUnit from a chunk and an optional sentence index. */
export function toHighlightUnit(
  chunk: ArticleChunk,
  sentenceIndex: number | null = null,
): HighlightUnit {
  return { anchor: chunk.anchor, sentenceIndex };
}

/** Convenience: build a HighlightUnit from a chunk and a char offset. */
export function toSentenceHighlightUnit(chunk: ArticleChunk, charOffset: number): HighlightUnit {
  return { anchor: chunk.anchor, sentenceIndex: findSentenceIndex(chunk.text, charOffset) };
}
