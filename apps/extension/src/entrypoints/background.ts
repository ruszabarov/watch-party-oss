import { defineBackground } from 'wxt/utils/define-background';

import { getErrorMessage } from '../utils/errors';
import { onMessage } from '../utils/protocol/messaging';
import { syncPopupState } from '../utils/background/popup-state-item';
import { PartySessionService } from '../utils/background/party-session-service';
import { SettingsStore } from '../utils/background/settings-store';
import { createBackgroundState, type BackgroundState } from '../utils/background/state';
import { ActiveTabTracker } from '../utils/background/active-tab-tracker';
import { ControlledTabService } from '../utils/background/controlled-tab-service';

export default defineBackground(() => {
  const state = createBackgroundState();
  let partySessionService!: PartySessionService;

  const settingsStore = new SettingsStore(state);
  const activeTabTracker = new ActiveTabTracker(state);
  const controlledTabService = new ControlledTabService(
    {
      state,
      getRoom: () => state.room,
      onControlledPlaybackUpdate: async (update) => {
        await partySessionService.sendPlaybackUpdate(update, true);
      },
    },
    activeTabTracker,
  );
  partySessionService = new PartySessionService(state, settingsStore, controlledTabService);

  registerContentHandlers(activeTabTracker, controlledTabService);
  registerPopupHandlers(state, settingsStore, partySessionService);
  activeTabTracker.registerEventHandlers();
  controlledTabService.registerEventHandlers();

  void (async () => {
    await settingsStore.hydrate();
    await activeTabTracker.refreshActiveTab();
    await partySessionService.connectForStoredSession();
  })();
});

async function runMutation(
  state: BackgroundState,
  handler: () => Promise<void>,
): Promise<void> {
  try {
    await handler();
  } catch (error) {
    state.lastError = getErrorMessage(error);
    syncPopupState(state);
  }
}

function registerPopupHandlers(
  state: BackgroundState,
  settingsStore: SettingsStore,
  partySessionService: PartySessionService,
): void {
  onMessage('popup:create-room', () =>
    runMutation(state, () => partySessionService.createRoom()),
  );

  onMessage('popup:join-room', ({ data }) =>
    runMutation(state, () => partySessionService.joinRoom(data.roomCode)),
  );

  onMessage('popup:leave-room', () =>
    runMutation(state, () => partySessionService.leaveRoom()),
  );

  onMessage('popup:update-settings', ({ data }) =>
    runMutation(state, async () => {
      await settingsStore.updateSettings(data);
      syncPopupState(state);
    }),
  );
}

function registerContentHandlers(
  activeTabTracker: ActiveTabTracker,
  controlledTabService: ControlledTabService,
): void {
  onMessage('content:context', ({ data, sender }) => {
    if (sender.tab?.id != null) {
      activeTabTracker.recordContentContext(sender.tab.id, data);
      controlledTabService.recordContentContext(sender.tab.id, data);
    }
  });

  onMessage('content:playback-update', async ({ data, sender }) => {
    if (sender.tab?.id != null) {
      await controlledTabService.relayControlledPlaybackUpdate(sender.tab.id, data);
    }
  });

  onMessage('content:request-sync', async ({ sender }) => {
    if (sender.tab?.id != null) {
      await controlledTabService.requestSync(sender.tab.id);
    }
  });
}
