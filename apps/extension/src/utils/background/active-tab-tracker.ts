import { browser } from 'wxt/browser';
import type { ServiceContentContext } from '../protocol/extension';
import { createLogger, getLogError } from '../logger';
import { sendMessage } from '../protocol/messaging';
import { findPluginByUrl } from '../services/registry';
import { syncPopupState } from './popup-state-item';
import type { BackgroundState } from './state';
import { createEmptyActiveTabSummary } from './state';

type BrowserTab = Parameters<Parameters<typeof browser.tabs.onUpdated.addListener>[0]>[2];
const log = createLogger('background:active-tab');

export class ActiveTabTracker {
  constructor(private readonly state: BackgroundState) {}

  registerEventHandlers(): void {
    browser.tabs.onActivated.addListener(async () => {
      await this.refreshActiveTab();
    });

    browser.tabs.onUpdated.addListener(async (_tabId, changeInfo) => {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        await this.refreshActiveTab();
      }
    });
  }

  async refreshActiveTab(notify = true): Promise<void> {
    log.trace({ notify }, 'active_tab:refresh_started');
    const [activeTab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!activeTab?.id) {
      log.trace('active_tab:missing');
      this.state.activeTab = createEmptyActiveTabSummary();
      this.state.contentContext = null;
      if (notify) {
        syncPopupState(this.state);
      }
      return;
    }

    this.state.activeTab = summarizeTab(activeTab);
    log.trace(
      {
        tabId: this.state.activeTab.tabId,
        activeServiceId: this.state.activeTab.activeServiceId,
        isWatchPage: this.state.activeTab.isWatchPage,
        url: this.state.activeTab.url,
      },
      'active_tab:summarized',
    );

    if (this.state.activeTab.activeServiceId) {
      const contentContext = await requestContextFromTab(activeTab.id);
      if (contentContext) {
        this.state.contentContext = contentContext;
        log.trace(
          {
            tabId: activeTab.id,
            mediaId: contentContext.mediaId,
            playbackReady: contentContext.playbackReady,
            issue: contentContext.issue,
          },
          'active_tab:content_context',
        );
      } else {
        log.trace({ tabId: activeTab.id }, 'active_tab:content_context_empty');
      }
    }

    if (notify) {
      syncPopupState(this.state);
    }
  }

  recordContentContext(tabId: number, context: ServiceContentContext): void {
    const isActiveTab = this.state.activeTab.tabId === tabId;
    if (isActiveTab) {
      log.trace(
        {
          tabId,
          mediaId: context.mediaId,
          playbackReady: context.playbackReady,
          issue: context.issue,
        },
        'active_tab:context_recorded',
      );
      this.state.contentContext = context;
      syncPopupState(this.state);
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

async function requestContextFromTab(tabId: number): Promise<ServiceContentContext | null> {
  try {
    const response = await sendMessage('party:request-context', undefined, { tabId });
    return response ?? null;
  } catch (error) {
    log.trace({ tabId, error: getLogError(error) }, 'active_tab:context_request_failed');
    return null;
  }
}
