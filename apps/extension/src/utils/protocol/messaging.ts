import {
  defineExtensionMessaging,
  type ExtensionMessage,
  type GetReturnType,
  type MaybePromise,
  type Message,
  type RemoveListenerCallback,
} from '@webext-core/messaging';

import type { PartySnapshot, PlaybackUpdateDraft } from '@open-watch-party/shared';

import type { ApplySnapshotResult, ServiceContentContext } from './extension';

export interface ExtensionProtocolMap {
  'content:context': (payload: ServiceContentContext | null) => void;
  'content:playback-update': (payload: PlaybackUpdateDraft) => void;
  'content:request-sync': () => void;
  'party:request-context': () => ServiceContentContext | null;
  'party:request-playback': () => PlaybackUpdateDraft | null;
  'party:apply-snapshot': (payload: { snapshot: PartySnapshot }) => ApplySnapshotResult;
  'popup:create-room': () => void;
  'popup:join-room': (payload: { roomCode: string }) => void;
  'popup:leave-room': () => void;
  'popup:update-settings': (payload: { memberName: string }) => void;
}

export const extensionMessaging = defineExtensionMessaging<ExtensionProtocolMap>();
const { onMessage: rawOnMessage, sendMessage: rawSendMessage } = extensionMessaging;
export const sendMessage = rawSendMessage;

type ExtensionMessageFor<TType extends keyof ExtensionProtocolMap> = Message<
  ExtensionProtocolMap,
  TType
> &
  ExtensionMessage;

export function onMessage<TType extends keyof ExtensionProtocolMap>(
  type: TType,
  handler: (
    message: ExtensionMessageFor<TType>,
  ) => MaybePromise<GetReturnType<ExtensionProtocolMap[TType]>>,
): RemoveListenerCallback {
  return rawOnMessage(type, handler);
}
