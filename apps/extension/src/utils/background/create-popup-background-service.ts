import type { PopupState } from '../protocol/extension';
import { getErrorMessage } from '../errors';
import { emitStateChanged } from './notifier';
import type { PartySessionService } from './party-session-service';
import type { SettingsStore } from './settings-store';
import type { InternalState } from './state';
import { buildPopupState } from './state';

export function createPopupBackgroundService(
  state: InternalState,
  settingsStore: SettingsStore,
  partySessionService: PartySessionService,
) {
  async function handlePopupRequest<T>(
    handler: () => Promise<T>,
    emitErrorState = true,
  ): Promise<T | PopupState> {
    try {
      return await handler();
    } catch (error) {
      state.lastError = getErrorMessage(error);
      if (emitErrorState) {
        emitStateChanged(state);
      }
      return buildPopupState(state);
    }
  }

  return {
    getState: () => handlePopupRequest(async () => buildPopupState(state)),

    updateSettings: ({ serverUrl, memberName }: PopupState['settings']) =>
      handlePopupRequest(async () => {
        await settingsStore.updateSettings({ serverUrl, memberName });
        emitStateChanged(state);
        return buildPopupState(state);
      }),

    createRoom: () => handlePopupRequest(() => partySessionService.createRoom()),

    joinRoom: ({ roomCode }: { roomCode: string }) =>
      handlePopupRequest(() => partySessionService.joinRoom(roomCode)),

    leaveRoom: () => handlePopupRequest(() => partySessionService.leaveRoom()),

    sendPlaybackUpdate: (payload: Parameters<PartySessionService['sendPlaybackUpdate']>[0]) =>
      handlePopupRequest(async () => {
        const result = await partySessionService.sendPlaybackUpdate(payload);
        return 'ok' in result ? buildPopupState(state) : result;
      }),
  };
}
