<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, fn, userEvent, within } from "storybook/test";

  import type { Voice } from "$lib/features/tts";
  import type { HeadingMarker } from "./overlay-store.js";
  import { formatPercent } from "./overlay-format.js";
  import OverlayPlayer from "./OverlayPlayer.svelte";
  import "./styles.css";

  const { Story } = defineMeta({
    title: "OverlayPlayer",
    component: OverlayPlayer,
    tags: ["autodocs"],
    args: {
      activated: true,
      expanded: true,
      playing: true,
      positionPercent: 42.7,
      chunkText:
        "The quick brown fox jumps over the lazy dog while the moon rises over the quiet village at midnight.",
      currentHeadingIndex: 1,
      canBack: true,
      canForward: true,
      onPlayPause: fn(),
      onToggleExpanded: fn(),
      onStop: fn(),
      onSeekPercent: fn(),
      onBack: fn(),
      onForward: fn(),
      onEngineChange: fn(),
      onHighlightModeChange: fn(),
      onRateChange: fn(),
      onVolumeChange: fn(),
      onPitchChange: fn(),
      onVoiceChange: fn(),
      onClose: fn(),
    },
  });

  const headings: HeadingMarker[] = [
    { chunkIndex: 0, text: "Introduction", percent: 0 },
    { chunkIndex: 1, text: "Methods", percent: 25.3 },
    { chunkIndex: 2, text: "Results", percent: 58.1 },
    { chunkIndex: 3, text: "Conclusion", percent: 87.9 },
  ];

  const voices: Voice[] = [
    { name: "Daniel", lang: "en-GB", voiceUri: "urn:daniel", isLocal: false },
    { name: "Zira", lang: "en-US", voiceUri: "urn:zira", isLocal: false },
  ];
</script>

<Story
  name="Collapsed"
  args={{
    expanded: false,
    playing: true,
    canBack: false,
    canForward: false,
    positionPercent: 12.3,
    chunkText: "A short snippet.",
  }}
  play={async ({ canvasElement }) => {
    const chevron = canvasElement.querySelector(".overlay_chevron");
    await expect(chevron).not.toBeNull();
    await expect(
      chevron?.classList.contains("overlay_chevron--expanded"),
    ).toBe(false);
  }}
/>

<Story
  name="Expanded"
  args={{
    headings,
    voices,
    engineKind: "piper",
    highlightMode: "sentence",
    rate: 1.5,
    pitch: 0.8,
    volume: 0.6,
  }}
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText(formatPercent(42.7))).toHaveLength(1);
  }}
/>

<Story
  name="Expanded idle"
  args={{
    playing: false,
    headings: [],
    voices: [],
    positionPercent: 0,
    chunkText: "",
    currentHeadingIndex: null,
    canBack: false,
    canForward: false,
  }}
/>

<Story
  name="Interactions"
  args={{ canBack: false, canForward: false }}
  play={async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    for (const spy of [
      args.onPlayPause,
      args.onToggleExpanded,
      args.onBack,
      args.onEngineChange,
    ]) {
      spy.mockClear();
    }

    // Handle toggles the accordion.
    await userEvent.click(
      canvas.getByRole("button", { name: "Toggle OpenWebTTS overlay" }),
    );
    await expect(args.onToggleExpanded).toHaveBeenCalledTimes(1);

    const chevron = canvasElement.querySelector(".overlay_chevron");
    await expect(chevron).not.toBeNull();
    await expect(
      chevron?.classList.contains("overlay_chevron--expanded"),
    ).toBe(true);

    // Play/pause fires the callback (playing: true → "Pause").
    await userEvent.click(canvas.getByRole("button", { name: "Pause" }));
    await expect(args.onPlayPause).toHaveBeenCalledTimes(1);

    // Disabled nav buttons must not fire.
    await userEvent.click(canvas.getByRole("button", { name: "Previous chunk" }));
    await expect(args.onBack).not.toHaveBeenCalled();

    // Engine select reports the chosen engine.
    await userEvent.selectOptions(canvas.getByLabelText("Engine"), "piper");
    await expect(args.onEngineChange).toHaveBeenCalledWith("piper");
  }}
/>
