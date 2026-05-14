import { browser } from 'wxt/browser';
import type { PartySnapshot, PlaybackUpdate, StreamingServiceId } from '@open-watch-party/shared';
import { sendMessage } from '../messaging';
import {
  findStreamingServiceByUrl,
  getStreamingServiceDefinition,
} from '../streaming-services/catalog';
import { clearControlledTab, getBackgroundState, setControlledTab, setLastWarning } from './state';

function isStreamingServiceUrl(
  definition: { matchesUrl(url: URL): boolean },
  rawUrl: string,
): boolean {
  return URL.canParse(rawUrl) && definition.matchesUrl(new URL(rawUrl));
}

function roomMatchesMediaId(room: PartySnapshot | null, mediaId: string): room is PartySnapshot {
  return room !== null && room.playback.mediaId === mediaId;
}

export class ControlledTabService {
  constructor(
    private readonly options: {
      onControlledTabClosed: () => void;
      onControlledTabMediaSwitchRequested: (mediaId: string) => void;
    },
  ) {}

  registerEventHandlers(): void {
    browser.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
      void this.handleTabUpdated(tabId, tab.url);
    });

    browser.tabs.onRemoved.addListener((tabId) => {
      void this.handleTabRemoved(tabId);
    });
  }

  async handleContentContext(tabId: number, mediaId: string): Promise<void> {
    const state = await getBackgroundState();
    const room = state.room;
    if (!room) {
      return;
    }

    const controlledTab = state.controlledTab;
    if (!controlledTab) {
      await this.adoptTabForRoom(tabId, mediaId, room);
      return;
    }

    if (controlledTab.tabId !== tabId) {
      return;
    }

    const shouldRequestMediaSwitch =
      controlledTab.mediaId !== mediaId && room.playback.mediaId !== mediaId;

    await setControlledTab({
      tabId,
      mediaId,
    });

    if (shouldRequestMediaSwitch) {
      this.options.onControlledTabMediaSwitchRequested(mediaId);
      return;
    }

    await this.applySnapshotToControlledTab();
  }

  async applySnapshotToControlledTab(): Promise<void> {
    const { room, controlledTab } = await getBackgroundState();
    if (!room || !controlledTab) return;

    if (controlledTab.mediaId !== room.playback.mediaId) {
      await this.navigateControlledTabToRoom(controlledTab.tabId, room.watchUrl, false);
      return;
    }

    void sendMessage('party:apply-snapshot', room, { tabId: controlledTab.tabId }).catch(
      () => undefined,
    );
    await setLastWarning(null);
  }

  async navigateControlledTabToRoom(tabId: number, watchUrl: string, active = true): Promise<void> {
    if ((await getBackgroundState()).controlledTab?.tabId === tabId) {
      await clearControlledTab();
    }
    await setLastWarning(null);

    try {
      await browser.tabs.update(tabId, {
        url: watchUrl,
        active,
      });
    } catch (error) {
      throw new Error('Could not open the room video in the current tab.', { cause: error });
    }
  }

  async isControlledTab(tabId: number): Promise<boolean> {
    return tabId === (await getBackgroundState()).controlledTab?.tabId;
  }

  async requireControllableWatchTab(
    tabId: number,
  ): Promise<{ streamingServiceId: StreamingServiceId; playback: PlaybackUpdate }> {
    const tab = await browser.tabs.get(tabId);
    const match = findStreamingServiceByUrl(tab.url);
    if (!match) {
      throw new Error('Open a supported watch page before starting a party.');
    }
    if (!match.isWatchPage) {
      throw new Error(
        `Open a ${match.streamingService.descriptor.label} watch page to start a party.`,
      );
    }

    const expectedMediaId = match.streamingService.extractMediaId(new URL(tab.url!));
    const playback = await this.requestPlaybackFromTab(tabId);

    if (!playback || playback.mediaId !== expectedMediaId) {
      throw new Error(
        `${match.streamingService.descriptor.label} playback state is not ready yet.`,
      );
    }

    return { streamingServiceId: match.streamingServiceId, playback };
  }

  private async requestPlaybackFromTab(tabId: number): Promise<PlaybackUpdate | null> {
    try {
      const response = await sendMessage('party:request-playback', undefined, { tabId });
      return response ?? null;
    } catch {
      return null;
    }
  }

  private async adoptTabForRoom(
    tabId: number,
    mediaId: string,
    room: PartySnapshot | null,
  ): Promise<void> {
    if (!roomMatchesMediaId(room, mediaId) || (await getBackgroundState()).controlledTab) return;

    void sendMessage('party:apply-snapshot', room, { tabId }).catch(() => undefined);
    await setControlledTab({ tabId, mediaId });
    await setLastWarning(null);
  }

  private async handleTabUpdated(tabId: number, url: string | undefined): Promise<void> {
    const { controlledTab, session } = await getBackgroundState();
    if (tabId !== controlledTab?.tabId || !url || !session) {
      return;
    }

    const sessionStreamingService = getStreamingServiceDefinition(session.streamingServiceId);
    if (sessionStreamingService && !isStreamingServiceUrl(sessionStreamingService, url)) {
      await setLastWarning(`The controlled tab left ${sessionStreamingService.descriptor.label}.`);
    }
  }

  private async handleTabRemoved(tabId: number): Promise<void> {
    if ((await getBackgroundState()).controlledTab?.tabId !== tabId) {
      return;
    }

    await clearControlledTab();
    this.options.onControlledTabClosed();
  }
}
