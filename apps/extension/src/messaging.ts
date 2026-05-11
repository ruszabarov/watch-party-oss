import { defineExtensionMessaging } from '@webext-core/messaging';

import type { PartySnapshot, PlaybackUpdate, StreamingServiceId } from '@open-watch-party/shared';
import type { BackgroundState } from './background/state';

export interface WatchPageContext {
  streamingServiceId: StreamingServiceId;
  mediaId: string;
  title?: string;
}

export interface CreateRoomRequest {
  tabId: number;
}

export interface JoinRoomRequest {
  roomCode: string;
  tabId: number;
}

export interface ExtensionProtocolMap {
  'content:context': (payload: WatchPageContext) => void;
  'content:playback-update': (payload: PlaybackUpdate) => void;
  'party:request-context': () => WatchPageContext | null;
  'party:request-playback': () => PlaybackUpdate | null;
  'party:apply-snapshot': (payload: PartySnapshot) => void;
  'popup:get-state': () => BackgroundState;
  'popup:create-room': (payload: CreateRoomRequest) => BackgroundState;
  'popup:join-room': (payload: JoinRoomRequest) => BackgroundState;
  'popup:leave-room': () => BackgroundState;
}

export const { onMessage, sendMessage } = defineExtensionMessaging<ExtensionProtocolMap>();
