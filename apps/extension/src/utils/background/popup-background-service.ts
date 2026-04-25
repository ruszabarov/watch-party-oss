import type { PlaybackUpdateDraft } from '@open-watch-party/shared';
import type { ProxyServiceKey } from '@webext-core/proxy-service';

import type { PopupState } from '../protocol/extension';

export interface PopupBackgroundService {
  getState(): Promise<PopupState>;
  updateSettings(payload: { serverUrl: string; memberName: string }): Promise<void>;
  createRoom(): Promise<void>;
  joinRoom(payload: { roomCode: string }): Promise<void>;
  leaveRoom(): Promise<void>;
  sendPlaybackUpdate(payload: PlaybackUpdateDraft): Promise<void>;
}

export const POPUP_BACKGROUND_SERVICE_KEY =
  'watch-party-popup-background-service' as ProxyServiceKey<PopupBackgroundService>;
