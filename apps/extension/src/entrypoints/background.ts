import { defineBackground } from 'wxt/utils/define-background';

import { getErrorMessage } from '$lib/errors.js';
import { onMessage } from '../utils/protocol/messaging';
import { PartySessionService } from '../utils/background/party-session-service';
import { SettingsStore } from '../utils/background/settings-store';
import { createSyncedBackgroundStore, type BackgroundStore } from '../utils/background/state';
import { ControlledTabService } from '../utils/background/controlled-tab-service';

export default defineBackground(() => {
  const store = createSyncedBackgroundStore();
  const settingsStore = new SettingsStore(store);
  const controlledTabService = new ControlledTabService(store);
  const partySessionService = new PartySessionService(store, settingsStore);
  const controller = new BackgroundController(
    store,
    settingsStore,
    controlledTabService,
    partySessionService,
  );

  controller.start();
});

class BackgroundController {
  constructor(
    private readonly store: BackgroundStore,
    private readonly settingsStore: SettingsStore,
    private readonly controlledTabService: ControlledTabService,
    private readonly partySessionService: PartySessionService,
  ) {}

  start(): void {
    this.store.on('roomSnapshotChanged', () => {
      this.applyRoomSnapshotToControlledTab();
    });
    this.store.on('controlledTabMediaSwitchRequested', ({ context }) => {
      this.partySessionService.updateRoomMediaFromControlledTab(context);
    });

    this.registerContentHandlers();
    this.registerPopupHandlers();
    this.controlledTabService.registerEventHandlers();

    void this.restoreStoredSession();
  }

  private applyRoomSnapshotToControlledTab(): void {
    void this.controlledTabService.applySnapshotToControlledTab().catch((error) => {
      this.store.trigger.reportError({ message: getErrorMessage(error) });
    });
  }

  private async runPopupAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.store.trigger.reportError({ message: getErrorMessage(error) });
    }
  }

  private registerPopupHandlers(): void {
    onMessage('popup:create-room', ({ data }) =>
      this.runPopupAction(() => this.createRoomFromTab(data.tabId)),
    );

    onMessage('popup:join-room', ({ data }) =>
      this.runPopupAction(() => this.joinRoomFromTab(data.roomCode, data.tabId)),
    );

    onMessage('popup:leave-room', () =>
      this.runPopupAction(() => this.partySessionService.leaveRoom()),
    );

    onMessage('popup:update-settings', ({ data }) =>
      this.runPopupAction(() => this.settingsStore.updateSettings(data)),
    );
  }

  private async createRoomFromTab(tabId: number): Promise<void> {
    const { context, playback } =
      await this.controlledTabService.requireControllableWatchTab(tabId);
    await this.partySessionService.createRoom(tabId, context, playback);
  }

  private async joinRoomFromTab(roomCode: string, tabId: number): Promise<void> {
    const response = await this.partySessionService.joinRoom(roomCode);
    try {
      await this.controlledTabService.navigateControlledTabToRoom(
        tabId,
        response.snapshot.watchUrl,
      );
    } catch (error) {
      await this.partySessionService.leaveRoom();
      throw error;
    }
  }

  private async restoreStoredSession(): Promise<void> {
    await this.settingsStore.hydrate();
    await this.partySessionService.connectForStoredSession();
  }

  private registerContentHandlers(): void {
    onMessage('content:context', async ({ data, sender }) => {
      if (sender.tab?.id !== undefined) {
        await this.controlledTabService.handleContentContext(sender.tab.id, data);
      }
    });

    onMessage('content:playback-update', ({ data, sender }) => {
      if (
        sender.tab?.id !== undefined &&
        this.controlledTabService.isControlledTab(sender.tab.id)
      ) {
        this.partySessionService.updateRoomPlaybackFromControlledTab(data);
      }
    });
  }
}
