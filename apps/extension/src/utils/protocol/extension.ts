import type { ServiceId } from '@open-watch-party/shared';

export interface ServiceContentContext {
  serviceId: ServiceId;
  href: string;
  title: string;
  mediaTitle: string;
  mediaId: string;
}

export type ApplySnapshotResult =
  | { applied: true }
  | { applied: false; reason?: string };
