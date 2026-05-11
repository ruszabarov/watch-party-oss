import type { PartySnapshot, ServiceDefinition } from '@open-watch-party/shared';
import type { ApplySnapshotResult } from '../messaging';

export type PlaybackStatus = { syncable: true } | { syncable: false; reason: string };

export interface PlaybackApplyContext {
  video: HTMLVideoElement;
  snapshot: PartySnapshot;
}

/**
 * Service integration plus the extension-only DOM hooks needed by a content script.
 */
export type ServicePlugin = ServiceDefinition & {
  /** Shown when a watch URL matched but the `<video>` element isn't ready. */
  readonly playerNotReadyMessage: string;
  getVideo(): HTMLVideoElement | null;
  getMediaTitle(): string;
  getPlaybackStatus?(video: HTMLVideoElement): PlaybackStatus;
  getPlaybackStatusTarget?(video: HTMLVideoElement): Element | null;
  applyPlayback?(context: PlaybackApplyContext): Promise<ApplySnapshotResult>;
};
