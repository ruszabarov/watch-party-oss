import type {
  ConnectionStatus,
  PartySnapshot,
  PlaybackUpdate,
  ServiceId,
} from '@watch-party/shared';

export const DEFAULT_SERVER_URL = 'http://localhost:8787';
export const SYNC_DRIFT_THRESHOLD_SEC = 1.5;
export const LOCAL_UPDATE_SUPPRESSION_MS = 1_000;

export interface ActiveTabSummary {
  tabId: number | null;
  title: string;
  url: string;
  isNetflix: boolean;
  isNetflixWatchPage: boolean;
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

export type RuntimeRequest =
  | { type: 'party:get-state' }
  | {
      type: 'settings:update';
      payload: { serverUrl: string; memberName: string };
    }
  | { type: 'room:create' }
  | { type: 'room:join'; payload: { roomCode: string } }
  | { type: 'room:leave' }
  | { type: 'room:playback-update'; payload: PlaybackUpdate };

export type ContentMessage =
  | { type: 'content:context'; payload: ServiceContentContext }
  | { type: 'content:playback-update'; payload: PlaybackUpdate }
  | { type: 'content:request-sync' };

export type BackgroundToContentMessage =
  | { type: 'party:request-context' }
  | { type: 'party:apply-snapshot'; payload: { snapshot: PartySnapshot } };

export interface ApplySnapshotResult {
  applied: boolean;
  reason?: string;
  context: ServiceContentContext | null;
}

export type BackgroundBroadcast = { type: 'party:state-updated' };
