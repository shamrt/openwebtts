<script lang="ts">
  import type { ResolvedEngine, Voice } from "$lib/features/tts";
  import type { HighlightMode } from "$lib/features/settings/settings.js";
  import type { HeadingMarker } from "./overlay-store.js";

  import OverlayButton from "./OverlayButton.svelte";

  let {
    playing,
    canBack = false,
    canForward = false,
    chunkText,
    positionPercent,
    headings = [],
    currentHeadingIndex,
    engineKind = "web-speech",
    highlightMode = "paragraph",
    rate = 1,
    volume = 1,
    pitch = 1,
    voices = [],
    voiceUri = "",
    onPlayPause,
    onBack,
    onForward,
    onStop,
    onClose,
    onSeekPercent,
    onEngineChange,
    onHighlightModeChange,
    onRateChange,
    onVolumeChange,
    onPitchChange,
    onVoiceChange,
  }: {
    playing: boolean;
    canBack: boolean;
    canForward: boolean;
    chunkText: string;
    positionPercent: number;
    headings: HeadingMarker[];
    currentHeadingIndex: number | null;
    engineKind: ResolvedEngine;
    highlightMode: HighlightMode;
    rate: number;
    volume: number;
    pitch: number;
    voices: Voice[];
    voiceUri: string;
    onPlayPause: () => void;
    onBack: () => void;
    onForward: () => void;
    onStop: () => void;
    onClose: () => void;
    onSeekPercent: (percent: number) => void;
    onEngineChange: (kind: ResolvedEngine) => void;
    onHighlightModeChange: (mode: HighlightMode) => void;
    onRateChange: (value: number) => void;
    onVolumeChange: (value: number) => void;
    onPitchChange: (value: number) => void;
    onVoiceChange: (voiceUri: string) => void;
  } = $props();

  const engineOptions: { value: ResolvedEngine; label: string }[] = [
    { value: "web-speech", label: "Web Speech" },
    { value: "piper", label: "WASM Piper" },
  ];

  const highlightOptions: { value: HighlightMode; label: string }[] = [
    { value: "off", label: "Off" },
    { value: "paragraph", label: "Paragraph" },
    { value: "sentence", label: "Sentence" },
  ];
</script>

<div class="expanded">
  <section class="section">
    <h3 class="section_title">Playback</h3>
    <div class="row">
      <OverlayButton
        variant="outline"
        ariaLabel="Previous chunk"
        disabled={!canBack}
        onclick={onBack}
      >
        ⏮ Back
      </OverlayButton>
      <OverlayButton onclick={onPlayPause}>
        {playing ? "Pause" : "Play"}
      </OverlayButton>
      <OverlayButton
        variant="outline"
        ariaLabel="Next chunk"
        disabled={!canForward}
        onclick={onForward}
      >
        Next ⏭
      </OverlayButton>
      <OverlayButton variant="outline" onclick={onStop}>
        Stop
      </OverlayButton>
      <OverlayButton variant="ghost" onclick={onClose}>
        Close
      </OverlayButton>
    </div>
    <p class="progress">
      {chunkText.slice(0, 120)}
    </p>
  </section>

  {#if headings.length > 0}
    <section class="section">
      <h3 class="section_title">Navigate</h3>
      <div class="nav">
        <input
          type="range"
          class="range range--nav"
          min="0"
          max="100"
          step="0.1"
          value={positionPercent}
          oninput={(e) =>
            onSeekPercent(
              Number((e.currentTarget as HTMLInputElement).value),
            )}
          aria-label="Skip to section"
          list="openwebtts-heading-markers"
        />
        <datalist id="openwebtts-heading-markers">
          {#each headings as heading}
            <option value={heading.percent} label={heading.text}></option>
          {/each}
        </datalist>
        <div class="nav_readout">
          <span class="nav_heading">
            {#if currentHeadingIndex !== null && headings[currentHeadingIndex]}
              {headings[currentHeadingIndex].text}
            {:else}
              —
            {/if}
          </span>
        </div>
      </div>
    </section>
  {/if}

  <section class="section">
    <h3 class="section_title">Settings</h3>
    <div class="settings">
      <label class="label">
        <span class="label_text">Engine</span>
        <select
          class="select"
          value={engineKind}
          onchange={(e) =>
            onEngineChange(
              (e.currentTarget as HTMLSelectElement)
                .value as ResolvedEngine,
            )}
        >
          {#each engineOptions as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </label>

      <label class="label">
        <span class="label_text">Voice</span>
        <select
          class="select"
          value={voiceUri}
          onchange={(e) =>
            onVoiceChange((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">Default</option>
          {#each voices as voice}
            <option value={voice.voiceUri}
              >{voice.name} ({voice.lang})</option
            >
          {/each}
        </select>
      </label>

      <label class="label">
        <span class="label_text">Highlight</span>
        <select
          class="select"
          value={highlightMode}
          onchange={(e) =>
            onHighlightModeChange(
              (e.currentTarget as HTMLSelectElement)
                .value as HighlightMode,
            )}
        >
          {#each highlightOptions as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </label>

      <label class="label">
        <span class="label_text"
          >Speed {rate.toFixed(2)}x</span
        >
        <input
          type="range"
          class="range"
          min="0.5"
          max="2"
          step="0.05"
          value={rate}
          oninput={(e) =>
            onRateChange(
              Number((e.currentTarget as HTMLInputElement).value),
            )}
        />
      </label>

      <label class="label">
        <span class="label_text"
          >Pitch {pitch.toFixed(2)}</span
        >
        <input
          type="range"
          class="range"
          min="0.5"
          max="2"
          step="0.05"
          value={pitch}
          oninput={(e) =>
            onPitchChange(
              Number((e.currentTarget as HTMLInputElement).value),
            )}
        />
      </label>

      <label class="label">
        <span class="label_text"
          >Volume {volume.toFixed(2)}</span
        >
        <input
          type="range"
          class="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          oninput={(e) =>
            onVolumeChange(
              Number((e.currentTarget as HTMLInputElement).value),
            )}
        />
      </label>
    </div>
  </section>
</div>

<style>
  .expanded {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.25rem;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .progress {
    margin: 0.25rem 0 0;
    font-size: 0.78rem;
    color: var(--muted-foreground, oklch(0.556 0 0));
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .settings {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.6rem;
  }

  .label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8rem;
    color: var(--foreground, oklch(0.145 0 0));
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .section + .section {
    margin-top: 0.25rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border, rgba(0, 0, 0, 0.1));
  }

  .section_title {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted-foreground, oklch(0.556 0 0));
  }

  .label_text {
    display: block;
    margin-bottom: 0.15rem;
    font-size: 0.78rem;
    color: var(--foreground, oklch(0.145 0 0));
  }

  .select {
    pointer-events: auto;
    appearance: none;
    -webkit-appearance: none;
    width: 100%;
    padding: 0.3rem 1.5rem 0.3rem 0.5rem;
    border-radius: 0.375rem;
    border: 1px solid var(--border, rgba(0, 0, 0, 0.18));
    background: var(--background, #fff);
    color: var(--foreground, oklch(0.145 0 0));
    font-size: 0.8rem;
    line-height: 1.2;
    cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%23888' d='M0 0l5 6 5-6z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.55rem center;
    background-size: 0.5rem 0.3rem;
  }

  .select:focus-visible {
    outline: 2px solid var(--ring, oklch(0.708 0 0));
    outline-offset: 2px;
  }

  .select option {
    color: #111;
    background: #fff;
  }

  .range {
    pointer-events: auto;
    width: 100%;
    margin: 0.1rem 0;
    height: 1.25rem;
    background: transparent;
    cursor: pointer;
    accent-color: var(--primary, oklch(0.205 0 0));
  }

  .range:focus-visible {
    outline: 2px solid var(--ring, oklch(0.708 0 0));
    outline-offset: 2px;
  }

  /* Range track + thumb (WebKit + Firefox) — a thin, themed track. */
  .range::-webkit-slider-runnable-track {
    height: 0.25rem;
    border-radius: 9999px;
    background: var(--border, rgba(0, 0, 0, 0.18));
  }

  .range::-moz-range-track {
    height: 0.25rem;
    border-radius: 9999px;
    background: var(--border, rgba(0, 0, 0, 0.18));
  }

  .range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    margin-top: -0.4rem;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    border: none;
    background: var(--primary, oklch(0.205 0 0));
  }

  .range::-moz-range-thumb {
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    border: none;
    background: var(--primary, oklch(0.205 0 0));
  }

  .nav {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .range--nav {
    margin: 0.25rem 0 0;
  }

  .nav_readout {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.78rem;
    color: var(--muted-foreground, oklch(0.556 0 0));
  }

  .nav_heading {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
    color: var(--foreground, oklch(0.145 0 0));
  }
</style>
