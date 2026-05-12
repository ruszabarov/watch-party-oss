import { STREAMING_SERVICE_DEFINITION_BY_ID } from '@open-watch-party/shared';
import { defineContentScript } from 'wxt/utils/define-content-script';

import { runNetflixPlayerContentScript } from '../streaming-services/netflix/player-content-script';

export default defineContentScript({
  matches: [...STREAMING_SERVICE_DEFINITION_BY_ID.netflix.contentMatches],
  runAt: 'document_start',
  world: 'MAIN',
  main: runNetflixPlayerContentScript,
});
