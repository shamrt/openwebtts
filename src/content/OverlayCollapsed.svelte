<script lang="ts">
  import OverlayButton from "./OverlayButton.svelte";

  let {
    playing,
    canBack = false,
    canForward = false,
    chunkText,
    onPlayPause,
    onBack,
    onForward,
    onStop,
  }: {
    playing: boolean;
    canBack: boolean;
    canForward: boolean;
    chunkText: string;
    onPlayPause: () => void;
    onBack: () => void;
    onForward: () => void;
    onStop: () => void;
  } = $props();
</script>

<div class="collapsed">
  <div class="btns">
    <OverlayButton
      variant="icon"
      ariaLabel="Previous chunk"
      disabled={!canBack}
      onclick={onBack}
    >
      ⏮
    </OverlayButton>
    <OverlayButton
      variant="icon"
      ariaLabel={playing ? "Pause" : "Play"}
      onclick={onPlayPause}
    >
      {playing ? "⏸" : "▶"}
    </OverlayButton>
    <OverlayButton
      variant="icon"
      ariaLabel="Next chunk"
      disabled={!canForward}
      onclick={onForward}
    >
      ⏭
    </OverlayButton>
    <OverlayButton variant="icon" ariaLabel="Stop" onclick={onStop}>
      ⏹
    </OverlayButton>
  </div>
  <span class="snippet">{chunkText.slice(0, 60)}</span>
</div>

<style>
  .collapsed {
    pointer-events: auto; /* play/pause/stop buttons must work */
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.75rem;
  }

  .btns {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.5rem;
    /* Never shrink: the snippet (flex: 1 1 auto, min-width: 0) absorbs all
       width changes, so the buttons stay stationary as chunk text changes. */
    flex: 0 0 auto;
  }

  .snippet {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted-foreground, oklch(0.556 0 0));
    font-size: 0.78rem;
    line-height: 1;
  }
</style>
