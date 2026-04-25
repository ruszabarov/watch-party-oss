import { defineExtensionMessaging } from '@webext-core/messaging';

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

type UnknownMessageHandler = (message: unknown) => unknown | Promise<unknown>;

const rawOnMessageUnknown = rawOnMessage as (
  type: string,
  handler: UnknownMessageHandler,
) => () => void;
const rawSendMessageUnknown = rawSendMessage as (...args: unknown[]) => Promise<unknown>;

const loggedOnMessage = (type: unknown, handler: UnknownMessageHandler): (() => void) => {
  const messageType = String(type);

  return rawOnMessageUnknown(messageType, async (message) => {
    const startedAt = performance.now();
    const sender = getMessageSender(message);

    try {
      const response = await handler(message);
      log.trace(
        {
          messageType,
          tabId: sender?.tab?.id,
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
          tabId: sender?.tab?.id,
          durationMs: elapsedMs(startedAt),
          error: getLogError(error),
        },
        'message:handler_failed',
      );
      throw error;
    }
  });
};

const loggedSendMessage = async (...args: unknown[]): Promise<unknown> => {
  const startedAt = performance.now();
  const messageType = String(args[0]);
  const target = getSendMessageTarget(args[2]);

  try {
    const response = await rawSendMessageUnknown(...args);
    log.debug(
      {
        messageType,
        tabId: target?.tabId,
        durationMs: elapsedMs(startedAt),
        emptyResponse: response == null,
      },
      'message:sent',
    );
    return response;
  } catch (error) {
    log.warn(
      {
        messageType,
        tabId: target?.tabId,
        durationMs: elapsedMs(startedAt),
        error: getLogError(error),
      },
      'message:send_failed',
    );
    throw error;
  }
};

function getMessageSender(message: unknown): { tab?: { id?: number } } | undefined {
  if (!isRecord(message)) return undefined;
  const sender = message['sender'];
  if (!isRecord(sender)) return undefined;
  const tab = sender['tab'];
  return {
    tab: isRecord(tab) && typeof tab['id'] === 'number' ? { id: tab['id'] } : undefined,
  };
}

function getSendMessageTarget(options: unknown): { tabId?: number } | undefined {
  if (!isRecord(options)) return undefined;
  return typeof options['tabId'] === 'number' ? { tabId: options['tabId'] } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export const onMessage = loggedOnMessage as typeof rawOnMessage;
export const sendMessage = loggedSendMessage as typeof rawSendMessage;
