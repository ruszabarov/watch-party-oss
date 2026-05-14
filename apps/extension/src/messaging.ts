import { defineExtensionMessaging } from '@webext-core/messaging';

import type { PartySnapshot, StreamingServiceId } from '@open-watch-party/shared';

export interface CreateRoomRequest {
  tabId: number;
}

export interface JoinRoomRequest {
  roomCode: string;
  tabId: number;
}

type WatchReportBase = {
  streamingServiceId: StreamingServiceId;
  mediaId: string;
};

export type WatchReport =
  | (WatchReportBase & {
      phase: 'loading';
    })
  | (WatchReportBase & {
      phase: 'ready';
      title?: string;
      positionSec: number;
      playing: boolean;
    });

export type ReadyWatchReport = Extract<WatchReport, { phase: 'ready' }>;

export interface ExtensionProtocolMap {
  'content:watch-report': (payload: WatchReport) => void;
  'party:request-watch-report': () => ReadyWatchReport | null;
  'party:apply-snapshot': (payload: PartySnapshot) => void;
  'popup:create-room': (payload: CreateRoomRequest) => void;
  'popup:join-room': (payload: JoinRoomRequest) => void;
  'popup:leave-room': () => void;
}

export const { onMessage, sendMessage } = defineExtensionMessaging<ExtensionProtocolMap>();
