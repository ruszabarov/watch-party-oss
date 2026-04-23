import { io, type Socket } from 'socket.io-client';

import {
  type ClientToServerEvents,
  resolvePlaybackState,
  type PartySnapshot,
  type PlaybackUpdate,
  type RoomResponse,
  type ServerToClientEvents,
  type ServiceId,
} from '@watch-party/shared';

import {
  DEFAULT_SERVER_URL,
  type ActiveTabSummary,
  type ApplySnapshotResult,
  type BackgroundBroadcast,
  type ContentMessage,
  type PopupState,
  type RuntimeRequest,
  type ServiceContentContext,
} from '../lib/protocol/extension';
import { findPluginByUrl, getPlugin } from '../lib/services/registry';
import type { ServicePlugin } from '../lib/services/types';

type MessageSender = Parameters<
  Parameters<typeof browser.runtime.onMessage.addListener>[0]
>[1];
type BrowserTab = Parameters<Parameters<typeof browser.tabs.onUpdated.addListener>[0]>[2];

type SessionInfo = {
  roomCode: string;
  memberId: string;
  serviceId: ServiceId;
};

type StoredSettings = {
  memberName: string;
  serverUrl: string;
  session: SessionInfo | null;
};

type InternalState = PopupState & {
  session: SessionInfo | null;
};

const SETTINGS_KEY = 'watch-party-settings';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
let currentSocketUrl: string | null = null;
let hasRegisteredEventHandlers = false;

const state: InternalState = {
  settings: {
    serverUrl: DEFAULT_SERVER_URL,
    memberName: createGuestName(),
  },
  connectionStatus: 'disconnected',
  room: null,
  roomMemberId: null,
  activeTab: {
    tabId: null,
    title: '',
    url: '',
    activeServiceId: null,
    isWatchPage: false,
  },
  controlledTabId: null,
  contentContext: null,
  lastError: null,
  lastWarning: null,
  session: null,
};

const contentContexts = new Map<number, ServiceContentContext>();

export default defineBackground(async () => {
  registerEventHandlers();
  await hydrateState();
  await refreshActiveTab();
  await connectForStoredSession();
});

function registerEventHandlers(): void {
  if (hasRegisteredEventHandlers) {
    return;
  }

  hasRegisteredEventHandlers = true;

  browser.runtime.onMessage.addListener((message: RuntimeRequest | ContentMessage, sender) => {
    return handleMessage(message, sender).catch((error) => {
      state.lastError = getErrorMessage(error);
      emitStateChanged();
      return buildPopupState();
    });
  });

  browser.tabs.onActivated.addListener(async () => {
    await refreshActiveTab();
  });

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
      await refreshActiveTab();
    }

    if (tabId === state.controlledTabId && tab.url) {
      const sessionPlugin = state.session ? getPlugin(state.session.serviceId) : null;
      if (sessionPlugin && !sessionPlugin.matchesService(tab.url)) {
        state.lastWarning = `The controlled tab left ${sessionPlugin.descriptor.label}.`;
        emitStateChanged();
      }
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    contentContexts.delete(tabId);

    if (state.controlledTabId === tabId) {
      const sessionPlugin = state.session ? getPlugin(state.session.serviceId) : null;
      state.controlledTabId = null;
      state.contentContext = null;
      state.lastWarning = sessionPlugin
        ? `The controlled ${sessionPlugin.descriptor.label} tab was closed.`
        : 'The controlled tab was closed.';
      emitStateChanged();
    }
  });
}

async function handleMessage(
  message: RuntimeRequest | ContentMessage,
  sender: MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'party:get-state':
      await refreshActiveTab(false);
      return buildPopupState();
    case 'settings:update':
      state.settings = {
        serverUrl: normalizeServerUrl(message.payload.serverUrl),
        memberName: normalizeMemberName(message.payload.memberName),
      };
      await persistState();
      emitStateChanged();
      return buildPopupState();
    case 'room:create':
      await refreshActiveTab(false);
      return createRoom();
    case 'room:join':
      await refreshActiveTab(false);
      return joinRoom(message.payload.roomCode);
    case 'room:leave':
      return leaveRoom();
    case 'room:playback-update':
      return sendPlaybackUpdate(message.payload);
    case 'content:context':
      if (sender.tab?.id != null) {
        contentContexts.set(sender.tab.id, message.payload);

        if (state.controlledTabId === sender.tab.id) {
          state.contentContext = message.payload;
        }

        if (state.activeTab.tabId === sender.tab.id) {
          state.contentContext = message.payload;
        }
      }

      emitStateChanged();
      return { ok: true };
    case 'content:playback-update':
      if (sender.tab?.id !== state.controlledTabId) {
        return { ok: false };
      }

      return sendPlaybackUpdate(message.payload, true);
    case 'content:request-sync':
      if (sender.tab?.id != null && state.room) {
        state.controlledTabId ??= sender.tab.id;
        await applySnapshotToControlledTab();
      }

      return { ok: true };
    default:
      return undefined;
  }
}

async function hydrateState(): Promise<void> {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as
    | StoredSettings
    | undefined;

  if (!stored) {
    await persistState();
    return;
  }

  state.settings.memberName = normalizeMemberName(stored.memberName);
  state.settings.serverUrl = normalizeServerUrl(stored.serverUrl);
  state.session = stored.session;
  state.roomMemberId = stored.session?.memberId ?? null;
}

async function persistState(): Promise<void> {
  const storedSettings: StoredSettings = {
    memberName: state.settings.memberName,
    serverUrl: state.settings.serverUrl,
    session: state.session,
  };

  await browser.storage.local.set({ [SETTINGS_KEY]: storedSettings });
}

async function connectForStoredSession(): Promise<void> {
  if (!state.session) {
    return;
  }

  try {
    await ensureSocket();
    const response = await emitWithAck<RoomResponse>('room:join', {
      roomCode: state.session.roomCode,
      memberId: state.session.memberId,
      memberName: state.settings.memberName,
      serviceId: state.session.serviceId,
    });

    applyRoomResponse(response);
  } catch (error) {
    state.room = null;
    state.roomMemberId = null;
    state.session = null;
    state.lastError = getErrorMessage(error);
    state.connectionStatus = 'error';
    await persistState();
    emitStateChanged();
  }
}

async function refreshActiveTab(notify = true): Promise<void> {
  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!activeTab?.id) {
    state.activeTab = createEmptyActiveTabSummary();
    state.contentContext = null;
    if (notify) {
      emitStateChanged();
    }
    return;
  }

  state.activeTab = summarizeTab(activeTab);
  state.contentContext = contentContexts.get(activeTab.id) ?? null;

  if (state.activeTab.activeServiceId) {
    try {
      const contentContext = (await browser.tabs.sendMessage(activeTab.id, {
        type: 'party:request-context',
      })) as ServiceContentContext;

      state.contentContext = contentContext;
      contentContexts.set(activeTab.id, contentContext);
    } catch {
      // Content script may not be ready yet.
    }
  }

  if (notify) {
    emitStateChanged();
  }
}

async function createRoom(): Promise<PopupState> {
  const { context: contentContext } = await requireControllableWatchTab();
  const memberId = state.session?.memberId ?? browser.runtime.id + ':' + crypto.randomUUID();

  const response = await emitWithAck<RoomResponse>('room:create', {
    memberId,
    memberName: state.settings.memberName,
    serviceId: contentContext.serviceId,
    initialPlayback: {
      serviceId: contentContext.serviceId,
      mediaId: contentContext.mediaId!,
      title: contentContext.mediaTitle,
      playing: contentContext.playing,
      positionSec: contentContext.positionSec,
    },
  });

  state.controlledTabId = state.activeTab.tabId;
  applyRoomResponse(response);
  await applySnapshotToControlledTab();

  return buildPopupState();
}

async function joinRoom(roomCode: string): Promise<PopupState> {
  const { context } = await requireControllableWatchTab();
  const memberId = state.session?.memberId ?? browser.runtime.id + ':' + crypto.randomUUID();

  const response = await emitWithAck<RoomResponse>('room:join', {
    roomCode: roomCode.trim().toUpperCase(),
    memberId,
    memberName: state.settings.memberName,
    serviceId: context.serviceId,
  });

  state.controlledTabId = state.activeTab.tabId;
  applyRoomResponse(response);
  await applySnapshotToControlledTab();

  return buildPopupState();
}

async function leaveRoom(): Promise<PopupState> {
  if (state.session && socket) {
    try {
      await emitWithAck('room:leave', {
        roomCode: state.session.roomCode,
        memberId: state.session.memberId,
      });
    } catch {
      // Best effort.
    }
  }

  state.room = null;
  state.roomMemberId = null;
  state.session = null;
  socket?.disconnect();
  socket = null;
  currentSocketUrl = null;
  state.connectionStatus = 'disconnected';
  state.lastError = null;
  state.lastWarning = null;
  await persistState();
  emitStateChanged();

  return buildPopupState();
}

async function sendPlaybackUpdate(
  update: PlaybackUpdate,
  isLocalRelay = false,
): Promise<PopupState | { ok: false }> {
  if (!state.session) {
    if (isLocalRelay) {
      return { ok: false };
    }
    throw new Error('Join or create a room first.');
  }

  const playbackContext = contentContexts.get(state.controlledTabId ?? -1);
  if (playbackContext?.mediaId && playbackContext.mediaId !== update.mediaId) {
    state.lastWarning = 'Local title no longer matches the active room.';
    emitStateChanged();
    return buildPopupState();
  }

  await emitWithAck<PartySnapshot>('playback:update', {
    roomCode: state.session.roomCode,
    memberId: state.session.memberId,
    update,
  });

  if (!isLocalRelay) {
    emitStateChanged();
  }

  return buildPopupState();
}

interface ControllableWatchTab {
  plugin: ServicePlugin;
  context: ServiceContentContext;
}

async function requireControllableWatchTab(): Promise<ControllableWatchTab> {
  if (!state.activeTab.tabId || !state.activeTab.isWatchPage) {
    throw new Error('Open a supported watch page before starting a party.');
  }

  const plugin = getPlugin(state.activeTab.activeServiceId);
  if (!plugin) {
    throw new Error('This tab is not on a supported streaming service.');
  }

  const context = state.contentContext;
  if (!context?.playbackReady || !context.mediaId) {
    throw new Error(`${plugin.descriptor.label} player is not ready yet.`);
  }

  if (context.serviceId !== plugin.descriptor.id) {
    throw new Error('Active tab and reported service disagree. Refresh the tab.');
  }

  return { plugin, context };
}

async function ensureSocket(): Promise<void> {
  const serverUrl = normalizeServerUrl(state.settings.serverUrl);

  if (socket && socket.connected && currentSocketUrl === serverUrl) {
    return;
  }

  if (socket) {
    socket.disconnect();
  }

  state.connectionStatus = 'connecting';
  emitStateChanged();

  socket = io(serverUrl, {
    autoConnect: true,
    reconnection: true,
    transports: ['websocket'],
  });
  currentSocketUrl = serverUrl;
  let hasConnectedBefore = false;

  socket.on('connect', async () => {
    const isReconnect = hasConnectedBefore;
    hasConnectedBefore = true;
    state.connectionStatus = 'connected';
    state.lastError = null;

    if (isReconnect && state.session) {
      try {
        const response = await emitWithAck<RoomResponse>('room:join', {
          roomCode: state.session.roomCode,
          memberId: state.session.memberId,
          memberName: state.settings.memberName,
          serviceId: state.session.serviceId,
        });

        applyRoomResponse(response);
        await applySnapshotToControlledTab();
      } catch (error) {
        state.lastError = getErrorMessage(error);
        state.connectionStatus = 'error';
      }
    }

    emitStateChanged();
  });

  socket.on('disconnect', () => {
    state.connectionStatus = state.session ? 'reconnecting' : 'disconnected';
    emitStateChanged();
  });

  socket.on('connect_error', (error) => {
    state.connectionStatus = 'error';
    state.lastError = error.message;
    emitStateChanged();
  });

  socket.on('room:state', async (snapshot) => {
    state.room = snapshot;
    state.lastWarning = null;
    await persistState();
    emitStateChanged();
  });

  socket.on('presence:state', (snapshot) => {
    state.room = snapshot;
    emitStateChanged();
  });

  socket.on('playback:state', async (snapshot) => {
    state.room = snapshot;
    state.lastWarning = null;
    await applySnapshotToControlledTab();
    emitStateChanged();
  });

  socket.on('server:error', (error) => {
    state.lastError = error.message;
    emitStateChanged();
  });

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Timed out connecting to the realtime server.'));
    }, 5_000);

    socket?.once('connect', () => {
      clearTimeout(timeoutId);
      resolve();
    });

    socket?.once('connect_error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

async function applySnapshotToControlledTab(): Promise<void> {
  if (!state.room || state.controlledTabId == null) {
    return;
  }

  const sessionPlugin = state.session ? getPlugin(state.session.serviceId) : null;

  try {
    const result = (await browser.tabs.sendMessage(state.controlledTabId, {
      type: 'party:apply-snapshot',
      payload: { snapshot: state.room },
    })) as ApplySnapshotResult;

    if (result.context) {
      contentContexts.set(state.controlledTabId, result.context);
      state.contentContext = result.context;
    }

    state.lastWarning = result.applied ? null : result.reason ?? 'Sync was skipped.';
  } catch {
    state.lastWarning = sessionPlugin
      ? `${sessionPlugin.descriptor.label} tab is not ready for sync yet.`
      : 'Controlled tab is not ready for sync yet.';
  }
}

function applyRoomResponse(response: RoomResponse): void {
  state.room = response.snapshot;
  state.roomMemberId = response.memberId;
  state.session = {
    roomCode: response.snapshot.roomCode,
    memberId: response.memberId,
    serviceId: response.snapshot.serviceId,
  };
  state.connectionStatus = 'connected';
  state.lastError = null;
  void persistState();
  emitStateChanged();
}

function buildPopupState(): PopupState {
  return {
    settings: { ...state.settings },
    connectionStatus: state.connectionStatus,
    room: state.room
      ? {
          ...state.room,
          playback: resolvePlaybackState(state.room.playback),
        }
      : null,
    roomMemberId: state.roomMemberId,
    activeTab: state.activeTab,
    controlledTabId: state.controlledTabId,
    contentContext: state.contentContext,
    lastError: state.lastError,
    lastWarning: state.lastWarning,
  };
}

function emitStateChanged(): void {
  const message: BackgroundBroadcast = { type: 'party:state-updated' };
  void browser.runtime.sendMessage(message).catch(() => undefined);
}

async function emitWithAck<T>(
  eventName: keyof ClientToServerEvents,
  payload: unknown,
): Promise<T> {
  await ensureSocket();

  return new Promise<T>((resolve, reject) => {
    const activeSocket = socket as unknown as {
      emit: (
        name: string,
        body: unknown,
        callback: (response: { ok: boolean; data?: T; error?: string }) => void,
      ) => void;
    } | null;

    activeSocket?.emit(eventName, payload, (response) => {
      if (!response.ok || response.data == null) {
        reject(new Error(response.error ?? 'Unknown server error.'));
        return;
      }

      resolve(response.data);
    });
  });
}

function summarizeTab(tab: BrowserTab): ActiveTabSummary {
  const url = tab.url ?? '';
  const classification = findPluginByUrl(url);

  return {
    tabId: tab.id ?? null,
    title: tab.title ?? '',
    url,
    activeServiceId: classification?.plugin.descriptor.id ?? null,
    isWatchPage: classification?.isWatchPage ?? false,
  };
}

function createEmptyActiveTabSummary(): ActiveTabSummary {
  return {
    tabId: null,
    title: '',
    url: '',
    activeServiceId: null,
    isWatchPage: false,
  };
}

function normalizeServerUrl(value: string): string {
  return (value || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '') || DEFAULT_SERVER_URL;
}

function normalizeMemberName(value: string): string {
  return value.trim() || createGuestName();
}

function createGuestName(): string {
  return `Guest ${Math.floor(Math.random() * 900 + 100)}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error.';
}
