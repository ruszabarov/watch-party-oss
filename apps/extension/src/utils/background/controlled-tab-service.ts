import { browser } from 'wxt/browser';
import type { PartySnapshot, PlaybackUpdateDraft } from '@open-watch-party/shared';
import type { ApplySnapshotResult, ServiceContentContext } from '../protocol/extension';
import { createLogger, getLogError } from '../logger';
import { sendMessage } from '../protocol/messaging';
import { getPlugin } from '../services/registry';
import { syncPopupState } from './popup-state-item';
import type { BackgroundState } from './state';
import type { ActiveTabTracker } from './active-tab-tracker';

type ReadyServiceContentContext = ServiceContentContext & {
  playbackReady: true;
  mediaId: string;
};
const log = createLogger('background:controlled-tab');

function isReadyServiceContentContext(
  context: ServiceContentContext | null,
): context is ReadyServiceContentContext {
  return Boolean(context?.playbackReady && context.mediaId);
}

interface ControllableWatchTab {
  context: ReadyServiceContentContext;
  playback: PlaybackUpdateDraft;
}

interface ControlledTabDependencies {
  readonly state: BackgroundState;
  readonly getRoom: () => PartySnapshot | null;
  readonly onControlledPlaybackUpdate: (
    update: PlaybackUpdateDraft,
    isLocalRelay: true,
  ) => Promise<void>;
}

export class ControlledTabService {
  private pendingControlledNavigationUrl: string | null = null;
  private controlledContext: ServiceContentContext | null = null;

  constructor(
    private readonly deps: ControlledTabDependencies,
    private readonly activeTabTracker: ActiveTabTracker,
  ) {}

  registerEventHandlers(): void {
    browser.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
      if (
        tabId === this.deps.state.controlledTabId &&
        this.pendingControlledNavigationUrl &&
        tab.url &&
        tab.url === this.pendingControlledNavigationUrl
      ) {
        log.trace({ tabId, url: tab.url }, 'controlled_tab:navigation_completed');
        this.deps.state.lastWarning = null;
        syncPopupState(this.deps.state);
      }

      if (tabId === this.deps.state.controlledTabId && tab.url) {
        const sessionPlugin = this.deps.state.session
          ? getPlugin(this.deps.state.session.serviceId)
          : null;
        if (sessionPlugin && !sessionPlugin.parseUrl(tab.url)) {
          log.warn({ tabId, url: tab.url }, 'controlled_tab:left_service');
          this.deps.state.lastWarning = `The controlled tab left ${sessionPlugin.descriptor.label}.`;
          syncPopupState(this.deps.state);
        }
      }
    });

    browser.tabs.onRemoved.addListener((tabId) => {
      if (this.deps.state.controlledTabId === tabId) {
        log.warn({ tabId }, 'controlled_tab:removed');
        this.controlledContext = null;
        const sessionPlugin = this.deps.state.session
          ? getPlugin(this.deps.state.session.serviceId)
          : null;
        this.deps.state.controlledTabId = null;
        this.deps.state.contentContext = null;
        this.deps.state.lastWarning = sessionPlugin
          ? `The controlled ${sessionPlugin.descriptor.label} tab was closed.`
          : 'The controlled tab was closed.';
        syncPopupState(this.deps.state);
      }
    });
  }

  recordContentContext(tabId: number, context: ServiceContentContext): void {
    const isControlledTab = this.deps.state.controlledTabId === tabId;
    if (isControlledTab) {
      log.trace(
        {
          tabId,
          mediaId: context.mediaId,
          playbackReady: context.playbackReady,
          issue: context.issue,
        },
        'controlled_tab:context_recorded',
      );
      this.controlledContext = context;
      this.deps.state.contentContext = context;
      syncPopupState(this.deps.state);
    }
  }

  async relayControlledPlaybackUpdate(tabId: number, update: PlaybackUpdateDraft): Promise<void> {
    if (tabId !== this.deps.state.controlledTabId) {
      log.trace(
        {
          tabId,
          controlledTabId: this.deps.state.controlledTabId,
          mediaId: update.mediaId,
        },
        'controlled_tab:playback_update_ignored',
      );
      return;
    }

    log.debug(
      {
        tabId,
        mediaId: update.mediaId,
        playing: update.playing,
        positionSec: update.positionSec,
      },
      'controlled_tab:playback_update_relayed',
    );
    await this.deps.onControlledPlaybackUpdate(update, true);
  }

  async requestSync(tabId: number): Promise<void> {
    if (!this.deps.getRoom()) {
      log.trace({ tabId }, 'controlled_tab:sync_skipped_without_room');
      return;
    }

    this.deps.state.controlledTabId ??= tabId;
    if (this.deps.state.controlledTabId === tabId) {
      this.pendingControlledNavigationUrl = null;
    }
    log.debug(
      { tabId, controlledTabId: this.deps.state.controlledTabId },
      'controlled_tab:sync_requested',
    );
    await this.applySnapshotToControlledTab();
  }

  async applySnapshotToControlledTab(): Promise<void> {
    const room = this.deps.getRoom();
    if (!room || this.deps.state.controlledTabId == null) {
      log.trace(
        {
          hasRoom: Boolean(room),
          controlledTabId: this.deps.state.controlledTabId,
        },
        'controlled_tab:apply_skipped_missing_target',
      );
      return;
    }

    if (this.pendingControlledNavigationUrl) {
      log.trace(
        {
          tabId: this.deps.state.controlledTabId,
          pendingUrl: this.pendingControlledNavigationUrl,
        },
        'controlled_tab:apply_skipped_pending_navigation',
      );
      return;
    }

    const sessionPlugin = this.deps.state.session
      ? getPlugin(this.deps.state.session.serviceId)
      : null;

    if (this.controlledContext && this.controlledContext.mediaId !== room.playback.mediaId) {
      log.debug(
        {
          tabId: this.deps.state.controlledTabId,
          currentMediaId: this.controlledContext.mediaId,
          roomMediaId: room.playback.mediaId,
        },
        'controlled_tab:navigate_for_media_mismatch',
      );
      await this.navigateControlledTabToRoom(this.deps.state.controlledTabId, room.watchUrl, {
        active: false,
      });
      return;
    }

    const result = await this.applySnapshotToTab(this.deps.state.controlledTabId, room);

    if (!result) {
      log.trace({ tabId: this.deps.state.controlledTabId }, 'controlled_tab:apply_no_response');
      this.deps.state.lastWarning = sessionPlugin
        ? `${sessionPlugin.descriptor.label} tab is not ready for sync yet.`
        : 'Controlled tab is not ready for sync yet.';
      return;
    }

    if (result.context) {
      this.controlledContext = result.context;
      this.deps.state.contentContext = result.context;
    }

    this.deps.state.lastWarning = result.applied ? null : (result.reason ?? 'Sync was skipped.');
    log.debug(
      {
        tabId: this.deps.state.controlledTabId,
        applied: result.applied,
        reason: result.reason,
      },
      'controlled_tab:apply_result',
    );
  }

  async navigateControlledTabToRoom(
    tabId: number,
    watchUrl: string,
    options: { active?: boolean } = {},
  ): Promise<void> {
    this.pendingControlledNavigationUrl = watchUrl;
    this.deps.state.lastWarning = null;
    syncPopupState(this.deps.state);
    log.debug({ tabId, watchUrl, active: options.active }, 'controlled_tab:navigate');

    try {
      await browser.tabs.update(tabId, {
        url: watchUrl,
        ...(options.active === undefined ? { active: true } : { active: options.active }),
      });
    } catch (error) {
      this.pendingControlledNavigationUrl = null;
      log.warn({ tabId, watchUrl, error: getLogError(error) }, 'controlled_tab:navigate_failed');
      throw new Error('Could not open the room video in the current tab.', { cause: error });
    }
  }

  async requireControllableWatchTab(): Promise<ControllableWatchTab> {
    await this.activeTabTracker.refreshActiveTab(false);
    log.debug(
      {
        tabId: this.deps.state.activeTab.tabId,
        activeServiceId: this.deps.state.activeTab.activeServiceId,
        isWatchPage: this.deps.state.activeTab.isWatchPage,
      },
      'controlled_tab:require_started',
    );

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

    log.debug(
      {
        tabId: this.deps.state.activeTab.tabId,
        mediaId: playback.mediaId,
        playing: playback.playing,
        positionSec: playback.positionSec,
      },
      'controlled_tab:require_ok',
    );
    return { context, playback };
  }

  async getFreshActiveTabId(): Promise<number> {
    await this.activeTabTracker.refreshActiveTab(false);
    const tabId = this.deps.state.activeTab.tabId;
    if (tabId == null) {
      throw new Error('Open a browser tab before joining a room.');
    }
    return tabId;
  }

  getControlledTabContext(): ServiceContentContext | null {
    return this.controlledContext;
  }

  private async requestPlaybackFromTab(tabId: number): Promise<PlaybackUpdateDraft | null> {
    try {
      const response = await sendMessage('party:request-playback', undefined, { tabId });
      return response ?? null;
    } catch (error) {
      log.trace({ tabId, error: getLogError(error) }, 'controlled_tab:playback_request_failed');
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
    } catch (error) {
      log.trace({ tabId, error: getLogError(error) }, 'controlled_tab:apply_request_failed');
      return null;
    }
  }
}
