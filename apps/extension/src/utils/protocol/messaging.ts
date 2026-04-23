import { defineExtensionMessaging } from '@webext-core/messaging';

import type { PartySnapshot, PlaybackUpdate } from '@watch-party/shared';

import type {
  ApplySnapshotResult,
  PopupState,
  ServiceContentContext,
} from './extension';

export interface ExtensionProtocolMap {
  'party:get-state': () => PopupState;
  'settings:update': (payload: { serverUrl: string; memberName: string }) => PopupState;
  'room:create': () => PopupState;
  'room:join': (payload: { roomCode: string }) => PopupState;
  'room:leave': () => PopupState;
  'room:playback-update': (payload: PlaybackUpdate) => PopupState;
  'content:context': (payload: ServiceContentContext) => void;
  'content:playback-update': (payload: PlaybackUpdate) => void;
  'content:request-sync': () => void;
  'party:request-context': () => ServiceContentContext;
  'party:apply-snapshot': (payload: { snapshot: PartySnapshot }) => ApplySnapshotResult;
}

export type PopupRequest =
  | { type: 'party:get-state' }
  | {
      type: 'settings:update';
      payload: { serverUrl: string; memberName: string };
    }
  | { type: 'room:create' }
  | { type: 'room:join'; payload: { roomCode: string } }
  | { type: 'room:leave' }
  | { type: 'room:playback-update'; payload: PlaybackUpdate };

export const extensionMessaging = defineExtensionMessaging<ExtensionProtocolMap>();
export const { onMessage, sendMessage } = extensionMessaging;
