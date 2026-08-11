import type { HighlightMode } from "$lib/features/settings";
import type { ResolvedEngine, Voice } from "$lib/features/tts";

import type { HeadingMarker } from "../store.js";

/**
 * Props shared by the presentational player components.
 *
 * Single source of truth for the overlay UI contract: Player consumes the
 * full shape, PlayerHost mirrors it with state wrapped in Svelte writable
 * stores, and the region components (Expanded/Collapsed) take subsets.
 * Single-consumer variants are colocated with their components.
 */
export interface PlayerProps {
  activated: boolean;
  expanded: boolean;
  positionPercent: number;
  playing: boolean;
  engineKind: ResolvedEngine;
  highlightMode: HighlightMode;
  rate: number;
  volume: number;
  pitch: number;
  voices: Voice[];
  voiceUri: string;
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
}
