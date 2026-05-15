import { browser } from 'wxt/browser';
import type { PartySnapshot, PlaybackUpdate, StreamingServiceId } from '@open-watch-party/shared';
import { sendMessage, type WatchReport } from '../messaging';
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

export class ControlledTabService {
  constructor(
    private readonly options: {
      onControlledTabClosed: () => void;
      onControlledTabPlaybackReady: (playback: PlaybackUpdate) => void;
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

  async handleWatchReport(tabId: number, report: WatchReport): Promise<void> {
    const state = await getBackgroundState();
    const room = state.room;
    if (!room) {
      return;
    }

    if (report.streamingServiceId !== room.streamingServiceId) {
      return;
    }

    const controlledTab = state.controlledTab;
    if (!controlledTab) {
      await this.adoptTabForRoom(tabId, report, room);
      return;
    }

    if (controlledTab.tabId !== tabId) {
      return;
    }

    await setControlledTab({
      tabId,
      mediaId: report.mediaId,
    });

    this.options.onControlledTabPlaybackReady(toPlaybackUpdate(report));
  }

  async applySnapshotToControlledTab(): Promise<void> {
    const { room, controlledTab } = await getBackgroundState();
    if (!room || !controlledTab) return;

    const tabMediaId = await this.readWatchTabMediaId(controlledTab.tabId, room.streamingServiceId);
    if (tabMediaId !== room.playback.mediaId) {
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
    const report = await this.requestWatchReportFromTab(tabId);

    if (
      !report ||
      report.streamingServiceId !== match.streamingServiceId ||
      report.mediaId !== expectedMediaId
    ) {
      throw new Error(
        `${match.streamingService.descriptor.label} playback state is not ready yet.`,
      );
    }

    return { streamingServiceId: match.streamingServiceId, playback: toPlaybackUpdate(report) };
  }

  private async requestWatchReportFromTab(tabId: number): Promise<WatchReport | null> {
    try {
      const response = await sendMessage('party:request-watch-report', undefined, { tabId });
      return response ?? null;
    } catch {
      return null;
    }
  }

  private async adoptTabForRoom(
    tabId: number,
    report: WatchReport,
    room: PartySnapshot,
  ): Promise<void> {
    if (room.playback.mediaId !== report.mediaId) {
      return;
    }

    void sendMessage('party:apply-snapshot', room, { tabId }).catch(() => undefined);
    await setControlledTab({ tabId, mediaId: report.mediaId });
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

  private async readWatchTabMediaId(
    tabId: number,
    streamingServiceId: StreamingServiceId,
  ): Promise<string | null> {
    const tab = await browser.tabs.get(tabId);
    const match = findStreamingServiceByUrl(tab.url);
    if (!match || match.streamingServiceId !== streamingServiceId || !match.isWatchPage) {
      return null;
    }

    return match.streamingService.extractMediaId(new URL(tab.url!));
  }
}

function toPlaybackUpdate(report: WatchReport): PlaybackUpdate {
  return {
    mediaId: report.mediaId,
    title: report.title ?? '',
    positionSec: report.positionSec,
    playing: report.playing,
  };
}
