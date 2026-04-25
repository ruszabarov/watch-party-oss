import { browser } from 'wxt/browser';
import type { PartySnapshot, PlaybackUpdateDraft } from '@open-watch-party/shared';

import type { ApplySnapshotResult, ServiceContentContext } from '../protocol/extension';
import { sendMessage } from '../protocol/messaging';
import { getPlugin, findPluginByUrl } from '../services/registry';
import { emitStateChanged } from './notifier';
import type { BackgroundState } from './state';
import { createEmptyActiveTabSummary } from './state';

type BrowserTab = Parameters<Parameters<typeof browser.tabs.onUpdated.addListener>[0]>[2];

type ReadyServiceContentContext = ServiceContentContext & {
  playbackReady: true;
  mediaId: string;
};

function isReadyServiceContentContext(
  context: ServiceContentContext | null,
): context is ReadyServiceContentContext {
  return Boolean(context?.playbackReady && context.mediaId);
}

interface ControllableWatchTab {
  context: ReadyServiceContentContext;
  playback: PlaybackUpdateDraft;
}

interface TabSyncDependencies {
  readonly state: BackgroundState;
  readonly getRoom: () => PartySnapshot | null;
  readonly onControlledPlaybackUpdate: (
    update: PlaybackUpdateDraft,
    isLocalRelay: true,
  ) => Promise<void>;
}

export class TabSyncService {
  private readonly contentContexts = new Map<number, ServiceContentContext>();

  private pendingControlledNavigationUrl: string | null = null;

  constructor(private readonly deps: TabSyncDependencies) {}

  registerEventHandlers(): void {
    browser.tabs.onActivated.addListener(async () => {
      await this.refreshActiveTab();
    });

    browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        await this.refreshActiveTab();
      }

      if (
        tabId === this.deps.state.controlledTabId &&
        this.pendingControlledNavigationUrl &&
        tab.url &&
        tab.url === this.pendingControlledNavigationUrl
      ) {
        this.deps.state.lastWarning = null;
        emitStateChanged(this.deps.state);
      }

      if (tabId === this.deps.state.controlledTabId && tab.url) {
        const sessionPlugin = this.deps.state.session
          ? getPlugin(this.deps.state.session.serviceId)
          : null;
        if (sessionPlugin && !sessionPlugin.parseUrl(tab.url)) {
          this.deps.state.lastWarning = `The controlled tab left ${sessionPlugin.descriptor.label}.`;
          emitStateChanged(this.deps.state);
        }
      }
    });

    browser.tabs.onRemoved.addListener((tabId) => {
      this.contentContexts.delete(tabId);

      if (this.deps.state.controlledTabId === tabId) {
        const sessionPlugin = this.deps.state.session
          ? getPlugin(this.deps.state.session.serviceId)
          : null;
        this.deps.state.controlledTabId = null;
        this.deps.state.contentContext = null;
        this.deps.state.lastWarning = sessionPlugin
          ? `The controlled ${sessionPlugin.descriptor.label} tab was closed.`
          : 'The controlled tab was closed.';
        emitStateChanged(this.deps.state);
      }
    });
  }

  async refreshActiveTab(notify = true): Promise<void> {
    const [activeTab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!activeTab?.id) {
      this.deps.state.activeTab = createEmptyActiveTabSummary();
      this.deps.state.contentContext = null;
      if (notify) {
        emitStateChanged(this.deps.state);
      }
      return;
    }

    this.deps.state.activeTab = summarizeTab(activeTab);
    this.deps.state.contentContext = this.contentContexts.get(activeTab.id) ?? null;

    if (this.deps.state.activeTab.activeServiceId) {
      const contentContext = await this.requestContextFromTab(activeTab.id);

      if (contentContext) {
        this.deps.state.contentContext = contentContext;
        this.contentContexts.set(activeTab.id, contentContext);
      }
    }

    if (notify) {
      emitStateChanged(this.deps.state);
    }
  }

  recordContentContext(tabId: number, context: ServiceContentContext): void {
    this.contentContexts.set(tabId, context);

    const isControlledTab = this.deps.state.controlledTabId === tabId;
    const isActiveTab = this.deps.state.activeTab.tabId === tabId;
    if (isControlledTab || isActiveTab) {
      this.deps.state.contentContext = context;
    }

    emitStateChanged(this.deps.state);
  }

  async relayControlledPlaybackUpdate(tabId: number, update: PlaybackUpdateDraft): Promise<void> {
    if (tabId !== this.deps.state.controlledTabId) {
      return;
    }

    await this.deps.onControlledPlaybackUpdate(update, true);
  }

  async requestSync(tabId: number): Promise<void> {
    if (!this.deps.getRoom()) {
      return;
    }

    this.deps.state.controlledTabId ??= tabId;
    if (this.deps.state.controlledTabId === tabId) {
      this.pendingControlledNavigationUrl = null;
    }
    await this.applySnapshotToControlledTab();
  }

  async applySnapshotToControlledTab(): Promise<void> {
    const room = this.deps.getRoom();
    if (!room || this.deps.state.controlledTabId == null) {
      return;
    }

    if (this.pendingControlledNavigationUrl) {
      return;
    }

    const sessionPlugin = this.deps.state.session
      ? getPlugin(this.deps.state.session.serviceId)
      : null;

    const controlledContext = this.getControlledTabContext();
    if (
      controlledContext &&
      controlledContext.mediaId !== room.playback.mediaId
    ) {
      await this.navigateControlledTabToRoom(this.deps.state.controlledTabId, room.watchUrl, {
        active: false,
      });
      return;
    }

    const result = await this.applySnapshotToTab(this.deps.state.controlledTabId, room);

    if (!result) {
      this.deps.state.lastWarning = sessionPlugin
        ? `${sessionPlugin.descriptor.label} tab is not ready for sync yet.`
        : 'Controlled tab is not ready for sync yet.';
      return;
    }

    if (result.context) {
      this.contentContexts.set(this.deps.state.controlledTabId, result.context);
      this.deps.state.contentContext = result.context;
    }

    this.deps.state.lastWarning = result.applied ? null : (result.reason ?? 'Sync was skipped.');
  }

  async navigateControlledTabToRoom(
    tabId: number,
    watchUrl: string,
    options: { active?: boolean } = {},
  ): Promise<void> {
    this.pendingControlledNavigationUrl = watchUrl;
    this.deps.state.lastWarning = null;
    emitStateChanged(this.deps.state);

    try {
      await browser.tabs.update(tabId, {
        url: watchUrl,
        ...(options.active === undefined ? { active: true } : { active: options.active }),
      });
    } catch {
      this.pendingControlledNavigationUrl = null;
      throw new Error('Could not open the room video in the current tab.');
    }
  }

  async requireControllableWatchTab(): Promise<ControllableWatchTab> {
    if (!this.deps.state.activeTab.tabId || !this.deps.state.activeTab.isWatchPage) {
      throw new Error('Open a supported watch page before starting a party.');
    }

    const plugin = getPlugin(this.deps.state.activeTab.activeServiceId);
    if (!plugin) {
      throw new Error('This tab is not on a supported streaming service.');
    }

    const context = this.deps.state.contentContext;
    if (!isReadyServiceContentContext(context)) {
      throw new Error(`${plugin.descriptor.label} player is not ready yet.`);
    }

    if (context.serviceId !== plugin.id) {
      throw new Error('Active tab and reported service disagree. Refresh the tab.');
    }

    const playback = await this.requestPlaybackFromTab(this.deps.state.activeTab.tabId);

    if (!playback || playback.mediaId !== context.mediaId) {
      throw new Error(`${plugin.descriptor.label} playback state is not ready yet.`);
    }

    return { context, playback };
  }

  getControlledTabContext(): ServiceContentContext | null {
    return this.contentContexts.get(this.deps.state.controlledTabId ?? -1) ?? null;
  }

  private async requestContextFromTab(tabId: number): Promise<ServiceContentContext | null> {
    try {
      const response = await sendMessage('party:request-context', undefined, { tabId });
      return response ?? null;
    } catch {
      return null;
    }
  }

  private async requestPlaybackFromTab(tabId: number): Promise<PlaybackUpdateDraft | null> {
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
      const response = await sendMessage('party:apply-snapshot', { snapshot }, { tabId });
      return response ?? null;
    } catch {
      return null;
    }
  }
}

function summarizeTab(tab: BrowserTab) {
  const url = tab.url ?? '';
  const classification = findPluginByUrl(url);

  return {
    tabId: tab.id ?? null,
    title: tab.title ?? '',
    url,
    activeServiceId: classification?.plugin.id ?? null,
    isWatchPage: classification?.isWatchPage ?? false,
  };
}
