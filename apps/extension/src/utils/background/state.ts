import { sanitizeMemberName, type ServiceId } from '@watch-party/shared';

import {
  DEFAULT_SERVER_URL,
  type ActiveTabSummary,
  type PopupState,
} from '../protocol/extension';

export type SessionInfo = {
  roomCode: string;
  memberId: string;
  serviceId: ServiceId;
};

export type StoredSettings = {
  memberName: string;
  serverUrl: string;
  session: SessionInfo | null;
};

export type InternalState = PopupState & {
  session: SessionInfo | null;
};

export function createInternalState(): InternalState {
  return {
    settings: {
      serverUrl: DEFAULT_SERVER_URL,
      memberName: createGuestName(),
    },
    connectionStatus: 'disconnected',
    room: null,
    roomMemberId: null,
    activeTab: createEmptyActiveTabSummary(),
    controlledTabId: null,
    contentContext: null,
    lastError: null,
    lastWarning: null,
    session: null,
  };
}

export function buildPopupState(state: InternalState): PopupState {
  return {
    settings: { ...state.settings },
    connectionStatus: state.connectionStatus,
    room: state.room,
    roomMemberId: state.roomMemberId,
    activeTab: state.activeTab,
    controlledTabId: state.controlledTabId,
    contentContext: state.contentContext,
    lastError: state.lastError,
    lastWarning: state.lastWarning,
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
