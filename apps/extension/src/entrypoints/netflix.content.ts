import type { BackgroundToContentMessage } from '../lib/protocol/extension';

import { createNetflixAdapter } from '../lib/services/netflix';

const adapter = createNetflixAdapter();

export default defineContentScript({
  matches: ['*://*.netflix.com/*'],
  main() {
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

    browser.runtime.onMessage.addListener((message: BackgroundToContentMessage) => {
      if (message.type === 'party:request-context') {
        return Promise.resolve(adapter.getContext());
      }

      if (message.type === 'party:apply-snapshot') {
        return adapter.applySnapshot(message.payload.snapshot);
      }

      return undefined;
    });

    window.addEventListener('beforeunload', () => {
      stopObserving();
    });
  },
});
