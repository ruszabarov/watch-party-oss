import type {
  ConnectionStatus,
  PartySnapshot,
  ServiceId,
} from '@watch-party/shared';

export const DEFAULT_SERVER_URL = __WATCH_PARTY_DEFAULT_SERVER_URL__;
export const SHOW_SERVER_SETTINGS = __WATCH_PARTY_SHOW_SERVER_SETTINGS__;
export const SYNC_DRIFT_THRESHOLD_SEC = 1.5;
export const LOCAL_UPDATE_SUPPRESSION_MS = 1_000;

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
  mediaTitle?: string;
  playbackReady: boolean;
  playing: boolean;
  positionSec: number;
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

export function createDefaultPopupState(
  overrides: Partial<PopupState> = {},
): PopupState {
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

export function isPopupState(value: unknown): value is PopupState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PopupState>;
  const settings = candidate.settings;
  const activeTab = candidate.activeTab;

  return Boolean(
    settings &&
      typeof settings === 'object' &&
      typeof settings.memberName === 'string' &&
      typeof settings.serverUrl === 'string' &&
      activeTab &&
      typeof activeTab === 'object' &&
      typeof activeTab.title === 'string' &&
      typeof activeTab.url === 'string' &&
      typeof candidate.connectionStatus === 'string',
  );
}

export function coercePopupState(
  value: unknown,
  fallback: PopupState = createDefaultPopupState(),
): PopupState {
  return isPopupState(value) ? value : fallback;
}

export interface ApplySnapshotResult {
  applied: boolean;
  reason?: string;
  context: ServiceContentContext | null;
}

export type BackgroundBroadcast = { type: 'party:state-updated' };
