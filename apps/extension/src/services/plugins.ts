import type { ServiceId } from '@open-watch-party/shared';

import { NETFLIX_SERVICE } from './netflix';
import { YOUTUBE_SERVICE } from './youtube';
import type { ServicePlugin } from './types';

/**
 * Every service the extension knows about. Order drives popup rendering.
 *
 * Adding a service:
 *   1. Add its shared definition to `packages/shared/src/services.ts`.
 *   2. Create the extension DOM integration at `apps/extension/src/services/<id>.ts`.
 *   3. Add a one-line entrypoint at `src/entrypoints/<id>.content.ts` via
 *      `runServiceContentScript('my-service-id', MY_SERVICE)`.
 *   4. Append the plugin below.
 */
export const SERVICE_PLUGIN_BY_ID = {
  netflix: NETFLIX_SERVICE,
  youtube: YOUTUBE_SERVICE,
} satisfies Record<ServiceId, ServicePlugin>;

export function getPlugin(id: ServiceId | null | undefined): ServicePlugin | null {
  return id ? SERVICE_PLUGIN_BY_ID[id] : null;
}
