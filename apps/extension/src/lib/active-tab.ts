import { browser, type Browser } from 'wxt/browser';
import type { ServiceId } from '@open-watch-party/shared';
import { findServiceByUrl } from './services/registry';
import { assertNotUndefined } from './asserters';

type BrowserTab = Browser.tabs.Tab;

export interface ActiveTabSummary {
  tabId: number;
  title: string;
  activeServiceId: ServiceId | null;
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
  const classification = tab.url ? findServiceByUrl(tab.url) : null;

  return {
    tabId,
    title: tab.title ?? '',
    activeServiceId: classification?.serviceId ?? null,
    isWatchPage: classification?.isWatchPage ?? false,
  };
}
