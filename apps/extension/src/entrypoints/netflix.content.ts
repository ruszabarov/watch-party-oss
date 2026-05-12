import { STREAMING_SERVICE_DEFINITION_BY_ID } from '@open-watch-party/shared';
import { defineContentScript } from 'wxt/utils/define-content-script';

import { runNetflixContentScript } from '../streaming-services/netflix/content-script';

export default defineContentScript({
  matches: [...STREAMING_SERVICE_DEFINITION_BY_ID.netflix.contentMatches],
  main: runNetflixContentScript,
});
