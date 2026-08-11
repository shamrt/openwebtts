<script lang="ts">
  import type { Writable } from "svelte/store";

  import type { PlayerProps } from "../types/player-props.js";
  import Player from "./Player.svelte";

  // Thin bridge between the content-script's writable stores (plain TS, no
  // runes) and the presentational Player, which takes plain values and
  // reports every mutation through callbacks. `$store` auto-subscription keeps
  // the overlay re-rendering on store changes.
  //
  // State props arrive as Svelte writable stores; callbacks stay plain
  // functions. `headings` is the one state prop passed through unwrapped.
  type PlayerHostProps = {
    [K in keyof PlayerProps]: K extends `on${string}` | "headings"
      ? PlayerProps[K]
      : Writable<PlayerProps[K]>;
  };
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
  }: PlayerHostProps = $props();
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
