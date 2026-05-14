import { defineBackground } from 'wxt/utils/define-background';
import { getErrorMessage } from '~/utils/errors.js';
import { ControlledTabService } from '../background/controlled-tab.service';
import { PartySessionService } from '../background/party-session.service';
import { reportBackgroundError } from '../background/state';
import { onMessage } from '../messaging';

export default defineBackground(() => {
  const controller = new BackgroundController();

  controller.start();
});

class BackgroundController {
  private readonly partySessionService: PartySessionService;
  private readonly controlledTabService: ControlledTabService;

  constructor() {
    this.partySessionService = new PartySessionService({
      onRoomSnapshotChanged: () => {
        this.applyRoomSnapshotToControlledTab();
      },
    });

    this.controlledTabService = new ControlledTabService({
      onControlledTabClosed: () => {
        this.leaveRoomAfterControlledTabClosed();
      },
      onControlledTabPlaybackReady: (playback) => {
        this.partySessionService.updateRoomPlaybackFromControlledTab(playback);
      },
    });
  }

  start(): void {
    this.registerContentHandlers();
    this.registerPopupHandlers();
    this.controlledTabService.registerEventHandlers();
    void this.partySessionService.resumeStoredSession().catch((error) => {
      void reportBackgroundError(getErrorMessage(error));
    });
  }

  private applyRoomSnapshotToControlledTab(): void {
    void this.controlledTabService.applySnapshotToControlledTab().catch((error) => {
      void reportBackgroundError(getErrorMessage(error));
    });
  }

  private leaveRoomAfterControlledTabClosed(): void {
    void this.partySessionService.leaveRoom().catch(() => {
      // Best effort; closing a controlled tab should not surface a user-facing error.
    });
  }

  private async runPopupAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      await reportBackgroundError(getErrorMessage(error));
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
  }

  private async createRoomFromTab(tabId: number): Promise<void> {
    const { streamingServiceId, playback } =
      await this.controlledTabService.requireControllableWatchTab(tabId);
    await this.partySessionService.createRoom(tabId, streamingServiceId, playback);
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
    onMessage('content:watch-report', async ({ data, sender }) => {
      if (sender.tab?.id !== undefined) {
        await this.controlledTabService.handleWatchReport(sender.tab.id, data);
      }
    });
  }
}
