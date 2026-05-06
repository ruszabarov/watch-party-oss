import { browser } from 'wxt/browser';
import type { PartySnapshot, PlaybackUpdateDraft } from '@open-watch-party/shared';
import type { ApplySnapshotResult, WatchPageContext } from '../protocol/extension';
import { sendMessage } from '../protocol/messaging';
import { getPlugin } from '../services/plugins';
import { selectRoom, selectSession, type BackgroundState, type BackgroundStore } from './state';
import type { BackgroundBus } from './bus';

interface ControllableWatchTabState {
  context: WatchPageContext;
  playback: PlaybackUpdateDraft;
}

function isPluginUrl(plugin: { matchesUrl(url: URL): boolean }, rawUrl: string): boolean {
  return URL.canParse(rawUrl) && plugin.matchesUrl(new URL(rawUrl));
}

export class ControlledTabService {
  constructor(
    private readonly store: BackgroundStore,
    private readonly bus: BackgroundBus,
  ) {}

  private get state(): BackgroundState {
    return this.store.getSnapshot().context;
  }

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
          this.store.trigger.setLastWarning({
            message: `The controlled tab left ${sessionPlugin.descriptor.label}.`,
          });
        }
      }
    });

    browser.tabs.onRemoved.addListener((tabId) => {
      if (this.state.controlledTab?.tabId === tabId) {
        const session = selectSession(this.state);
        const sessionPlugin = session ? getPlugin(session.serviceId) : null;
        this.store.trigger.clearControlledTab();
        this.store.trigger.setLastWarning({
          message: sessionPlugin
            ? `The controlled ${sessionPlugin.descriptor.label} tab was closed.`
            : 'The controlled tab was closed.',
        });
      }
    });
  }

  recordContentContext(tabId: number, context: WatchPageContext | null): void {
    if (this.state.controlledTab?.tabId !== tabId) {
      return;
    }

    if (!context) {
      this.store.trigger.clearControlledTab();
      return;
    }

    this.store.trigger.setControlledTab({ tabId, context });
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
      if (context?.serviceId === room.serviceId && context.mediaId === room.playback.mediaId) {
        this.store.trigger.setControlledTab({ tabId, context });
      }
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

    if (
      controlledTab.context.serviceId !== room.serviceId ||
      controlledTab.context.mediaId !== room.playback.mediaId
    ) {
      await this.navigateControlledTabToRoom(controlledTab.tabId, room.watchUrl, {
        active: false,
      });
      return;
    }

    const result = await this.applySnapshotToTab(controlledTab.tabId, room);

    if (!result) {
      this.store.trigger.setLastWarning({
        message: sessionPlugin
          ? `${sessionPlugin.descriptor.label} tab is not ready for sync yet.`
          : 'Controlled tab is not ready for sync yet.',
      });
      return;
    }

    this.store.trigger.setLastWarning({
      message: result.applied ? null : (result.reason ?? 'Sync was skipped.'),
    });
  }

  async navigateControlledTabToRoom(
    tabId: number,
    watchUrl: string,
    options: { active?: boolean } = {},
  ): Promise<void> {
    if (this.state.controlledTab?.tabId === tabId) {
      this.store.trigger.clearControlledTab();
    }
    this.store.trigger.setLastWarning({ message: null });

    try {
      await browser.tabs.update(tabId, {
        url: watchUrl,
        ...(options.active === undefined ? { active: true } : { active: options.active }),
      });
    } catch (error) {
      throw new Error('Could not open the room video in the current tab.', { cause: error });
    }
  }

  async requireControllableWatchTab(tabId: number): Promise<ControllableWatchTabState> {
    const context = await this.requestContextFromTab(tabId);
    if (!context) {
      throw new Error('Open a supported watch page before starting a party.');
    }

    const plugin = getPlugin(context.serviceId);
    if (!plugin) {
      throw new Error('This tab is not on a supported streaming service.');
    }

    const playback = await this.requestPlaybackFromTab(tabId);

    if (!playback || playback.mediaId !== context.mediaId) {
      throw new Error(`${plugin.descriptor.label} playback state is not ready yet.`);
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
