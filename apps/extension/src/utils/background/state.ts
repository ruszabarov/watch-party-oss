import { storage } from '#imports';
import { createStore } from '@xstate/store';
import type { ConnectionStatus, PartySnapshot } from '@open-watch-party/shared';
import { sanitizeMemberName, type ServiceId } from '@open-watch-party/shared';
import { match, P } from 'ts-pattern';

import type { WatchPageContext } from '../protocol/extension';

export type SessionInfo = {
  roomCode: string;
  memberId: string;
  serviceId: ServiceId;
  playbackClientSequence: number;
};

export type BackgroundSessionState =
  | {
      kind: 'idle';
      connectionStatus: 'disconnected' | 'error';
    }
  | {
      kind: 'stored-session';
      session: SessionInfo;
      connectionStatus: ConnectionStatus;
    }
  | {
      kind: 'joined';
      session: SessionInfo;
      room: PartySnapshot;
      connectionStatus: ConnectionStatus;
    };

export type BackgroundState = {
  settings: {
    memberName: string;
  };
  sessionState: BackgroundSessionState;
  controlledTab: {
    tabId: number;
    context: WatchPageContext;
  } | null;
  lastError: string | null;
  lastWarning: string | null;
};

export function createBackgroundState(): BackgroundState {
  return {
    settings: {
      memberName: createGuestName(),
    },
    sessionState: createIdleSessionState(),
    controlledTab: null,
    lastError: null,
    lastWarning: null,
  };
}

export const backgroundStateItem = storage.defineItem<BackgroundState>('session:background-state', {
  fallback: createBackgroundState(),
});

function createIdleSessionState(): BackgroundSessionState {
  return { kind: 'idle', connectionStatus: 'disconnected' };
}

export function selectSession(state: BackgroundState): SessionInfo | null {
  return match(state.sessionState)
    .with({ kind: 'idle' }, () => null)
    .with({ kind: P.union('stored-session', 'joined') }, ({ session }) => session)
    .exhaustive();
}

export function selectRoom(state: BackgroundState): PartySnapshot | null {
  return match(state.sessionState)
    .with({ kind: P.union('idle', 'stored-session') }, () => null)
    .with({ kind: 'joined' }, ({ room }) => room)
    .exhaustive();
}

function selectConnectionStatus(state: BackgroundState): ConnectionStatus {
  return state.sessionState.connectionStatus;
}

function createStoredSessionState(session: SessionInfo | null): BackgroundSessionState {
  return session
    ? { kind: 'stored-session', session, connectionStatus: 'disconnected' }
    : createIdleSessionState();
}

function createJoinedSessionState(
  session: SessionInfo,
  room: PartySnapshot,
): BackgroundSessionState {
  return {
    kind: 'joined',
    session,
    room,
    connectionStatus: 'connected',
  };
}

function createSessionErrorState(
  state: BackgroundState,
  options: { clearSession?: boolean } = {},
): BackgroundSessionState {
  return options.clearSession
    ? { kind: 'idle', connectionStatus: 'error' }
    : { ...state.sessionState, connectionStatus: 'error' };
}

function updateSessionConnectionStatus(
  state: BackgroundState,
  status: ConnectionStatus,
): BackgroundSessionState {
  return match(state.sessionState)
    .returnType<BackgroundSessionState>()
    .with({ kind: 'idle' }, () => ({
      kind: 'idle',
      connectionStatus: status === 'error' ? 'error' : 'disconnected',
    }))
    .with({ kind: 'stored-session' }, (sessionState) => ({
      ...sessionState,
      connectionStatus: status,
    }))
    .with({ kind: 'joined' }, (sessionState) => ({ ...sessionState, connectionStatus: status }))
    .exhaustive();
}

function updateSessionRoom(state: BackgroundState, room: PartySnapshot): BackgroundState {
  const sessionState = match(state.sessionState)
    .returnType<BackgroundSessionState>()
    .with({ kind: 'idle' }, (idleSessionState) => idleSessionState)
    .with({ kind: P.union('stored-session', 'joined') }, ({ session, connectionStatus }) => ({
      kind: 'joined',
      session: {
        ...session,
        roomCode: room.roomCode,
        serviceId: room.serviceId,
      },
      room,
      connectionStatus: connectionStatus === 'error' ? 'connected' : connectionStatus,
    }))
    .exhaustive();

  return {
    ...state,
    sessionState,
    lastWarning: sessionState.kind === 'joined' ? null : state.lastWarning,
  };
}

function updateSessionFromPersistedSession(
  state: BackgroundState,
  session: SessionInfo | null,
): BackgroundSessionState {
  if (!session) {
    return createIdleSessionState();
  }

  const room = selectRoom(state);
  return room
    ? {
        kind: 'joined',
        session,
        room,
        connectionStatus: selectConnectionStatus(state),
      }
    : {
        kind: 'stored-session',
        session,
        connectionStatus: selectConnectionStatus(state),
      };
}

export function createSyncedBackgroundStore() {
  const store = createStore({
    context: createBackgroundState(),
    on: {
      hydrateSettings: (
        state,
        event: { settings: BackgroundState['settings']; session: SessionInfo | null },
      ) => ({
        ...state,
        settings: event.settings,
        sessionState: createStoredSessionState(event.session),
      }),
      updateSettings: (state, event: { settings: BackgroundState['settings'] }) => ({
        ...state,
        settings: event.settings,
      }),
      setControlledTab: (state, event: { tabId: number; context: WatchPageContext }) => ({
        ...state,
        controlledTab: {
          tabId: event.tabId,
          context: event.context,
        },
      }),
      clearControlledTab: (state) => ({
        ...state,
        controlledTab: null,
      }),
      setJoinedSession: (state, event: { session: SessionInfo; room: PartySnapshot }) => ({
        ...state,
        sessionState: createJoinedSessionState(event.session, event.room),
        lastError: null,
      }),
      setSessionError: (state, event: { message: string; clearSession?: boolean }) => ({
        ...state,
        sessionState: createSessionErrorState(state, { clearSession: event.clearSession }),
        lastError: event.message,
      }),
      leaveRoom: (state) => ({
        ...state,
        sessionState: createIdleSessionState(),
        controlledTab: null,
        lastError: null,
        lastWarning: null,
      }),
      updateSessionConnectionStatus: (
        state,
        event: { status: ConnectionStatus; errorMessage?: string | null },
      ) => ({
        ...state,
        sessionState: updateSessionConnectionStatus(state, event.status),
        lastError: event.errorMessage ?? (event.status === 'connected' ? null : state.lastError),
      }),
      updateSessionRoom: (state, event: { room: PartySnapshot }) =>
        updateSessionRoom(state, event.room),
      updatePersistedSession: (state, event: { session: SessionInfo | null }) => ({
        ...state,
        sessionState: updateSessionFromPersistedSession(state, event.session),
        lastError: event.session ? state.lastError : null,
        lastWarning: event.session ? state.lastWarning : null,
      }),
      setLastError: (state, event: { message: string | null }) => ({
        ...state,
        lastError: event.message,
      }),
      setLastWarning: (state, event: { message: string | null }) => ({
        ...state,
        lastWarning: event.message,
      }),
    },
  });

  void backgroundStateItem.setValue(store.getSnapshot().context);
  store.subscribe((snapshot) => {
    void backgroundStateItem.setValue(snapshot.context);
  });

  return store;
}

export type BackgroundStore = ReturnType<typeof createSyncedBackgroundStore>;

export function normalizeMemberName(value: string): string {
  return sanitizeMemberName(value);
}

function createGuestName(): string {
  return `Guest ${Math.floor(Math.random() * 900 + 100)}`;
}
