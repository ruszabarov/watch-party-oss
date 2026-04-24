import type { PlaybackUpdateDraft } from '@open-watch-party/shared';
import type { ProxyServiceKey } from '@webext-core/proxy-service';

import type { PopupState } from '../protocol/extension';

export interface PopupBackgroundService {
  getState(): Promise<PopupState>;
  updateSettings(payload: { serverUrl: string; memberName: string }): Promise<PopupState>;
  createRoom(): Promise<PopupState>;
  joinRoom(payload: { roomCode: string }): Promise<PopupState>;
  leaveRoom(): Promise<PopupState>;
  sendPlaybackUpdate(payload: PlaybackUpdateDraft): Promise<PopupState>;
}

export const POPUP_BACKGROUND_SERVICE_KEY =
  'watch-party-popup-background-service' as ProxyServiceKey<PopupBackgroundService>;
