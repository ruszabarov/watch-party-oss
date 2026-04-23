import type { BackgroundToContentMessage } from '../protocol/extension';
import type { ServicePlugin } from './types';

/**
 * Wraps a `ServicePlugin` as a WXT content-script entrypoint. The matcher
 * array comes straight from the plugin so the manifest stays in sync with the
 * runtime classifier, and the plugin's adapter handles all DOM interaction.
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
          void browser.runtime.sendMessage({
            type: 'content:context',
            payload: context,
          });
        },
        (update) => {
          void browser.runtime.sendMessage({
            type: 'content:playback-update',
            payload: update,
          });
        },
      );

      void browser.runtime.sendMessage({ type: 'content:request-sync' });

      const handleRuntimeMessage = (message: BackgroundToContentMessage) => {
        if (message.type === 'party:request-context') {
          return Promise.resolve(adapter.getContext());
        }

        if (message.type === 'party:apply-snapshot') {
          return adapter.applySnapshot(message.payload.snapshot);
        }

        return undefined;
      };

      browser.runtime.onMessage.addListener(handleRuntimeMessage);

      const handleBeforeUnload = () => {
        stopObserving();
        browser.runtime.onMessage.removeListener(handleRuntimeMessage);
      };

      window.addEventListener('beforeunload', handleBeforeUnload);
    },
  });
}
