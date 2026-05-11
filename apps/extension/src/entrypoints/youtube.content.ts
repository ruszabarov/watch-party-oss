import { STREAMING_SERVICE_DEFINITION_BY_ID } from '@open-watch-party/shared';
import { defineContentScript } from 'wxt/utils/define-content-script';

import { runYoutubeContentScript } from '../streaming-services/youtube/content-script';

export default defineContentScript({
  matches: [...STREAMING_SERVICE_DEFINITION_BY_ID.youtube.contentMatches],
  main: runYoutubeContentScript,
});
