import { defineBackground } from 'wxt/utils/define-background';

import { getErrorMessage } from '~/utils/errors.js';
import { ControlledTabService } from '../background/controlled-tab.service';
import { PartySessionService } from '../background/party-session.service';
import {
  createBackgroundStore,
  type BackgroundState,
  type BackgroundStore,
} from '../background/state';
import { onMessage } from '../messaging';

export default defineBackground(() => {
  const store = createBackgroundStore();
  const controlledTabService = new ControlledTabService(store);
  const partySessionService = new PartySessionService(store);
  const controller = new BackgroundController(store, controlledTabService, partySessionService);

  controller.start();
});

class BackgroundController {
  constructor(
    private readonly store: BackgroundStore,
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
    this.store.on('controlledTabClosed', () => {
      this.leaveRoomAfterControlledTabClosed();
    });

    this.registerContentHandlers();
    this.registerPopupHandlers();
    this.controlledTabService.registerEventHandlers();
  }

  private applyRoomSnapshotToControlledTab(): void {
    void this.controlledTabService.applySnapshotToControlledTab().catch((error) => {
      this.store.trigger.reportError({ message: getErrorMessage(error) });
    });
  }

  private leaveRoomAfterControlledTabClosed(): void {
    void this.partySessionService.leaveRoom().catch(() => {
      // Best effort; closing a controlled tab should not surface a user-facing error.
    });
  }

  private getState(): BackgroundState {
    return this.store.getSnapshot().context;
  }

  private async runPopupAction(action: () => Promise<void>): Promise<BackgroundState> {
    try {
      await action();
    } catch (error) {
      this.store.trigger.reportError({ message: getErrorMessage(error) });
    }

    return this.getState();
  }

  private registerPopupHandlers(): void {
    onMessage('popup:get-state', () => this.getState());

    onMessage('popup:create-room', ({ data }) =>
      this.runPopupAction(() => this.createRoomFromTab(data.tabId)),
    );

    onMessage('popup:join-room', ({ data }) =>
      this.runPopupAction(() => this.joinRoomFromTab(data.roomCode, data.tabId)),
    );

    onMessage('popup:leave-room', () =>
      this.runPopupAction(() => this.partySessionService.leaveRoom()),
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
