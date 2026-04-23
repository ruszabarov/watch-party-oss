import { registerService } from '@webext-core/proxy-service';

import { onMessage } from '../utils/protocol/messaging';
import { createPopupBackgroundService } from '../utils/background/create-popup-background-service';
import { PartySessionService } from '../utils/background/party-session-service';
import {
  POPUP_BACKGROUND_SERVICE_KEY,
} from '../utils/background/popup-background-service';
import { SettingsStore } from '../utils/background/settings-store';
import { createInternalState } from '../utils/background/state';
import { TabSyncService } from '../utils/background/tab-sync-service';

export default defineBackground(() => {
  const state = createInternalState();
  let partySessionService!: PartySessionService;

  const settingsStore = new SettingsStore(state);
  const tabSyncService = new TabSyncService({
    state,
    getRoom: () => state.room,
    onControlledPlaybackUpdate: async (update) => {
      await partySessionService.sendPlaybackUpdate(update, true);
    },
  });
  partySessionService = new PartySessionService(state, settingsStore, tabSyncService);

  registerService(
    POPUP_BACKGROUND_SERVICE_KEY,
    createPopupBackgroundService(
      state,
      settingsStore,
      partySessionService,
    ),
  );

  registerEventHandlers(tabSyncService);
  tabSyncService.registerEventHandlers();

  void (async () => {
    await settingsStore.hydrate();
    await tabSyncService.refreshActiveTab();
    await partySessionService.connectForStoredSession();
  })();
});

function registerEventHandlers(tabSyncService: TabSyncService): void {
  onMessage('content:context', ({ data, sender }) => {
    if (sender.tab?.id != null) {
      tabSyncService.recordContentContext(sender.tab.id, data);
    }
  });

  onMessage('content:playback-update', async ({ data, sender }) => {
    if (sender.tab?.id != null) {
      await tabSyncService.relayControlledPlaybackUpdate(sender.tab.id, data);
    }
  });

  onMessage('content:request-sync', async ({ sender }) => {
    if (sender.tab?.id != null) {
      await tabSyncService.requestSync(sender.tab.id);
    }
  });
}
