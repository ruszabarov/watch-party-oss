import type { PartySnapshot, PlaybackUpdateDraft, ServiceId } from '@open-watch-party/shared';

import type { ApplySnapshotResult, ServiceContentContext } from '../protocol/extension';

/**
 * Runtime adapter that bridges a specific service's DOM to the background.
 * Each `ServicePlugin.createAdapter()` call returns a fresh instance per
 * content-script load.
 */
export interface StreamingServiceAdapter {
  readonly serviceId: ServiceId;
  getContext(): ServiceContentContext;
  applySnapshot(snapshot: PartySnapshot): Promise<ApplySnapshotResult>;
  observe(
    onContext: (context: ServiceContentContext) => void,
    onPlaybackUpdate: (update: PlaybackUpdateDraft) => void,
  ): () => void;
}

/** Presentation metadata rendered by the popup UI. */
export interface ServiceDescriptor {
  readonly id: ServiceId;
  readonly label: string;
  readonly accent: string;
  readonly accentContrast: string;
  readonly glyph: string;
  readonly watchPathHint: string;
}

/**
 * Self-contained service integration. A plugin bundles everything the popup,
 * background, and content scripts need to recognize and drive a service:
 * descriptor (UI), URL classifiers (manifest + runtime), and an adapter
 * factory. Add a new service by exporting a `ServicePlugin` and appending it
 * to `SERVICE_PLUGINS`.
 */
export interface ServicePlugin {
  readonly descriptor: ServiceDescriptor;
  /** WXT-style match patterns; consumed at build time for the manifest. */
  readonly contentMatches: readonly string[];
  /** True when `url` belongs to this service (watch page or not). */
  matchesService(url: string): boolean;
  /** True when `url` is a playable watch page on this service. */
  matchesWatchPage(url: string): boolean;
  createAdapter(): StreamingServiceAdapter;
}
