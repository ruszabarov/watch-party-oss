import { defineExtensionMessaging } from '@webext-core/messaging';

import type { PartySnapshot, PlaybackUpdateDraft } from '@open-watch-party/shared';

import type { ApplySnapshotResult, ServiceContentContext } from './extension';

export interface ExtensionProtocolMap {
  'content:context': (payload: ServiceContentContext) => void;
  'content:playback-update': (payload: PlaybackUpdateDraft) => void;
  'content:request-sync': () => void;
  'party:request-context': () => ServiceContentContext;
  'party:request-playback': () => PlaybackUpdateDraft | null;
  'party:apply-snapshot': (payload: { snapshot: PartySnapshot }) => ApplySnapshotResult;
  'popup:create-room': () => void;
  'popup:join-room': (payload: { roomCode: string }) => void;
  'popup:leave-room': () => void;
  'popup:update-settings': (payload: { serverUrl: string; memberName: string }) => void;
}

export const extensionMessaging = defineExtensionMessaging<ExtensionProtocolMap>();
export const { onMessage, sendMessage } = extensionMessaging;

