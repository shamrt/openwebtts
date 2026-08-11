<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    variant = "default",
    disabled = false,
    ariaLabel,
    onclick,
    children,
  }: {
    variant?: "default" | "outline" | "ghost" | "icon";
    disabled?: boolean;
    ariaLabel?: string;
    onclick?: () => void;
    children: Snippet;
  } = $props();
</script>

<button
  type="button"
  class="btn"
  class:btn--outline={variant === "outline"}
  class:btn--ghost={variant === "ghost"}
  class:btn--icon={variant === "icon"}
  {disabled}
  aria-label={ariaLabel}
  {onclick}
>
  {@render children()}
</button>

<style>
  .btn {
    pointer-events: auto;
    appearance: none;
    -webkit-appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.3rem 0.6rem;
    border-radius: 0.375rem;
    border: 1px solid var(--primary, oklch(0.205 0 0));
    background: var(--primary, oklch(0.205 0 0));
    color: var(--primary-foreground, #fff);
    font-size: 0.8rem;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    transition:
      filter 0.12s ease,
      background-color 0.12s ease;
  }

  .btn:hover {
    filter: brightness(1.08);
  }

  .btn:active {
    filter: brightness(0.94);
  }

  .btn:focus-visible {
    outline: 2px solid var(--ring, oklch(0.708 0 0));
    outline-offset: 2px;
  }

  .btn--outline {
    background: transparent;
    color: var(--foreground, oklch(0.145 0 0));
    border-color: var(--border, rgba(0, 0, 0, 0.18));
  }

  .btn--outline:hover {
    background: var(--accent, rgba(0, 0, 0, 0.05));
    filter: none;
  }

  .btn--ghost {
    background: transparent;
    color: var(--foreground, oklch(0.145 0 0));
    border-color: transparent;
  }

  .btn--ghost:hover {
    background: var(--accent, rgba(0, 0, 0, 0.05));
    filter: none;
  }

  .btn--icon {
    width: 1.9rem;
    height: 1.9rem;
    padding: 0;
    font-size: 0.95rem;
    border-color: transparent;
    background: transparent;
    color: var(--foreground, oklch(0.145 0 0));
  }

  .btn--icon:hover {
    background: var(--accent, rgba(0, 0, 0, 0.05));
    filter: none;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: default;
    filter: none;
  }

  .btn:disabled:hover {
    background: var(--primary, oklch(0.205 0 0));
    filter: none;
  }

  .btn--outline:disabled:hover,
  .btn--ghost:disabled:hover,
  .btn--icon:disabled:hover {
    background: transparent;
  }
</style>
