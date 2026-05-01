import { browser } from 'wxt/browser';
import type { PartySnapshot, PlaybackUpdateDraft } from '@open-watch-party/shared';
import type { ApplySnapshotResult, ServiceContentContext } from '../protocol/extension';
import { sendMessage } from '../protocol/messaging';
import { getPlugin } from '../services/registry';
import {
  clearControlledTab,
  selectRoom,
  selectSession,
  setControlledTab,
  syncBackgroundState,
  type BackgroundState,
} from './state';
import type { BackgroundBus } from './bus';

interface ControllableWatchTab {
  tabId: number;
  context: ServiceContentContext;
  playback: PlaybackUpdateDraft;
}

function isPluginUrl(plugin: { matchesUrl(url: URL): boolean }, rawUrl: string): boolean {
  return URL.canParse(rawUrl) && plugin.matchesUrl(new URL(rawUrl));
}

export class ControlledTabService {
  constructor(
    private readonly state: BackgroundState,
    private readonly bus: BackgroundBus,
  ) {}

  registerEventHandlers(): void {
    this.bus.on('session:snapshot-updated', () => {
      void this.applySnapshotToControlledTab().catch(() => undefined);
    });

    browser.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
      const controlledTab = this.state.controlledTab;
      if (tabId === controlledTab?.tabId && tab.url) {
        const session = selectSession(this.state);
        const sessionPlugin = session ? getPlugin(session.serviceId) : null;
        if (sessionPlugin && !isPluginUrl(sessionPlugin, tab.url)) {
          this.state.lastWarning = `The controlled tab left ${sessionPlugin.descriptor.label}.`;
          syncBackgroundState(this.state);
        }
      }
    });

    browser.tabs.onRemoved.addListener((tabId) => {
      if (this.state.controlledTab?.tabId === tabId) {
        const session = selectSession(this.state);
        const sessionPlugin = session ? getPlugin(session.serviceId) : null;
        clearControlledTab(this.state);
        this.state.lastWarning = sessionPlugin
          ? `The controlled ${sessionPlugin.descriptor.label} tab was closed.`
          : 'The controlled tab was closed.';
        syncBackgroundState(this.state);
      }
    });
  }

  recordContentContext(tabId: number, context: ServiceContentContext | null): void {
    if (this.state.controlledTab?.tabId !== tabId) {
      return;
    }

    if (!context) {
      clearControlledTab(this.state);
      syncBackgroundState(this.state);
      return;
    }

    setControlledTab(this.state, tabId, context);
    syncBackgroundState(this.state);
  }

  relayControlledPlaybackUpdate(tabId: number, update: PlaybackUpdateDraft): void {
    if (tabId !== this.state.controlledTab?.tabId) {
      return;
    }

    this.bus.emit('controlled-tab:playback-update', { update });
  }

  async requestSync(tabId: number): Promise<void> {
    const room = selectRoom(this.state);
    if (!room) {
      return;
    }

    if (!this.state.controlledTab) {
      const context = await this.requestContextFromTab(tabId);
      if (context?.mediaId === room.playback.mediaId) {
        setControlledTab(this.state, tabId, context);
      }
    }

    if (this.state.controlledTab?.tabId === tabId) {
      syncBackgroundState(this.state);
    }
    await this.applySnapshotToControlledTab();
  }

  async applySnapshotToControlledTab(): Promise<void> {
    const room = selectRoom(this.state);
    const controlledTab = this.state.controlledTab;
    if (!room || !controlledTab) {
      return;
    }

    const session = selectSession(this.state);
    const sessionPlugin = session ? getPlugin(session.serviceId) : null;

    if (controlledTab.context.mediaId !== room.playback.mediaId) {
      await this.navigateControlledTabToRoom(controlledTab.tabId, room.watchUrl, {
        active: false,
      });
      return;
    }

    const result = await this.applySnapshotToTab(controlledTab.tabId, room);

    if (!result) {
      this.state.lastWarning = sessionPlugin
        ? `${sessionPlugin.descriptor.label} tab is not ready for sync yet.`
        : 'Controlled tab is not ready for sync yet.';
      return;
    }

    if (result.context) {
      setControlledTab(this.state, controlledTab.tabId, result.context);
    } else {
      clearControlledTab(this.state);
    }

    this.state.lastWarning = result.applied ? null : (result.reason ?? 'Sync was skipped.');
  }

  async navigateControlledTabToRoom(
    tabId: number,
    watchUrl: string,
    options: { active?: boolean } = {},
  ): Promise<void> {
    if (this.state.controlledTab?.tabId === tabId) {
      clearControlledTab(this.state);
    }
    this.state.lastWarning = null;
    syncBackgroundState(this.state);

    try {
      await browser.tabs.update(tabId, {
        url: watchUrl,
        ...(options.active === undefined ? { active: true } : { active: options.active }),
      });
    } catch (error) {
      throw new Error('Could not open the room video in the current tab.', { cause: error });
    }
  }

  async requireControllableWatchTab(tabId: number): Promise<ControllableWatchTab> {
    const context = await this.requestContextFromTab(tabId);
    if (!context) {
      throw new Error('Open a supported watch page before starting a party.');
    }

    const plugin = getPlugin(context.serviceId);
    if (!plugin) {
      throw new Error('This tab is not on a supported streaming service.');
    }

    if (plugin.extractMediaId(new URL(context.href)) === null) {
      throw new Error(`${plugin.descriptor.label} tab is not on a supported watch page.`);
    }

    const playback = await this.requestPlaybackFromTab(tabId);

    if (!playback || playback.mediaId !== context.mediaId) {
      throw new Error(`${plugin.descriptor.label} playback state is not ready yet.`);
    }

    return { tabId, context, playback };
  }

  getControlledTabContext(): ServiceContentContext | null {
    return this.state.controlledTab?.context ?? null;
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
