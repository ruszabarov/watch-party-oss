import { io, type Socket } from 'socket.io-client';

import {
  type ClientToServerEvents,
  type OperationResult,
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
  type PopupState,
  type ServiceContentContext,
} from '../lib/protocol/extension';
import { onMessage, sendMessage } from '../lib/protocol/messaging';
import { findPluginByUrl, getPlugin } from '../lib/services/registry';
import type { ServicePlugin } from '../lib/services/types';
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
let pendingControlledNavigationUrl: string | null = null;

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

export default defineBackground(() => {
  // Must run synchronously so the service worker installs its
  // `runtime.onMessage` / `tabs.*` listeners before Chrome delivers
  // the event that woke it up. Anything async happens in the background.
  registerEventHandlers();

  void (async () => {
    await hydrateState();
    await refreshActiveTab();
    await connectForStoredSession();
  })();
});

function registerEventHandlers(): void {
  onMessage('party:get-state', async () => {
    return handlePopupRequest(async () => {
      await refreshActiveTab(false);
      return buildPopupState();
    });
  });

  onMessage('settings:update', ({ data }) => {
    return handlePopupRequest(async () => {
      state.settings = {
        serverUrl: normalizeServerUrl(data.serverUrl),
        memberName: normalizeMemberName(data.memberName),
      };
      await persistState();
      emitStateChanged();
      return buildPopupState();
    });
  });

  onMessage('room:create', () => {
    return handlePopupRequest(async () => {
      await refreshActiveTab(false);
      return createRoom();
    });
  });

  onMessage('room:join', ({ data }) => {
    return handlePopupRequest(async () => {
      await refreshActiveTab(false);
      return joinRoom(data.roomCode);
    });
  });

  onMessage('room:leave', () => handlePopupRequest(leaveRoom));

  onMessage('room:playback-update', ({ data }) => {
    return handlePopupRequest(() => sendPlaybackUpdate(data));
  });

  onMessage('content:context', ({ data, sender }) => {
    if (sender.tab?.id != null) {
      contentContexts.set(sender.tab.id, data);

      const isControlledTab = state.controlledTabId === sender.tab.id;
      const isActiveTab = state.activeTab.tabId === sender.tab.id;
      if (isControlledTab || isActiveTab) {
        state.contentContext = data;
      }
    }

    emitStateChanged();
  });

  onMessage('content:playback-update', async ({ data, sender }) => {
    if (sender.tab?.id !== state.controlledTabId) {
      return;
    }

    await handlePopupRequest(() => sendPlaybackUpdate(data, true), false);
  });

  onMessage('content:request-sync', async ({ sender }) => {
    if (sender.tab?.id != null && state.room) {
      state.controlledTabId ??= sender.tab.id;
      if (state.controlledTabId === sender.tab.id) {
        pendingControlledNavigationUrl = null;
      }
      await applySnapshotToControlledTab();
    }
  });

  browser.tabs.onActivated.addListener(async () => {
    await refreshActiveTab();
  });

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
      await refreshActiveTab();
    }

    if (
      tabId === state.controlledTabId &&
      pendingControlledNavigationUrl &&
      tab.url &&
      tab.url === pendingControlledNavigationUrl
    ) {
      state.lastWarning = null;
      emitStateChanged();
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

async function handlePopupRequest<T>(
  handler: () => Promise<T>,
  emitErrorState = true,
): Promise<T | PopupState> {
  try {
    return await handler();
  } catch (error) {
    state.lastError = getErrorMessage(error);
    if (emitErrorState) {
      emitStateChanged();
    }
    return buildPopupState();
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
    const contentContext = await requestContextFromTab(activeTab.id);

    if (contentContext) {
      state.contentContext = contentContext;
      contentContexts.set(activeTab.id, contentContext);
    }
    // If the content script has not injected yet we silently fall back to
    // whatever was cached in `contentContexts`; the classifier alone is
    // enough to enable the "Create room" button.
  }

  if (notify) {
    emitStateChanged();
  }
}

async function createRoom(): Promise<PopupState> {
  const { context } = await requireControllableWatchTab();

  const response = await emitWithAck<RoomResponse>('room:create', {
    memberId: ensureMemberId(),
    memberName: state.settings.memberName,
    serviceId: context.serviceId,
    watchUrl: context.href,
    initialPlayback: {
      serviceId: context.serviceId,
      mediaId: context.mediaId,
      title: context.mediaTitle,
      playing: context.playing,
      positionSec: context.positionSec,
    },
  });

  state.controlledTabId = state.activeTab.tabId;
  applyRoomResponse(response);
  await applySnapshotToControlledTab();

  return buildPopupState();
}

async function joinRoom(roomCode: string): Promise<PopupState> {
  const tabId = state.activeTab.tabId;
  if (tabId == null) {
    throw new Error('Open a browser tab before joining a room.');
  }

  const response = await emitWithAck<RoomResponse>('room:join', {
    roomCode: roomCode.trim().toUpperCase(),
    memberId: ensureMemberId(),
    memberName: state.settings.memberName,
  });

  applyRoomResponse(response);
  state.controlledTabId = tabId;

  try {
    await navigateControlledTabToRoom(tabId, response.snapshot.watchUrl);
  } catch (error) {
    await leaveRoom();
    throw error;
  }

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
  pendingControlledNavigationUrl = null;
  state.connectionStatus = 'disconnected';
  state.lastError = null;
  state.lastWarning = null;
  await persistState();
  emitStateChanged();

  return buildPopupState();
}

async function sendPlaybackUpdate(update: PlaybackUpdate): Promise<PopupState>;
async function sendPlaybackUpdate(
  update: PlaybackUpdate,
  isLocalRelay: true,
): Promise<PopupState | { ok: false }>;
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

/**
 * A `ServiceContentContext` that has cleared every precondition required to
 * drive room playback: the page is playable, `mediaId` is known, and the
 * service matches the active tab.
 */
type ReadyServiceContentContext = ServiceContentContext & {
  playbackReady: true;
  mediaId: string;
};

interface ControllableWatchTab {
  plugin: ServicePlugin;
  context: ReadyServiceContentContext;
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

  return { plugin, context: context as ReadyServiceContentContext };
}

function ensureMemberId(): string {
  return state.session?.memberId ?? `${browser.runtime.id}:${crypto.randomUUID()}`;
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

  if (pendingControlledNavigationUrl) {
    return;
  }

  const sessionPlugin = state.session ? getPlugin(state.session.serviceId) : null;

  const result = await applySnapshotToTab(state.controlledTabId, state.room);

  if (!result) {
    state.lastWarning = sessionPlugin
      ? `${sessionPlugin.descriptor.label} tab is not ready for sync yet.`
      : 'Controlled tab is not ready for sync yet.';
    return;
  }

  if (result.context) {
    contentContexts.set(state.controlledTabId, result.context);
    state.contentContext = result.context;
  }

  state.lastWarning = result.applied ? null : result.reason ?? 'Sync was skipped.';
}

async function navigateControlledTabToRoom(tabId: number, watchUrl: string): Promise<void> {
  pendingControlledNavigationUrl = watchUrl;
  state.lastWarning = null;
  emitStateChanged();

  try {
    await browser.tabs.update(tabId, { url: watchUrl, active: true });
  } catch {
    pendingControlledNavigationUrl = null;
    throw new Error('Could not open the room video in the current tab.');
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

/**
 * Emit an event to the socket.io server and await its ack.
 *
 * Typed on top of socket.io's generic `emit` — the typed `Socket.emit`
 * signature cannot express our "payload then ack callback" shape, hence the
 * narrow cast to a plain `emit(name, body, ack)` function.
 */
async function emitWithAck<T>(
  eventName: keyof ClientToServerEvents,
  payload: unknown,
): Promise<T> {
  await ensureSocket();

  const activeSocket = socket;
  if (!activeSocket) {
    throw new Error('Realtime connection unavailable.');
  }

  type UntypedEmit = (
    name: string,
    body: unknown,
    ack: (response: OperationResult<T>) => void,
  ) => void;

  return new Promise<T>((resolve, reject) => {
    (activeSocket.emit as unknown as UntypedEmit)(
      eventName,
      payload,
      (response) => {
        if (!response.ok) {
          reject(new Error(response.error));
          return;
        }
        if (response.data == null) {
          reject(new Error('Server returned an empty payload.'));
          return;
        }
        resolve(response.data);
      },
    );
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

/**
 * Send a typed message to a tab's content script. Resolves to `null` when the
 * tab has no listener (content script not injected yet) or returned nothing.
 * Never throws.
 */
async function requestContextFromTab(tabId: number): Promise<ServiceContentContext | null> {
  try {
    const response = await sendMessage('party:request-context', undefined, { tabId });
    return response ?? null;
  } catch {
    return null;
  }
}

async function applySnapshotToTab(
  tabId: number,
  snapshot: PartySnapshot,
): Promise<ApplySnapshotResult | null> {
  try {
    const response = await sendMessage(
      'party:apply-snapshot',
      { snapshot },
      { tabId },
    );
    return response ?? null;
  } catch {
    return null;
  }
}
