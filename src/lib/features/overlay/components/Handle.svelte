<script lang="ts">
  import { formatPercent } from "../format.js";

  let {
    expanded,
    positionPercent,
    onToggleExpanded,
  }: {
    expanded: boolean;
    positionPercent: number;
    onToggleExpanded: () => void;
  } = $props();
</script>

<div
  class="handle"
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
  <span class="title">OpenWebTTS</span>
  <span class="handle_group">
    <span class="percent">{formatPercent(positionPercent)}</span>
    <span class="chevron" class:chevron--expanded={expanded} aria-hidden="true">
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

<style>
  .handle {
    pointer-events: auto; /* always interactive — it is the affordance */
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.25rem 0.125rem;
    cursor: pointer;
    user-select: none;
    border-radius: 0.375rem;
  }

  .handle:focus-visible {
    outline: 2px solid var(--ring, oklch(0.708 0 0));
    outline-offset: 2px;
  }

  .title {
    font-weight: 600;
    font-size: 0.9rem;
    letter-spacing: 0.01em;
  }

  .percent {
    font-variant-numeric: tabular-nums;
    font-size: 0.78rem;
    color: var(--muted-foreground, oklch(0.556 0 0));
  }

  .handle_group {
    display: inline-flex;
    align-items: center;
    align-self: center;
    gap: 0.5rem;
    padding: 0.1rem 0;
  }

  .chevron {
    display: inline-flex;
    align-items: center;
    color: var(--muted-foreground, oklch(0.556 0 0));
    transition: transform 0.15s ease;
  }

  .chevron--expanded {
    transform: rotate(180deg);
  }
</style>
