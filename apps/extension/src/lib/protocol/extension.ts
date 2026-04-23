import type {
  ConnectionStatus,
  PartySnapshot,
  PlaybackUpdate,
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

export function createDefaultPopupState(): PopupState {
  return {
    settings: {
      serverUrl: DEFAULT_SERVER_URL,
      memberName: 'Guest',
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
  };
}

export interface ApplySnapshotResult {
  applied: boolean;
  reason?: string;
  context: ServiceContentContext | null;
}

/** Name of the popup ↔ background port. */
export const POPUP_PORT_NAME = 'watch-party.popup';

/** Name of the content-script ↔ background port (one per tab). */
export const CONTENT_PORT_NAME = 'watch-party.content';

/**
 * Commands the popup can issue. Commands are ack/nack over the port;
 * state updates flow the other way on their own schedule.
 */
export type PopupCommand =
  | {
      type: 'settings:update';
      payload: { serverUrl: string; memberName: string };
    }
  | { type: 'room:create' }
  | { type: 'room:join'; payload: { roomCode: string } }
  | { type: 'room:leave' }
  | { type: 'room:playback-update'; payload: PlaybackUpdate };

/** Envelope popup → background over the popup port. */
export type PopupToBackground = {
  type: 'command';
  id: number;
  command: PopupCommand;
};

/** Envelope background → popup over the popup port. */
export type BackgroundToPopup =
  | { type: 'state'; state: PopupState }
  | { type: 'ack'; id: number }
  | { type: 'nack'; id: number; error: string };

/** Envelope content-script → background over the content port. */
export type ContentToBackground =
  | { type: 'context'; context: ServiceContentContext }
  | { type: 'playback-update'; update: PlaybackUpdate }
  | { type: 'request-sync' }
  | { type: 'snapshot-reply'; id: number; result: ApplySnapshotResult };

/** Envelope background → content-script over the content port. */
export type BackgroundToContent = {
  type: 'apply-snapshot';
  id: number;
  snapshot: PartySnapshot;
};
