import type {
  PartySnapshot,
  PlaybackUpdate,
  ServiceId,
} from '@watch-party/shared';

import type {
  ApplySnapshotResult,
  ServiceContentContext,
} from '../protocol/extension';

export interface StreamingServiceAdapter {
  readonly serviceId: ServiceId;
  getContext(): ServiceContentContext;
  applySnapshot(snapshot: PartySnapshot): Promise<ApplySnapshotResult>;
  observe(
    onContext: (context: ServiceContentContext) => void,
    onPlaybackUpdate: (update: PlaybackUpdate) => void,
  ): () => void;
}
