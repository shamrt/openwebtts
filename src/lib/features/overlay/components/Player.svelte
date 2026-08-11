<script lang="ts">
  import type { ResolvedEngine, Voice } from "$lib/features/tts";
  import type { HighlightMode } from "$lib/features/settings";
  import type { HeadingMarker } from "../store.js";

  import Handle from "./Handle.svelte";
  import Collapsed from "./Collapsed.svelte";
  import Expanded from "./Expanded.svelte";

  // Presentational shell: owns the accordion state (activated/expanded) and
  // forwards the remaining props to the region components via rest spread.
  let {
    activated,
    expanded,
    positionPercent,
    onToggleExpanded,
    ...rest
  }: {
    activated: boolean;
    expanded: boolean;
    positionPercent: number;
    onToggleExpanded: () => void;
    playing: boolean;
    engineKind: ResolvedEngine;
    highlightMode: HighlightMode;
    rate: number;
    volume: number;
    pitch: number;
    voices: Voice[];
    voiceUri: string;
    chunkText: string;
    headings: HeadingMarker[];
    currentHeadingIndex: number | null;
    canBack: boolean;
    canForward: boolean;
    onPlayPause: () => void;
    onStop: () => void;
    onSeekPercent: (percent: number) => void;
    onBack: () => void;
    onForward: () => void;
    onEngineChange: (kind: ResolvedEngine) => void;
    onHighlightModeChange: (mode: HighlightMode) => void;
    onRateChange: (value: number) => void;
    onVolumeChange: (value: number) => void;
    onPitchChange: (value: number) => void;
    onVoiceChange: (voiceUri: string) => void;
    onClose: () => void;
  } = $props();
</script>

{#if activated}
  <div class="container" class:container--expanded={expanded}>
    <Handle {expanded} {positionPercent} {onToggleExpanded} />
    {#if !expanded}
      <Collapsed {...rest} />
    {/if}
    {#if expanded}
      <Expanded positionPercent={positionPercent} {...rest} />
    {/if}
  </div>
{/if}

<style>
  .container {
    /* Fixed bottom-right shell; the shadow root isolates stacking. */
    position: fixed;
    right: 0.75rem;
    bottom: 0.75rem;
    z-index: 2147483647; /* above page content */
    pointer-events: none; /* collapsed shell is non-intrusive by default */
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: min(22rem, 90vw);
    max-width: 22rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.75rem;
    background: var(--card, #fff);
    color: var(--card-foreground, #111);
    border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
    box-shadow:
      0 10px 30px rgba(0, 0, 0, 0.18),
      0 2px 8px rgba(0, 0, 0, 0.1);
    font-family:
      "Inter Variable",
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      Roboto,
      "Helvetica Neue",
      Arial,
      "Noto Sans",
      sans-serif;
    font-size: 0.85rem;
    line-height: 1.25;
  }

  /* Expanded state widens the shell and lets the settings panel capture events. */
  .container--expanded {
    pointer-events: auto;
    width: min(26rem, 92vw);
  }
</style>
