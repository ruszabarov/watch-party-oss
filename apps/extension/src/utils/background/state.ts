import { storage } from '#imports';
import type { ConnectionStatus, PartySnapshot } from '@open-watch-party/shared';
import { sanitizeMemberName, type ServiceId } from '@open-watch-party/shared';
import { match, P } from 'ts-pattern';

import type { ActiveTabSummary, ServiceContentContext } from '../protocol/extension';

export type SessionInfo = {
  roomCode: string;
  memberId: string;
  serviceId: ServiceId;
  playbackClientSequence: number;
};

export type StoredSettings = {
  memberName: string;
  session: SessionInfo | null;
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
  activeTab: ActiveTabSummary;
  controlledTab: {
    tabId: number;
    context: ServiceContentContext;
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
    activeTab: createEmptyActiveTabSummary(),
    controlledTab: null,
    lastError: null,
    lastWarning: null,
  };
}

export const backgroundStateItem = storage.defineItem<BackgroundState>('session:background-state', {
  fallback: createBackgroundState(),
});

export function syncBackgroundState(state: BackgroundState): void {
  void backgroundStateItem.setValue(state);
}

export function clearControlledTab(state: BackgroundState): void {
  state.controlledTab = null;
}

export function setControlledTab(
  state: BackgroundState,
  tabId: number,
  context: ServiceContentContext,
): void {
  state.controlledTab = { tabId, context };
}

export function createIdleSessionState(): BackgroundSessionState {
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

export function selectConnectionStatus(state: BackgroundState): ConnectionStatus {
  return state.sessionState.connectionStatus;
}

export function setStoredSession(state: BackgroundState, session: SessionInfo | null): void {
  state.sessionState = session
    ? { kind: 'stored-session', session, connectionStatus: 'disconnected' }
    : createIdleSessionState();
}

export function setJoinedSession(
  state: BackgroundState,
  session: SessionInfo,
  room: PartySnapshot,
): void {
  state.sessionState = {
    kind: 'joined',
    session,
    room,
    connectionStatus: 'connected',
  };
}

export function setSessionError(
  state: BackgroundState,
  message: string,
  options: { clearSession?: boolean } = {},
): void {
  state.sessionState = options.clearSession
    ? { kind: 'idle', connectionStatus: 'error' }
    : { ...state.sessionState, connectionStatus: 'error' };
  state.lastError = message;
}

export function clearSession(state: BackgroundState): void {
  state.sessionState = createIdleSessionState();
  state.lastError = null;
  state.lastWarning = null;
}

export function updateSessionConnectionStatus(
  state: BackgroundState,
  status: ConnectionStatus,
): void {
  state.sessionState = match(state.sessionState)
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

export function updateSessionRoom(state: BackgroundState, room: PartySnapshot): void {
  const nextSessionState = match(state.sessionState)
    .returnType<BackgroundSessionState>()
    .with({ kind: 'idle' }, (sessionState) => sessionState)
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

  state.sessionState = nextSessionState;
  if (nextSessionState.kind === 'joined') {
    state.lastWarning = null;
  }
}

export function updatePersistedSession(state: BackgroundState, session: SessionInfo | null): void {
  if (!session) {
    clearSession(state);
    return;
  }

  const room = selectRoom(state);
  state.sessionState = room
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

export function createEmptyActiveTabSummary(): ActiveTabSummary {
  return {
    tabId: null,
    title: '',
    url: '',
    activeServiceId: null,
    isWatchPage: false,
  };
}

export function normalizeMemberName(value: string): string {
  return sanitizeMemberName(value);
}

export function createGuestName(): string {
  return `Guest ${Math.floor(Math.random() * 900 + 100)}`;
}
