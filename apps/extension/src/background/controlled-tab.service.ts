import { browser } from 'wxt/browser';
import type { PartySnapshot, PlaybackUpdate } from '@open-watch-party/shared';
import type { ApplySnapshotResult, WatchPageContext } from '../messaging';
import { sendMessage } from '../messaging';
import { getStreamingServiceDefinition } from '../streaming-services/catalog';
import type { BackgroundState, BackgroundStore } from './state';

interface ControllableWatchTabState {
  context: WatchPageContext;
  playback: PlaybackUpdate;
}

function isStreamingServiceUrl(
  definition: { matchesUrl(url: URL): boolean },
  rawUrl: string,
): boolean {
  return URL.canParse(rawUrl) && definition.matchesUrl(new URL(rawUrl));
}

function roomMatchesContext(
  room: PartySnapshot | undefined,
  context: WatchPageContext,
): room is PartySnapshot {
  return (
    room !== undefined &&
    room.streamingServiceId === context.streamingServiceId &&
    room.playback.mediaId === context.mediaId
  );
}

export class ControlledTabService {
  constructor(private readonly store: BackgroundStore) {}

  private get state(): BackgroundState {
    return this.store.getSnapshot().context;
  }

  registerEventHandlers(): void {
    browser.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
      const controlledTab = this.state.controlledTab;
      if (tabId === controlledTab?.tabId && tab.url) {
        const session = this.state.session;
        const sessionStreamingService = session
          ? getStreamingServiceDefinition(session.streamingServiceId)
          : null;
        if (sessionStreamingService && !isStreamingServiceUrl(sessionStreamingService, tab.url)) {
          this.store.trigger.setLastWarning({
            message: `The controlled tab left ${sessionStreamingService.descriptor.label}.`,
          });
        }
      }
    });

    browser.tabs.onRemoved.addListener((tabId) => {
      if (this.state.controlledTab?.tabId === tabId) {
        this.store.trigger.closeControlledTab();
      }
    });
  }

  async handleContentContext(tabId: number, context: WatchPageContext): Promise<void> {
    const room = this.state.room;
    if (!room) {
      return;
    }

    const controlledTab = this.state.controlledTab;
    if (!controlledTab) {
      await this.adoptTabForRoom(tabId, context, room);
      return;
    }

    if (controlledTab.tabId !== tabId) {
      return;
    }

    const shouldRequestMediaSwitch =
      context.streamingServiceId === room.streamingServiceId &&
      controlledTab.context.mediaId !== context.mediaId &&
      room.playback.mediaId !== context.mediaId;

    this.store.trigger.setControlledTab({
      tabId,
      context,
      requestMediaSwitch: shouldRequestMediaSwitch,
    });

    if (!shouldRequestMediaSwitch) {
      await this.applySnapshotToControlledTab();
    }
  }

  async applySnapshotToControlledTab(): Promise<void> {
    const room = this.state.room;
    const controlledTab = this.state.controlledTab;
    if (!room || !controlledTab) {
      return;
    }

    const session = this.state.session;
    const sessionStreamingService = session
      ? getStreamingServiceDefinition(session.streamingServiceId)
      : null;

    if (
      controlledTab.context.streamingServiceId !== room.streamingServiceId ||
      controlledTab.context.mediaId !== room.playback.mediaId
    ) {
      await this.navigateControlledTabToRoom(controlledTab.tabId, room.watchUrl, false);
      return;
    }

    const result = await this.applySnapshotToTab(controlledTab.tabId, room);

    if (!result) {
      this.store.trigger.setLastWarning({
        message: sessionStreamingService
          ? `${sessionStreamingService.descriptor.label} tab is not ready for sync yet.`
          : 'Controlled tab is not ready for sync yet.',
      });
      return;
    }

    this.store.trigger.setLastWarning({
      message: result.applied ? null : (result.reason ?? 'Sync was skipped.'),
    });
  }

  async navigateControlledTabToRoom(tabId: number, watchUrl: string, active = true): Promise<void> {
    if (this.state.controlledTab?.tabId === tabId) {
      this.store.trigger.clearControlledTab();
    }
    this.store.trigger.setLastWarning({ message: null });

    try {
      await browser.tabs.update(tabId, {
        url: watchUrl,
        active,
      });
    } catch (error) {
      throw new Error('Could not open the room video in the current tab.', { cause: error });
    }
  }

  isControlledTab(tabId: number): boolean {
    return tabId === this.state.controlledTab?.tabId;
  }

  async requireControllableWatchTab(tabId: number): Promise<ControllableWatchTabState> {
    const context = await this.requestContextFromTab(tabId);
    if (!context) {
      throw new Error('Open a supported watch page before starting a party.');
    }

    const definition = getStreamingServiceDefinition(context.streamingServiceId);
    if (!definition) {
      throw new Error('This tab is not on a supported streaming service.');
    }

    const playback = await this.requestPlaybackFromTab(tabId);

    if (!playback || playback.mediaId !== context.mediaId) {
      throw new Error(`${definition.descriptor.label} playback state is not ready yet.`);
    }

    return { context, playback };
  }

  private async requestContextFromTab(tabId: number): Promise<WatchPageContext | null> {
    try {
      const response = await sendMessage('party:request-context', undefined, { tabId });
      return response ?? null;
    } catch {
      return null;
    }
  }

  private async requestPlaybackFromTab(tabId: number): Promise<PlaybackUpdate | null> {
    try {
      const response = await sendMessage('party:request-playback', undefined, { tabId });
      return response ?? null;
    } catch {
      return null;
    }
  }

  private async applySnapshotToTab(
    tabId: number,
    snapshot: PartySnapshot,
  ): Promise<ApplySnapshotResult | null> {
    try {
      const response = await sendMessage('party:apply-snapshot', snapshot, { tabId });
      return response ?? null;
    } catch {
      return null;
    }
  }

  private async adoptTabForRoom(
    tabId: number,
    context: WatchPageContext,
    room: PartySnapshot | undefined,
  ): Promise<void> {
    if (!roomMatchesContext(room, context)) {
      return;
    }

    const result = await this.applySnapshotToTab(tabId, room);
    const latestRoom = this.state.room;
    if (!roomMatchesContext(latestRoom, context) || this.state.controlledTab) {
      return;
    }

    this.store.trigger.setControlledTab({ tabId, context });
    this.store.trigger.setLastWarning({
      message: result?.applied
        ? null
        : (result?.reason ?? 'Controlled tab is not ready for sync yet.'),
    });
  }
}
