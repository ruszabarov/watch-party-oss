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
  type PopupCommand,
  type PopupState,
  type ServiceContentContext,
} from '../lib/protocol/extension';
import {
  registerContentPortHandlers,
  type ContentPortRegistry,
} from '../lib/protocol/content-port';
import { registerPopupPortHandlers } from '../lib/protocol/popup-port';
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

// Installed synchronously in main() so the listener is active before Chrome
// delivers the connect/tab events that woke the service worker.
let popupPorts: ReturnType<typeof registerPopupPortHandlers>;
let contentPorts: ContentPortRegistry;

export default defineBackground(() => {
  popupPorts = registerPopupPortHandlers({
    getState: buildPopupState,
    handleCommand: handlePopupCommand,
  });

  contentPorts = registerContentPortHandlers({
    onContext: handleContentContext,
    onPlaybackUpdate: handleContentPlaybackUpdate,
    onRequestSync: handleContentRequestSync,
    onDisconnect: handleContentDisconnect,
  });

  browser.tabs.onActivated.addListener(async () => {
    await refreshActiveTab();
  });

  browser.tabs.onUpdated.addListener(async (_tabId, changeInfo) => {
    // If the controlled tab navigates off-service, its content script unloads
    // and its port disconnects — handleContentDisconnect takes it from there.
    if (changeInfo.status === 'complete' || changeInfo.url) {
      await refreshActiveTab();
    }
  });

  void (async () => {
    await hydrateState();
    await refreshActiveTab();
    await connectForStoredSession();
  })();
});

// ---------------------------------------------------------------------------
// Popup command handling
// ---------------------------------------------------------------------------

async function handlePopupCommand(command: PopupCommand): Promise<void> {
  switch (command.type) {
    case 'settings:update':
      state.settings = {
        serverUrl: normalizeServerUrl(command.payload.serverUrl),
        memberName: normalizeMemberName(command.payload.memberName),
      };
      await persistState();
      emitStateChanged();
      return;

    case 'room:create':
      await refreshActiveTab(false);
      try {
        await createRoom();
      } catch (error) {
        state.lastError = getErrorMessage(error);
        emitStateChanged();
        throw error;
      }
      return;

    case 'room:join':
      await refreshActiveTab(false);
      try {
        await joinRoom(command.payload.roomCode);
      } catch (error) {
        state.lastError = getErrorMessage(error);
        emitStateChanged();
        throw error;
      }
      return;

    case 'room:leave':
      await leaveRoom();
      return;

    case 'room:playback-update':
      await sendPlaybackUpdate(command.payload);
      return;
  }
}

// ---------------------------------------------------------------------------
// Content-script event handling
// ---------------------------------------------------------------------------

function handleContentContext(tabId: number, context: ServiceContentContext): void {
  contentContexts.set(tabId, context);

  // Only visible state is `state.contentContext`, which mirrors the active or
  // controlled tab. Pushes from background tabs don't affect the popup UI.
  if (tabId !== state.controlledTabId && tabId !== state.activeTab.tabId) {
    return;
  }

  state.contentContext = context;
  emitStateChanged();
}

function handleContentPlaybackUpdate(tabId: number, update: PlaybackUpdate): void {
  if (tabId !== state.controlledTabId) return;
  void sendPlaybackUpdate(update, true).catch((error) => {
    state.lastError = getErrorMessage(error);
    emitStateChanged();
  });
}

function handleContentRequestSync(tabId: number): void {
  if (!state.room) return;
  state.controlledTabId ??= tabId;
  void applySnapshotToControlledTab();
}

function handleContentDisconnect(tabId: number): void {
  contentContexts.delete(tabId);

  const wasControlled = state.controlledTabId === tabId;
  const wasActive = state.activeTab.tabId === tabId;

  if (wasControlled) {
    const sessionPlugin = state.session ? getPlugin(state.session.serviceId) : null;
    state.controlledTabId = null;
    state.lastWarning = sessionPlugin
      ? `Lost the controlled ${sessionPlugin.descriptor.label} tab.`
      : 'Lost the controlled tab.';
  }

  if (wasControlled || wasActive) {
    state.contentContext = null;
    emitStateChanged();
  }
}

// ---------------------------------------------------------------------------
// State hydration and tab bookkeeping
// ---------------------------------------------------------------------------

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
    if (notify) emitStateChanged();
    return;
  }

  state.activeTab = summarizeTab(activeTab);
  state.contentContext = contentContexts.get(activeTab.id) ?? null;

  if (notify) emitStateChanged();
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

async function createRoom(): Promise<void> {
  const { context } = requireControllableWatchTab();

  const response = await emitWithAck<RoomResponse>('room:create', {
    memberId: ensureMemberId(),
    memberName: state.settings.memberName,
    serviceId: context.serviceId,
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
}

async function joinRoom(roomCode: string): Promise<void> {
  const { context } = requireControllableWatchTab();

  const response = await emitWithAck<RoomResponse>('room:join', {
    roomCode: roomCode.trim().toUpperCase(),
    memberId: ensureMemberId(),
    memberName: state.settings.memberName,
    serviceId: context.serviceId,
  });

  state.controlledTabId = state.activeTab.tabId;
  applyRoomResponse(response);
  await applySnapshotToControlledTab();
}

async function leaveRoom(): Promise<void> {
  if (state.session && socket) {
    try {
      await emitWithAck('room:leave', {
        roomCode: state.session.roomCode,
        memberId: state.session.memberId,
      });
    } catch {
      // Best effort — we tear down the local session regardless.
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
}

async function sendPlaybackUpdate(
  update: PlaybackUpdate,
  isLocalRelay = false,
): Promise<void> {
  if (!state.session) {
    if (isLocalRelay) return;
    throw new Error('Join or create a room first.');
  }

  const playbackContext = contentContexts.get(state.controlledTabId ?? -1);
  if (playbackContext?.mediaId && playbackContext.mediaId !== update.mediaId) {
    state.lastWarning = 'Local title no longer matches the active room.';
    emitStateChanged();
    return;
  }

  await emitWithAck<PartySnapshot>('playback:update', {
    roomCode: state.session.roomCode,
    memberId: state.session.memberId,
    update,
  });

  if (!isLocalRelay) emitStateChanged();
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

function requireControllableWatchTab(): ControllableWatchTab {
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

  return { plugin, context: context };
}

function ensureMemberId(): string {
  return state.session?.memberId ?? `${browser.runtime.id}:${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Socket lifecycle
// ---------------------------------------------------------------------------

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

  const result = await contentPorts.applySnapshot(
    state.controlledTabId,
    state.room,
  );

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

// ---------------------------------------------------------------------------
// State assembly
// ---------------------------------------------------------------------------

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
  popupPorts.broadcastState(buildPopupState());
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

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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
