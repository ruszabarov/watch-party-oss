/**
 * Background-side registration of the content-script ↔ background port.
 *
 * Each content script opens one port per tab (name = `CONTENT_PORT_NAME`)
 * on load, re-opens it after a service-worker restart, and keeps it alive
 * for the lifetime of the page. The background:
 *   • receives `context` / `playback-update` / `request-sync` pushes via
 *     the handler callbacks,
 *   • can push `apply-snapshot` commands via `applySnapshot(tabId, …)`
 *     and awaits the content script's reply,
 *   • learns a tab has gone away via `onDisconnect`, which supersedes the
 *     `tabs.onRemoved` / url-drift bookkeeping we used to do by hand.
 */

import type { PartySnapshot, PlaybackUpdate } from '@watch-party/shared';

import {
  CONTENT_PORT_NAME,
  type ApplySnapshotResult,
  type BackgroundToContent,
  type ContentToBackground,
  type ServiceContentContext,
} from './extension';

type Port = ReturnType<typeof browser.runtime.connect>;

export interface ContentPortHandlers {
  onConnect?(tabId: number): void;
  onDisconnect?(tabId: number): void;
  onContext(tabId: number, context: ServiceContentContext): void;
  onPlaybackUpdate(tabId: number, update: PlaybackUpdate): void;
  onRequestSync(tabId: number): void;
}

export interface ContentPortRegistry {
  /**
   * Send a snapshot to the content script in `tabId` and await its result.
   * Resolves with `null` when no content script is connected for that tab.
   */
  applySnapshot(
    tabId: number,
    snapshot: PartySnapshot,
  ): Promise<ApplySnapshotResult | null>;
}

interface TrackedPort {
  port: Port;
  pending: Map<number, (result: ApplySnapshotResult | null) => void>;
}

export function registerContentPortHandlers(
  handlers: ContentPortHandlers,
): ContentPortRegistry {
  const ports = new Map<number, TrackedPort>();
  let nextSnapshotId = 0;

  browser.runtime.onConnect.addListener((rawPort) => {
    if (rawPort.name !== CONTENT_PORT_NAME) {
      return;
    }

    const tabId = rawPort.sender?.tab?.id;
    if (tabId == null) {
      // Content scripts always have a tab; anything else is either a
      // mis-named port from another context or a test fixture. Hang up.
      rawPort.disconnect();
      return;
    }

    // If the tab already had a port (e.g. a rapid disconnect/reconnect
    // around a service-worker restart), tear the old one down so pending
    // requests resolve deterministically.
    const existing = ports.get(tabId);
    if (existing) {
      try {
        existing.port.disconnect();
      } catch {
        /* already gone */
      }
    }

    const tracked: TrackedPort = { port: rawPort, pending: new Map() };
    ports.set(tabId, tracked);
    handlers.onConnect?.(tabId);

    rawPort.onMessage.addListener((message: ContentToBackground) => {
      switch (message.type) {
        case 'context':
          handlers.onContext(tabId, message.context);
          return;
        case 'playback-update':
          handlers.onPlaybackUpdate(tabId, message.update);
          return;
        case 'request-sync':
          handlers.onRequestSync(tabId);
          return;
        case 'snapshot-reply': {
          const resolver = tracked.pending.get(message.id);
          if (!resolver) return;
          tracked.pending.delete(message.id);
          resolver(message.result);
          return;
        }
      }
    });

    rawPort.onDisconnect.addListener(() => {
      if (ports.get(tabId) !== tracked) {
        return;
      }
      ports.delete(tabId);
      for (const resolver of tracked.pending.values()) {
        resolver(null);
      }
      tracked.pending.clear();
      handlers.onDisconnect?.(tabId);
    });
  });

  return {
    applySnapshot(tabId, snapshot) {
      const tracked = ports.get(tabId);
      if (!tracked) {
        return Promise.resolve(null);
      }

      const id = ++nextSnapshotId;
      const envelope: BackgroundToContent = {
        type: 'apply-snapshot',
        id,
        snapshot,
      };

      return new Promise<ApplySnapshotResult | null>((resolve) => {
        tracked.pending.set(id, resolve);
        try {
          tracked.port.postMessage(envelope);
        } catch {
          tracked.pending.delete(id);
          resolve(null);
        }
      });
    },
  };
}
