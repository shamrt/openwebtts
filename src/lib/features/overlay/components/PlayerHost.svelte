<script lang="ts">
  import type { ResolvedEngine, Voice } from "$lib/features/tts";
  import type { HighlightMode } from "$lib/features/settings";
  import type { Writable } from "svelte/store";

  import type { HeadingMarker } from "../store.js";
  import Player from "./Player.svelte";

  // Thin bridge between the content-script's writable stores (plain TS, no
  // runes) and the presentational Player, which takes plain values and
  // reports every mutation through callbacks. `$store` auto-subscription keeps
  // the overlay re-rendering on store changes.
  let {
    activated,
    expanded,
    playing,
    engineKind,
    highlightMode,
    rate,
    volume,
    pitch,
    voices,
    voiceUri,
    positionPercent,
    chunkText,
    headings,
    currentHeadingIndex,
    canBack,
    canForward,
    onPlayPause,
    onToggleExpanded,
    onStop,
    onSeekPercent,
    onBack,
    onForward,
    onEngineChange,
    onHighlightModeChange,
    onRateChange,
    onVolumeChange,
    onPitchChange,
    onVoiceChange,
    onClose,
  }: {
    expanded: Writable<boolean>;
    activated: Writable<boolean>;
    playing: Writable<boolean>;
    engineKind: Writable<ResolvedEngine>;
    highlightMode: Writable<HighlightMode>;
    rate: Writable<number>;
    volume: Writable<number>;
    pitch: Writable<number>;
    voices: Writable<Voice[]>;
    voiceUri: Writable<string>;
    positionPercent: Writable<number>;
    chunkText: Writable<string>;
    headings: HeadingMarker[];
    currentHeadingIndex: Writable<number | null>;
    canBack: Writable<boolean>;
    canForward: Writable<boolean>;
    onPlayPause: () => void;
    onToggleExpanded: () => void;
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

<Player
  activated={$activated}
  expanded={$expanded}
  playing={$playing}
  engineKind={$engineKind}
  highlightMode={$highlightMode}
  rate={$rate}
  volume={$volume}
  pitch={$pitch}
  voices={$voices}
  voiceUri={$voiceUri}
  positionPercent={$positionPercent}
  chunkText={$chunkText}
  {headings}
  currentHeadingIndex={$currentHeadingIndex}
  canBack={$canBack}
  canForward={$canForward}
  {onPlayPause}
  {onToggleExpanded}
  {onStop}
  {onSeekPercent}
  {onBack}
  {onForward}
  {onEngineChange}
  {onHighlightModeChange}
  {onRateChange}
  {onVolumeChange}
  {onPitchChange}
  {onVoiceChange}
  {onClose}
/>
