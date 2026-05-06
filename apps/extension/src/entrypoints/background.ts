import { defineBackground } from 'wxt/utils/define-background';

import { getErrorMessage } from '$lib/errors.js';
import { onMessage } from '../utils/protocol/messaging';
import { createBackgroundBus } from '../utils/background/bus';
import { PartySessionService } from '../utils/background/party-session-service';
import { SettingsStore } from '../utils/background/settings-store';
import {
  createBackgroundState,
  syncBackgroundState,
  type BackgroundState,
} from '../utils/background/state';
import { ControlledTabService } from '../utils/background/controlled-tab-service';

export default defineBackground(() => {
  const state = createBackgroundState();
  const bus = createBackgroundBus();
  const settingsStore = new SettingsStore(state);
  const controlledTabService = new ControlledTabService(state, bus);
  const partySessionService = new PartySessionService(state, bus, settingsStore);

  registerContentHandlers(controlledTabService);
  registerPopupHandlers(state, settingsStore, controlledTabService, partySessionService);
  controlledTabService.registerEventHandlers();
  partySessionService.registerEventHandlers();

  void (async () => {
    await settingsStore.hydrate();
    await partySessionService.connectForStoredSession();
  })();
});

async function runMutation(state: BackgroundState, handler: () => Promise<void>): Promise<void> {
  try {
    await handler();
  } catch (error) {
    state.lastError = getErrorMessage(error);
    syncBackgroundState(state);
  }
}

function registerPopupHandlers(
  state: BackgroundState,
  settingsStore: SettingsStore,
  controlledTabService: ControlledTabService,
  partySessionService: PartySessionService,
): void {
  onMessage('popup:create-room', ({ data }) =>
    runMutation(state, () =>
      createRoomFromTab(data.tabId, controlledTabService, partySessionService),
    ),
  );

  onMessage('popup:join-room', ({ data }) =>
    runMutation(state, () =>
      joinRoomFromTab(data.roomCode, data.tabId, controlledTabService, partySessionService),
    ),
  );

  onMessage('popup:leave-room', () => runMutation(state, () => partySessionService.leaveRoom()));

  onMessage('popup:update-settings', ({ data }) =>
    runMutation(state, async () => {
      await settingsStore.updateSettings(data);
      syncBackgroundState(state);
    }),
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
