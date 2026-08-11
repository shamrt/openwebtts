<script lang="ts">
  import type { OverlayStore } from "../store.js";

  import Player from "./Player.svelte";

  // Connected container: renders the presentational Player from the overlay
  // store. The store is plain TS — the extension build's svelte-loader cannot
  // compile runes-mode `.svelte.ts` modules — so this component is the one
  // place the store's event API meets Svelte reactivity: each observable is
  // mirrored into `$state` and kept in sync by an `$effect` subscription (the
  // disposer each `on*Change` returns is auto-cleaned on teardown). Callbacks
  // delegate straight to the store's methods.
  let { store }: { store: OverlayStore } = $props();

  // One-shot snapshot at mount; the $effects below keep the mirrors in sync.
  // The reads live inside a function so the compiler doesn't warn that the
  // references "only capture the initial value" — that is the intent here.
  function snapshot() {
    return {
      expanded: store.expanded,
      activated: store.activated,
      state: store.state,
      engineKind: store.engineKind,
      voices: store.voices,
      settings: store.settings,
      chunkText: store.currentChunk?.text ?? "",
      positionPercent: store.positionPercent,
      currentHeadingIndex: store.currentHeadingIndex,
      canBack: store.nav.canBack,
      canForward: store.nav.canForward,
    };
  }
  const initial = snapshot();

  let expanded = $state(initial.expanded);
  $effect(() => store.onExpandedChange((v) => (expanded = v)));

  let activated = $state(initial.activated);
  $effect(() => store.onActivatedChange((v) => (activated = v)));

  let state = $state(initial.state);
  $effect(() => store.onStateChange((v) => (state = v)));

  let engineKind = $state(initial.engineKind);
  $effect(() => store.onEngineChange((v) => (engineKind = v)));

  let voices = $state(initial.voices);
  $effect(() => store.onVoicesChange((v) => (voices = v)));

  let settings = $state(initial.settings);
  $effect(() => store.onSettingsChange((v) => (settings = v)));

  let chunkText = $state(initial.chunkText);
  let positionPercent = $state(initial.positionPercent);
  let currentHeadingIndex = $state(initial.currentHeadingIndex);
  $effect(() =>
    store.onChunkChange(() => {
      chunkText = store.currentChunk?.text ?? "";
      positionPercent = store.positionPercent;
      currentHeadingIndex = store.currentHeadingIndex;
    }),
  );

  let canBack = $state(initial.canBack);
  let canForward = $state(initial.canForward);
  $effect(() =>
    store.onNavChange((nav) => {
      canBack = nav.canBack;
      canForward = nav.canForward;
    }),
  );
</script>

<Player
  {activated}
  {expanded}
  playing={state.status === "playing"}
  {engineKind}
  highlightMode={settings.highlightMode}
  rate={settings.rate}
  volume={settings.volume}
  pitch={settings.pitch}
  {voices}
  voiceUri={settings.voiceUri}
  {positionPercent}
  {chunkText}
  headings={store.headings}
  {currentHeadingIndex}
  {canBack}
  {canForward}
  onPlayPause={() =>
    state.status === "playing" ? store.pause() : store.play()
  }
  onToggleExpanded={store.toggleExpanded}
  onStop={store.stop}
  onSeekPercent={store.seekToPercent}
  onBack={store.backChunk}
  onForward={store.nextChunk}
  onEngineChange={(kind) => void store.setEngine(kind)}
  onHighlightModeChange={store.setHighlightMode}
  onRateChange={(rate) => void store.setRate(rate)}
  onVolumeChange={(volume) => void store.setVolume(volume)}
  onPitchChange={(pitch) => void store.setPitch(pitch)}
  onVoiceChange={(voiceUri) => void store.setVoice(voiceUri)}
  onClose={store.close}
/>
