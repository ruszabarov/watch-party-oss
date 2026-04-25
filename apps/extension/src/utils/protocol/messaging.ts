import {
  defineExtensionMessaging,
  type ExtensionMessage,
  type GetReturnType,
  type MaybePromise,
  type Message,
  type RemoveListenerCallback,
} from '@webext-core/messaging';

import type { PartySnapshot, PlaybackUpdateDraft } from '@open-watch-party/shared';

import { createLogger, elapsedMs, getLogError } from '../logger';
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
const { onMessage: rawOnMessage, sendMessage: rawSendMessage } = extensionMessaging;
const log = createLogger('extension:messaging');
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
  const messageType = String(type);

  return rawOnMessage(type, async (message) => {
    const startedAt = performance.now();

    try {
      const response = await handler(message);
      log.trace(
        {
          messageType,
          tabId: message.sender.tab?.id,
          durationMs: elapsedMs(startedAt),
          emptyResponse: response == null,
        },
        'message:handled',
      );
      return response;
    } catch (error) {
      log.warn(
        {
          messageType,
          tabId: message.sender.tab?.id,
          durationMs: elapsedMs(startedAt),
          error: getLogError(error),
        },
        'message:handler_failed',
      );
      throw error;
    }
  });
}
