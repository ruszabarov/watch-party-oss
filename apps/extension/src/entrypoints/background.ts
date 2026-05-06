import { defineBackground } from 'wxt/utils/define-background';

import { getErrorMessage } from '$lib/errors.js';
import { onMessage } from '../utils/protocol/messaging';
import { createBackgroundBus } from '../utils/background/bus';
import { PartySessionService } from '../utils/background/party-session-service';
import { SettingsStore } from '../utils/background/settings-store';
import { createSyncedBackgroundStore, type BackgroundStore } from '../utils/background/state';
import { ControlledTabService } from '../utils/background/controlled-tab-service';

export default defineBackground(() => {
  const store = createSyncedBackgroundStore();
  const bus = createBackgroundBus();
  const settingsStore = new SettingsStore(store);
  const controlledTabService = new ControlledTabService(store, bus);
  const partySessionService = new PartySessionService(store, bus, settingsStore);

  registerContentHandlers(controlledTabService);
  registerPopupHandlers(store, settingsStore, controlledTabService, partySessionService);
  controlledTabService.registerEventHandlers();
  partySessionService.registerEventHandlers();

  void (async () => {
    await settingsStore.hydrate();
    await partySessionService.connectForStoredSession();
  })();
});

async function runPopupAction(store: BackgroundStore, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    store.trigger.setLastError({ message: getErrorMessage(error) });
  }
}

function registerPopupHandlers(
  store: BackgroundStore,
  settingsStore: SettingsStore,
  controlledTabService: ControlledTabService,
  partySessionService: PartySessionService,
): void {
  onMessage('popup:create-room', ({ data }) =>
    runPopupAction(store, () =>
      createRoomFromTab(data.tabId, controlledTabService, partySessionService),
    ),
  );

  onMessage('popup:join-room', ({ data }) =>
    runPopupAction(store, () =>
      joinRoomFromTab(data.roomCode, data.tabId, controlledTabService, partySessionService),
    ),
  );

  onMessage('popup:leave-room', () => runPopupAction(store, () => partySessionService.leaveRoom()));

  onMessage('popup:update-settings', ({ data }) =>
    runPopupAction(store, () => settingsStore.updateSettings(data)),
  );
}

async function createRoomFromTab(
  tabId: number,
  controlledTabService: ControlledTabService,
  partySessionService: PartySessionService,
): Promise<void> {
  const { context, playback } = await controlledTabService.requireControllableWatchTab(tabId);
  await partySessionService.createRoom(tabId, context, playback);
}

async function joinRoomFromTab(
  roomCode: string,
  tabId: number,
  controlledTabService: ControlledTabService,
  partySessionService: PartySessionService,
): Promise<void> {
  const response = await partySessionService.joinRoom(roomCode);
  try {
    await controlledTabService.navigateControlledTabToRoom(tabId, response.snapshot.watchUrl);
  } catch (error) {
    await partySessionService.leaveRoom();
    throw error;
  }
}

function registerContentHandlers(controlledTabService: ControlledTabService): void {
  onMessage('content:context', ({ data, sender }) => {
    if (sender.tab?.id != null) {
      controlledTabService.recordContentContext(sender.tab.id, data);
    }
  });

  onMessage('content:playback-update', ({ data, sender }) => {
    if (sender.tab?.id != null) {
      controlledTabService.relayControlledPlaybackUpdate(sender.tab.id, data);
    }
  });

  onMessage('content:request-sync', async ({ sender }) => {
    if (sender.tab?.id != null) {
      await controlledTabService.requestSync(sender.tab.id);
    }
  });
}
