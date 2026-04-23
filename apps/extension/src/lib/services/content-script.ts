import {
  CONTENT_PORT_NAME,
  type BackgroundToContent,
  type ContentToBackground,
} from '../protocol/extension';
import type { ServicePlugin } from './types';

type Port = ReturnType<typeof browser.runtime.connect>;

/**
 * Wraps a `ServicePlugin` as a WXT content-script entrypoint.
 *
 * The content script maintains one long-lived port per tab:
 *   • pushes its current `ServiceContentContext` on every (re)connect,
 *   • streams subsequent context and playback updates over the same port,
 *   • replies to `apply-snapshot` commands with the adapter's result,
 *   • reconnects transparently if the service worker is recycled.
 */
export function createServiceContentScript(plugin: ServicePlugin) {
  return defineContentScript({
    matches: [...plugin.contentMatches],
    main() {
      const adapter = plugin.createAdapter();
      let port: Port | null = null;
      let disposed = false;

      const stopObserving = adapter.observe(
        (context) => {
          send({ type: 'context', context });
        },
        (update) => {
          send({ type: 'playback-update', update });
        },
      );

      function send(message: ContentToBackground): void {
        if (!port) return;
        try {
          port.postMessage(message);
        } catch {
          // The background port died between messages; the onDisconnect
          // listener below will handle reconnection.
        }
      }

      function connect(): void {
        if (disposed) return;

        port = browser.runtime.connect({ name: CONTENT_PORT_NAME });

        // Announce ourselves so the background has the latest context the
        // instant the port is alive. Subsequent updates flow through
        // `adapter.observe` above.
        send({ type: 'context', context: adapter.getContext() });
        send({ type: 'request-sync' });

        port.onMessage.addListener(async (raw) => {
          const message = raw as BackgroundToContent;
          if (message.type !== 'apply-snapshot') return;

          try {
            const result = await adapter.applySnapshot(message.snapshot);
            send({ type: 'snapshot-reply', id: message.id, result });
          } catch (error) {
            send({
              type: 'snapshot-reply',
              id: message.id,
              result: {
                applied: false,
                reason:
                  error instanceof Error ? error.message : 'Adapter failed.',
                context: null,
              },
            });
          }
        });

        port.onDisconnect.addListener(() => {
          port = null;
          if (disposed) return;
          // Service worker was recycled. Rebuild the port on the next tick;
          // the subsequent `connect()` will re-announce our current context.
          setTimeout(connect, 0);
        });
      }

      connect();

      window.addEventListener('beforeunload', () => {
        disposed = true;
        stopObserving();
        try {
          port?.disconnect();
        } catch {
          /* already disconnected */
        }
      });
    },
  });
}
