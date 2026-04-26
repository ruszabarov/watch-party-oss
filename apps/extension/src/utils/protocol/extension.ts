import type { ServiceId } from '@open-watch-party/shared';

export interface ActiveTabSummary {
  tabId: number | null;
  title: string;
  url: string;
  activeServiceId: ServiceId | null;
  isWatchPage: boolean;
}

export interface ServiceContentContext {
  serviceId: ServiceId;
  href: string;
  title: string;
  mediaTitle: string;
  mediaId: string;
}

export interface ApplySnapshotResult {
  applied: boolean;
  reason?: string;
  context: ServiceContentContext | null;
}
