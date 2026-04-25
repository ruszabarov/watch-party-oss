import type { ConnectionStatus, PartySnapshot } from '@open-watch-party/shared';
import { sanitizeMemberName, type ServiceId } from '@open-watch-party/shared';
import { match, P } from 'ts-pattern';

import {
  DEFAULT_SERVER_URL,
  type ActiveTabSummary,
  type PopupState,
  type ServiceContentContext,
} from '../protocol/extension';

export type SessionInfo = {
  roomCode: string;
  memberId: string;
  serviceId: ServiceId;
  playbackClientSequence: number;
};

export type StoredSettings = {
  memberName: string;
  serverUrl: string;
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
    serverUrl: string;
    memberName: string;
  };
  sessionState: BackgroundSessionState;
  activeTab: ActiveTabSummary;
  controlledTabId: number | null;
  contentContext: ServiceContentContext | null;
  lastError: string | null;
  lastWarning: string | null;
};

export function createBackgroundState(): BackgroundState {
  return {
    settings: {
      serverUrl: DEFAULT_SERVER_URL,
      memberName: createGuestName(),
    },
    sessionState: createIdleSessionState(),
    activeTab: createEmptyActiveTabSummary(),
    controlledTabId: null,
    contentContext: null,
    lastError: null,
    lastWarning: null,
  };
}

export function selectPopupView(state: BackgroundState): PopupState {
  return {
    settings: { ...state.settings },
    connectionStatus: selectConnectionStatus(state),
    room: selectRoom(state),
    roomMemberId: selectSession(state)?.memberId ?? null,
    activeTab: state.activeTab,
    controlledTabId: state.controlledTabId,
    contentContext: state.contentContext,
    lastError: state.lastError,
    lastWarning: state.lastWarning,
  };
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

export function normalizeServerUrl(value: string): string {
  return (value || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '') || DEFAULT_SERVER_URL;
}

export function normalizeMemberName(value: string): string {
  return sanitizeMemberName(value);
}

export function createGuestName(): string {
  return `Guest ${Math.floor(Math.random() * 900 + 100)}`;
}
