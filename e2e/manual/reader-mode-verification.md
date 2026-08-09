# Reader-mode / paywall extraction — manual E2E verification

## Purpose

Manually confirm that the reader-mode extractor (ticket 0009) pulls speakable
chunks from each publisher's **reader-mode / AMP container** rather than from
paywall prompts, nav, or footer boilerplate. This complements the automated
fixture tests in `src/lib/features/extraction/reader-mode-extractor.test.ts`,
which run against saved HTML snapshots.

> **Scope:** Only already-unlocked, publicly readable reader-mode content is
> verified here. **Paywall bypass is explicitly out of scope.** If an article
> is gated, stop and pick a different unlocked URL — do not attempt to defeat
> the paywall.

## Steps

1. Open one of the verification URLs below in Chrome (a fresh profile avoids
   signed-in personalization).
2. Trigger the OpenWebTTS extension (click the toolbar icon to open the overlay).
3. Inspect the extracted chunks shown in the overlay:
   - Chunks should come from the article body (reader-mode / AMP container).
   - Chunk text must **not** include "Subscribe to continue", "Sign in",
     nav labels ("World", "Archive", etc.), or footer links.
   - Headings should be marked with the correct heading level.
4. Press play and confirm speech starts on the first article paragraph, not on
   nav or a paywall prompt.
5. If available, also open the site's AMP variant (Medium `/amp/`) and confirm
   the AMP path is detected and segmented.
6. Record pass/fail per URL in the table below.

## Verification URLs

| Site     | URL                                                                        | Variant / notes                                              |
| -------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Medium   | https://medium.com/@bloggins/on-slow-reading-abc123                        | Standard reader article                                      |
| Medium   | https://medium.com/@bloggins/on-slow-reading-abc123/amp/                   | AMP variant (`<html amp>`)                                   |
| NYT      | https://www.nytimes.com/2024/03/12/magazine/the-quiet-return-of-print.html | Unlocked article (reader-mode `section[name="articleBody"]`) |
| Substack | https://thequietletter.substack.com/p/notes-on-attention                   | Public post (`.available-content` container)                 |

Replace the placeholder slugs above with live, unlocked public articles at
verification time. The exact URLs are not pinned because publishers rotate
content; the selectors and hostname matchers are what the test guards.

## Expected detection

| Hostname                             | Reader container selector (first match wins)                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| `medium.com` / `*.medium.com`        | `article section[name="postContent"]` → `div[data-testid="storyContent"]` → `article` |
| `nytimes.com` / `*.nytimes.com`      | `section[name="articleBody"]` → `section#story` → `div.g-body`                        |
| `*.substack.com`                     | `.available-content` → `.body.markup` → `div.post-content`                            |
| any host, `<html amp>` / `<html ⚡>` | `amp-story` → `article` → `div[role="article"]`                                       |
| (no match)                           | Readability fallback over the full DOM                                                |
