import type { StreamingServiceId } from '@open-watch-party/shared';

import { NETFLIX_STREAMING_SERVICE } from './netflix';
import { YOUTUBE_STREAMING_SERVICE } from './youtube';
import type { StreamingServiceIntegration } from './types';

/**
 * Every streaming service the extension knows about. Order drives popup rendering.
 *
 * Adding a streaming service:
 *   1. Add its shared definition to `packages/shared/src/streaming-services.ts`.
 *   2. Create the extension DOM integration at `apps/extension/src/streaming-services/<id>.ts`.
 *   3. Add a one-line entrypoint at `src/entrypoints/<id>.content.ts` via
 *      `runStreamingServiceContentScript('my-streaming-service-id', MY_STREAMING_SERVICE)`.
 *   4. Append the integration below.
 */
export const STREAMING_SERVICE_INTEGRATION_BY_ID = {
  netflix: NETFLIX_STREAMING_SERVICE,
  youtube: YOUTUBE_STREAMING_SERVICE,
} satisfies Record<StreamingServiceId, StreamingServiceIntegration>;

export function getStreamingServiceIntegration(
  id: StreamingServiceId | null | undefined,
): StreamingServiceIntegration | null {
  return id ? STREAMING_SERVICE_INTEGRATION_BY_ID[id] : null;
}
