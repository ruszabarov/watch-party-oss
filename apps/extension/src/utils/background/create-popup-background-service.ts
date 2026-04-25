import { getErrorMessage } from '../errors';
import { emitStateChanged } from './notifier';
import type { PopupBackgroundService } from './popup-background-service';
import type { PartySessionService } from './party-session-service';
import type { SettingsStore } from './settings-store';
import type { InternalState } from './state';
import { buildPopupState } from './state';

export function createPopupBackgroundService(
  state: InternalState,
  settingsStore: SettingsStore,
  partySessionService: PartySessionService,
): PopupBackgroundService {
  async function runMutation(handler: () => Promise<void>): Promise<void> {
    try {
      await handler();
    } catch (error) {
      state.lastError = getErrorMessage(error);
      emitStateChanged(state);
    }
  }

  return {
    getState: async () => buildPopupState(state),

    updateSettings: ({ serverUrl, memberName }) =>
      runMutation(async () => {
        await settingsStore.updateSettings({ serverUrl, memberName });
        emitStateChanged(state);
      }),

    createRoom: () => runMutation(() => partySessionService.createRoom()),

    joinRoom: ({ roomCode }: { roomCode: string }) =>
      runMutation(() => partySessionService.joinRoom(roomCode)),

    leaveRoom: () => runMutation(() => partySessionService.leaveRoom()),

    sendPlaybackUpdate: (payload: Parameters<PartySessionService['sendPlaybackUpdate']>[0]) =>
      runMutation(() => partySessionService.sendPlaybackUpdate(payload)),
  };
}
