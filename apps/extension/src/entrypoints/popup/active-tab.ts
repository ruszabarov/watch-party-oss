import { browser, type Browser } from 'wxt/browser';
import type { StreamingServiceId } from '@open-watch-party/shared';
import { findStreamingServiceByUrl } from '../../streaming-services/catalog';
import { assertNotUndefined } from '../../utils/assertions';

type BrowserTab = Browser.tabs.Tab;

export interface ActiveTabSummary {
  tabId: number;
  title: string;
  activeStreamingServiceId: StreamingServiceId | null;
  isWatchPage: boolean;
}

export async function queryActiveTabSummary(): Promise<ActiveTabSummary> {
  const [activeTab] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
    windowType: 'normal',
  });

  if (!activeTab) {
    throw new Error('No active browser tab found.');
  }

  return summarizeActiveTab(activeTab);
}

function summarizeActiveTab(tab: BrowserTab): ActiveTabSummary {
  const tabId = assertNotUndefined(tab.id);
  const classification = tab.url ? findStreamingServiceByUrl(tab.url) : null;

  return {
    tabId,
    title: tab.title ?? '',
    activeStreamingServiceId: classification?.streamingServiceId ?? null,
    isWatchPage: classification?.isWatchPage ?? false,
  };
}
