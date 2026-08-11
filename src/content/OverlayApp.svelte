<script lang="ts">
  import type { ResolvedEngine, Voice } from "$lib/features/tts";
  import type { HighlightMode } from "$lib/features/settings/settings.js";

  import type { HeadingMarker } from "./overlay-store.js";
  import { formatPercent } from "./overlay-format.js";

  let {
    activated,
    expanded,
    playing,
    engineKind = "web-speech",
    highlightMode = "paragraph",
    rate = 1,
    volume = 1,
    pitch = 1,
    voices = [],
    voiceUri = "",
    positionPercent,
    chunkText,
    headings = [],
    currentHeadingIndex,
    canBack = false,
    canForward = false,
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
    expanded: boolean;
    activated: boolean;
    playing: boolean;
    engineKind: ResolvedEngine;
    highlightMode: HighlightMode;
    rate: number;
    volume: number;
    pitch: number;
    voices: Voice[];
    voiceUri: string;
    positionPercent: number;
    chunkText: string;
    headings: HeadingMarker[];
    currentHeadingIndex: number | null;
    canBack: boolean;
    canForward: boolean;
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

{#if activated}
  <div class="overlay_root" class:overlay_root--expanded={expanded}>
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
      <span class="overlay_handle_group">
        <span class="overlay_percent">{formatPercent(positionPercent)}</span>
        <span
          class="overlay_chevron"
          class:overlay_chevron--expanded={expanded}
          aria-hidden="true"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M3 4.5 6 7.5 9 4.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </span>
    </div>

    <div class="overlay_collapsed" class:hidden={expanded}>
      <div class="overlay_btns">
        <button
          type="button"
          class="overlay_btn overlay_btn--icon"
          aria-label="Previous chunk"
          disabled={!canBack}
          onclick={onBack}
        >
          ⏮
        </button>
        <button
          type="button"
          class="overlay_btn overlay_btn--icon"
          onclick={onPlayPause}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          class="overlay_btn overlay_btn--icon"
          aria-label="Next chunk"
          disabled={!canForward}
          onclick={onForward}
        >
          ⏭
        </button>
        <button
          type="button"
          class="overlay_btn overlay_btn--icon"
          onclick={onStop}
          aria-label="Stop"
        >
          ⏹
        </button>
      </div>
      <span class="overlay_snippet">{chunkText.slice(0, 60)}</span>
    </div>

    {#if expanded}
      <div class="overlay_expanded">
        <section class="overlay_section">
          <h3 class="overlay_section_title">Playback</h3>
          <div class="overlay_row">
            <button
              type="button"
              class="overlay_btn overlay_btn--outline"
              aria-label="Previous chunk"
              disabled={!canBack}
              onclick={onBack}
            >
              ⏮ Back
            </button>
            <button type="button" class="overlay_btn" onclick={onPlayPause}>
              {playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              class="overlay_btn overlay_btn--outline"
              aria-label="Next chunk"
              disabled={!canForward}
              onclick={onForward}
            >
              Next ⏭
            </button>
            <button
              type="button"
              class="overlay_btn overlay_btn--outline"
              onclick={onStop}
            >
              Stop
            </button>
            <button
              type="button"
              class="overlay_btn overlay_btn--ghost"
              onclick={onClose}
            >
              Close
            </button>
          </div>
          <p class="overlay_progress">
            {chunkText.slice(0, 120)}
          </p>
        </section>

        {#if headings.length > 0}
          <section class="overlay_section">
            <h3 class="overlay_section_title">Navigate</h3>
            <div class="overlay_nav">
              <input
                type="range"
                class="overlay_range overlay_range--nav"
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
              <div class="overlay_nav_readout">
                <span class="overlay_nav_heading">
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

        <section class="overlay_section">
          <h3 class="overlay_section_title">Settings</h3>
          <div class="overlay_settings">
            <label class="overlay_label">
              <span class="overlay_label_text">Engine</span>
              <select
                class="overlay_select"
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

            <label class="overlay_label">
              <span class="overlay_label_text">Voice</span>
              <select
                class="overlay_select"
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

            <label class="overlay_label">
              <span class="overlay_label_text">Highlight</span>
              <select
                class="overlay_select"
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

            <label class="overlay_label">
              <span class="overlay_label_text"
                >Speed {rate.toFixed(2)}x</span
              >
              <input
                type="range"
                class="overlay_range"
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

            <label class="overlay_label">
              <span class="overlay_label_text"
                >Pitch {pitch.toFixed(2)}</span
              >
              <input
                type="range"
                class="overlay_range"
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

            <label class="overlay_label">
              <span class="overlay_label_text"
                >Volume {volume.toFixed(2)}</span
              >
              <input
                type="range"
                class="overlay_range"
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
    {/if}
  </div>
{/if}
