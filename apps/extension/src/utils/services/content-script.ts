import type { ServiceContentContext } from '../protocol/extension';
import { onMessage, sendMessage } from '../protocol/messaging';
import type { ServicePlugin } from './types';

/**
 * Wraps a `ServicePlugin` as a WXT content-script entrypoint. The matcher
 * array comes straight from the plugin so the manifest stays in sync with
 * the runtime classifier, and the plugin's adapter handles all DOM
 * interaction.
 *
 * Use this in every service entrypoint:
 *
 *     export default createServiceContentScript(NETFLIX_SERVICE);
 */
export function createServiceContentScript(plugin: ServicePlugin) {
  return defineContentScript({
    matches: [...plugin.contentMatches],
    main() {
      const adapter = plugin.createAdapter();

      const stopObserving = adapter.observe(
        (context) => {
          void sendMessage('content:context', context).catch(() => undefined);
        },
        (update) => {
          void sendMessage('content:playback-update', update).catch(() => undefined);
        },
      );

      void sendMessage('content:request-sync').catch(() => undefined);

      const removeContextListener = onMessage('party:request-context', () => {
        return adapter.getContext();
      });

      const removeSnapshotListener = onMessage('party:apply-snapshot', ({ data }) => {
        return adapter.applySnapshot(data.snapshot);
      });

      window.addEventListener('beforeunload', () => {
        stopObserving();
        removeContextListener();
        removeSnapshotListener();
      });
    },
  });
}
