<script lang="ts">
  import type { ResolvedEngine, Voice } from "$lib/features/tts";
  import type { HighlightMode } from "$lib/features/settings/settings.js";
  import type { Writable } from "svelte/store";

  import type { HeadingMarker } from "./overlay-store.js";

  let {
    activated,
    expanded,
    playing,
    engineKind = writable("web-speech"),
    highlightMode = writable("paragraph"),
    rate = writable([1]),
    volume = writable([1]),
    pitch = writable([1]),
    voices = writable<Voice[]>([]),
    voiceUri = writable(""),
    positionPercent,
    chunkText,
    headings = [],
    currentHeadingIndex,
    onPlayPause,
    onToggleExpanded,
    onStop,
    onSeek,
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
    rate: Writable<number[]>;
    volume: Writable<number[]>;
    pitch: Writable<number[]>;
    voices: Writable<Voice[]>;
    voiceUri: Writable<string>;
    positionPercent: Writable<number>;
    chunkText: Writable<string>;
    headings: HeadingMarker[];
    currentHeadingIndex: Writable<number | null>;
    onPlayPause: () => void;
    onToggleExpanded: () => void;
    onStop: () => void;
    onSeek: (chunkIndex: number) => void;
    onEngineChange: (kind: ResolvedEngine) => void;
    onHighlightModeChange: (mode: HighlightMode) => void;
    onRateChange: (value: number) => void;
    onVolumeChange: (value: number) => void;
    onPitchChange: (value: number) => void;
    onVoiceChange: (voiceUri: string) => void;
    onClose: () => void;
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

{#if $activated}
<div class="overlay_root" class:overlay_root--expanded={$expanded}>
  <div
    class="overlay_handle"
    role="button"
    tabindex="0"
    aria-label="Toggle OpenWebTTS overlay"
    onclick={onToggleExpanded}
    onkeydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggleExpanded();
      }
    }}
  >
    <span class="overlay_title">OpenWebTTS</span>
    <span class="overlay_percent">{$positionPercent.toFixed(1)}%</span>
  </div>

  <div class="overlay_collapsed" class:hidden={$expanded}>
    <button
      type="button"
      class="overlay_btn overlay_btn--icon"
      onclick={onPlayPause}
      aria-label={$playing ? "Pause" : "Play"}
    >
      {$playing ? "⏸" : "▶"}
    </button>
    <button
      type="button"
      class="overlay_btn overlay_btn--icon"
      onclick={onStop}
      aria-label="Stop"
    >
      ⏹
    </button>
    <span class="overlay_snippet">{$chunkText.slice(0, 60)}</span>
  </div>

  {#if $expanded}
    <div class="overlay_expanded">
      <section class="overlay_section">
        <h3 class="overlay_section_title">Playback</h3>
        <div class="overlay_row">
          <button type="button" class="overlay_btn" onclick={onPlayPause}>
            {$playing ? "Pause" : "Play"}
          </button>
          <button type="button" class="overlay_btn overlay_btn--outline" onclick={onStop}>
            Stop
          </button>
          <button type="button" class="overlay_btn overlay_btn--ghost" onclick={onClose}>
            Close
          </button>
        </div>
        <p class="overlay_progress">{$positionPercent.toFixed(1)}% — {$chunkText.slice(0, 120)}</p>
      </section>

      {#if headings.length > 0}
        <section class="overlay_section">
          <h3 class="overlay_section_title">Navigate</h3>
          <div class="overlay_nav">
            <input
              type="range"
              class="overlay_range overlay_range--nav"
              min="0"
              max={headings.length - 1}
              step="1"
              value={$currentHeadingIndex ?? 0}
              oninput={(e) =>
                onSeek(headings[Number((e.currentTarget as HTMLInputElement).value)]!.chunkIndex)}
              aria-label="Skip to section"
              list="openwebtts-heading-markers"
            />
            <datalist id="openwebtts-heading-markers">
              {#each headings as heading, i}
                <option value={i} label={heading.text}></option>
              {/each}
            </datalist>
            <div class="overlay_nav_readout">
              <span class="overlay_percent">{$positionPercent.toFixed(1)}%</span>
              <span class="overlay_nav_heading">
                {#if $currentHeadingIndex !== null && headings[$currentHeadingIndex]}
                  {headings[$currentHeadingIndex].text}
                {:else}
                  —
                {/if}
              </span>
            </div>
          </div>
        </section>
      {/if}

      <section class="overlay_section">
        <h3 class="overlay_section_title">Settings</h3>
        <div class="overlay_settings">
          <label class="overlay_label">
            <span class="overlay_label_text">Engine</span>
            <select
              class="overlay_select"
              value={$engineKind}
              onchange={(e) =>
                onEngineChange((e.currentTarget as HTMLSelectElement).value as ResolvedEngine)}
            >
              {#each engineOptions as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </label>

          <label class="overlay_label">
            <span class="overlay_label_text">Voice</span>
            <select
              class="overlay_select"
              value={$voiceUri}
              onchange={(e) => onVoiceChange((e.currentTarget as HTMLSelectElement).value)}
            >
              <option value="">Default</option>
              {#each $voices as voice}
                <option value={voice.voiceUri}>{voice.name} ({voice.lang})</option>
              {/each}
            </select>
          </label>

          <label class="overlay_label">
            <span class="overlay_label_text">Highlight</span>
            <select
              class="overlay_select"
              value={$highlightMode}
              onchange={(e) =>
                onHighlightModeChange((e.currentTarget as HTMLSelectElement).value as HighlightMode)}
            >
              {#each highlightOptions as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </label>

          <label class="overlay_label">
            <span class="overlay_label_text">Speed {$rate[0].toFixed(2)}x</span>
            <input
              type="range"
              class="overlay_range"
              min="0.5"
              max="2"
              step="0.05"
              value={$rate[0]}
              oninput={(e) => onRateChange(Number((e.currentTarget as HTMLInputElement).value))}
            />
          </label>

          <label class="overlay_label">
            <span class="overlay_label_text">Pitch {$pitch[0].toFixed(2)}</span>
            <input
              type="range"
              class="overlay_range"
              min="0.5"
              max="2"
              step="0.05"
              value={$pitch[0]}
              oninput={(e) => onPitchChange(Number((e.currentTarget as HTMLInputElement).value))}
            />
          </label>

          <label class="overlay_label">
            <span class="overlay_label_text">Volume {$volume[0].toFixed(2)}</span>
            <input
              type="range"
              class="overlay_range"
              min="0"
              max="1"
              step="0.05"
              value={$volume[0]}
              oninput={(e) => onVolumeChange(Number((e.currentTarget as HTMLInputElement).value))}
            />
          </label>
        </div>
      </section>
    </div>
  {/if}
</div>
{/if}
