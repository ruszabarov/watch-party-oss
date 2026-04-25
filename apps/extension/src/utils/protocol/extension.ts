import type { ConnectionStatus, PartySnapshot, ServiceId } from '@open-watch-party/shared';

export const DEFAULT_SERVER_URL = __WATCH_PARTY_DEFAULT_SERVER_URL__;
export const SHOW_SERVER_SETTINGS = __WATCH_PARTY_SHOW_SERVER_SETTINGS__;

export interface ActiveTabSummary {
  tabId: number | null;
  title: string;
  url: string;
  activeServiceId: ServiceId | null;
  isWatchPage: boolean;
}

export interface ServiceContentContext {
  serviceId: ServiceId;
  href: string;
  title: string;
  mediaId?: string;
  mediaTitle: string;
  playbackReady: boolean;
  issue?: string;
}

export interface PopupState {
  settings: {
    serverUrl: string;
    memberName: string;
  };
  connectionStatus: ConnectionStatus;
  room: PartySnapshot | null;
  roomMemberId: string | null;
  activeTab: ActiveTabSummary;
  controlledTabId: number | null;
  contentContext: ServiceContentContext | null;
  lastError: string | null;
  lastWarning: string | null;
}

export function createDefaultPopupState(overrides: Partial<PopupState> = {}): PopupState {
  return {
    settings: {
      serverUrl: DEFAULT_SERVER_URL,
      memberName: 'Guest',
      ...overrides.settings,
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
      ...overrides.activeTab,
    },
    controlledTabId: null,
    contentContext: null,
    lastError: null,
    lastWarning: null,
    ...overrides,
  };
}

export interface ApplySnapshotResult {
  applied: boolean;
  reason?: string;
  context: ServiceContentContext | null;
}
