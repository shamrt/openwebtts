<script lang="ts">
  import type { PlayerProps } from "../types/player-props.js";

  import Button from "./Button.svelte";

  let {
    playing,
    canBack = false,
    canForward = false,
    chunkText,
    onPlayPause,
    onBack,
    onForward,
    onStop,
  }: Pick<
    PlayerProps,
    | "playing"
    | "canBack"
    | "canForward"
    | "chunkText"
    | "onPlayPause"
    | "onBack"
    | "onForward"
    | "onStop"
  > = $props();
</script>

<div class="collapsed">
  <div class="btns">
    <Button
      variant="icon"
      ariaLabel="Previous chunk"
      disabled={!canBack}
      onclick={onBack}
    >
      ⏮
    </Button>
    <Button
      variant="icon"
      ariaLabel={playing ? "Pause" : "Play"}
      onclick={onPlayPause}
    >
      {playing ? "⏸" : "▶"}
    </Button>
    <Button
      variant="icon"
      ariaLabel="Next chunk"
      disabled={!canForward}
      onclick={onForward}
    >
      ⏭
    </Button>
    <Button variant="icon" ariaLabel="Stop" onclick={onStop}>
      ⏹
    </Button>
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
