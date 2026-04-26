import type { ServiceId } from '@open-watch-party/shared';

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
 * Self-contained service integration. A plugin bundles the service metadata,
 * URL classifier, DOM selectors, and the one optional playback override needed
 * to drive a service from a content script.
 */
export interface ServicePlugin {
  readonly id: ServiceId;
  readonly descriptor: ServiceDescriptor;
  /** WXT-style match patterns; consumed at build time for the manifest. */
  readonly contentMatches: readonly string[];
  /** Shown when a watch URL matched but the `<video>` element isn't ready. */
  readonly playerNotReadyMessage: string;
  /**
   * Returns null for URLs outside the service. A non-null result without
   * `mediaId` means the URL belongs to the service but is not a watch page.
   */
  parseUrl(url: string): { mediaId?: string } | null;
  getVideo(): HTMLVideoElement | null;
  getMediaTitle(): string;
}
