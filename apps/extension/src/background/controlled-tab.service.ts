import { browser } from 'wxt/browser';
import type { PartySnapshot, PlaybackUpdate, StreamingServiceId } from '@open-watch-party/shared';
import { sendMessage } from '../messaging';
import {
  findStreamingServiceByUrl,
  getStreamingServiceDefinition,
} from '../streaming-services/catalog';
import { backgroundStore, backgroundSelectors } from './state';

function isStreamingServiceUrl(
  definition: { matchesUrl(url: URL): boolean },
  rawUrl: string,
): boolean {
  return URL.canParse(rawUrl) && definition.matchesUrl(new URL(rawUrl));
}

function roomMatchesMediaId(
  room: PartySnapshot | undefined,
  mediaId: string,
): room is PartySnapshot {
  return room !== undefined && room.playback.mediaId === mediaId;
}

export class ControlledTabService {
  registerEventHandlers(): void {
    browser.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
      const controlledTab = backgroundSelectors.controlledTab.get();
      if (tabId === controlledTab?.tabId && tab.url) {
        const session = backgroundSelectors.session.get();
        const sessionStreamingService = session
          ? getStreamingServiceDefinition(session.streamingServiceId)
          : null;
        if (sessionStreamingService && !isStreamingServiceUrl(sessionStreamingService, tab.url)) {
          backgroundStore.trigger.setLastWarning({
            message: `The controlled tab left ${sessionStreamingService.descriptor.label}.`,
          });
        }
      }
    });

    browser.tabs.onRemoved.addListener((tabId) => {
      if (backgroundSelectors.controlledTab.get()?.tabId === tabId) {
        backgroundStore.trigger.closeControlledTab();
      }
    });
  }

  async handleContentContext(tabId: number, mediaId: string): Promise<void> {
    const room = backgroundSelectors.room.get();
    if (!room) {
      return;
    }

    const controlledTab = backgroundSelectors.controlledTab.get();
    if (!controlledTab) {
      this.adoptTabForRoom(tabId, mediaId, room);
      return;
    }

    if (controlledTab.tabId !== tabId) {
      return;
    }

    const shouldRequestMediaSwitch =
      controlledTab.mediaId !== mediaId && room.playback.mediaId !== mediaId;

    backgroundStore.trigger.setControlledTab({
      tabId,
      mediaId,
      requestMediaSwitch: shouldRequestMediaSwitch,
    });

    if (!shouldRequestMediaSwitch) {
      await this.applySnapshotToControlledTab();
    }
  }

  async applySnapshotToControlledTab(): Promise<void> {
    const room = backgroundSelectors.room.get();
    const controlledTab = backgroundSelectors.controlledTab.get();
    if (!room || !controlledTab) return;

    if (controlledTab.mediaId !== room.playback.mediaId) {
      await this.navigateControlledTabToRoom(controlledTab.tabId, room.watchUrl, false);
      return;
    }

    void sendMessage('party:apply-snapshot', room, { tabId: controlledTab.tabId }).catch(
      () => undefined,
    );
    backgroundStore.trigger.setLastWarning({ message: null });
  }

  async navigateControlledTabToRoom(tabId: number, watchUrl: string, active = true): Promise<void> {
    if (backgroundSelectors.controlledTab.get()?.tabId === tabId) {
      backgroundStore.trigger.clearControlledTab();
    }
    backgroundStore.trigger.setLastWarning({ message: null });

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
    return tabId === backgroundSelectors.controlledTab.get()?.tabId;
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
      throw new Error(`Open a ${match.streamingService.descriptor.label} watch page to start a party.`);
    }

    const expectedMediaId = match.streamingService.extractMediaId(new URL(tab.url!));
    const playback = await this.requestPlaybackFromTab(tabId);

    if (!playback || playback.mediaId !== expectedMediaId) {
      throw new Error(`${match.streamingService.descriptor.label} playback state is not ready yet.`);
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

  private adoptTabForRoom(
    tabId: number,
    mediaId: string,
    room: PartySnapshot | undefined,
  ): void {
    if (!roomMatchesMediaId(room, mediaId) || backgroundSelectors.controlledTab.get()) return;

    void sendMessage('party:apply-snapshot', room, { tabId }).catch(() => undefined);
    backgroundStore.trigger.setControlledTab({ tabId, mediaId });
    backgroundStore.trigger.setLastWarning({ message: null });
  }
}
