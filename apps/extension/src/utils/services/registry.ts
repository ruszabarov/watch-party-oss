import { findServiceDefinitionByUrl, type ServiceId } from '@open-watch-party/shared';

import { NETFLIX_SERVICE } from './netflix';
import { YOUTUBE_SERVICE } from './youtube';
import type { ServicePlugin } from './types';

/**
 * Every service the extension knows about. Order drives popup rendering.
 *
 * Adding a service:
 *   1. Add its shared definition to `packages/shared/src/services.ts`.
 *   2. Create the extension DOM integration at `apps/extension/src/utils/services/<id>.ts`.
 *   3. Add a one-line entrypoint at `src/entrypoints/<id>.content.ts` via
 *      `runServiceContentScript('my-service-id')`.
 *   4. Append the plugin below.
 */
export const SERVICE_PLUGIN_BY_ID = {
  netflix: NETFLIX_SERVICE,
  youtube: YOUTUBE_SERVICE,
} satisfies Record<ServiceId, ServicePlugin>;

export const SERVICE_PLUGINS = Object.values(SERVICE_PLUGIN_BY_ID);

type ServicePluginDescriptor = ServicePlugin['descriptor'];

export const SUPPORTED_SERVICE_DESCRIPTORS: readonly ServicePluginDescriptor[] =
  SERVICE_PLUGINS.map((p) => p.descriptor);

export function getPlugin(id: ServiceId | null | undefined): ServicePlugin | null {
  return id ? SERVICE_PLUGIN_BY_ID[id] : null;
}

export function getServiceDescriptor(
  id: ServiceId | null | undefined,
): ServicePluginDescriptor | null {
  return getPlugin(id)?.descriptor ?? null;
}

/**
 * Resolve which registered service (if any) owns `url`, and whether the URL
 * points at a playable watch page. Returns null for URLs outside any service.
 */
export function findPluginByUrl(
  url: string | null | undefined,
): { serviceId: ServiceId; plugin: ServicePlugin; isWatchPage: boolean } | null {
  if (!url) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  const serviceMatch = findServiceDefinitionByUrl(parsedUrl);
  if (!serviceMatch) return null;

  const plugin = getPlugin(serviceMatch.serviceId);
  return plugin
    ? { serviceId: serviceMatch.serviceId, plugin, isWatchPage: serviceMatch.isWatchPage }
    : null;
}
