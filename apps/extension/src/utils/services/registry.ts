import type { ServiceId } from '@watch-party/shared';

import { NETFLIX_SERVICE } from './netflix';
import { YOUTUBE_SERVICE } from './youtube';
import type { ServiceDescriptor, ServicePlugin } from './types';

/**
 * Every service the extension knows about. Order drives popup rendering.
 *
 * Adding a service:
 *   1. Add a `ServiceId` to `packages/shared/src/protocol.ts`.
 *   2. Create a `ServicePlugin` at `apps/extension/src/utils/services/<id>.ts`.
 *   3. Add a one-line entrypoint at `src/entrypoints/<id>.content.ts` via
 *      `createServiceContentScript(MY_SERVICE)`.
 *   4. Append the plugin below and add its origin(s) to `host_permissions`
 *      in `wxt.config.ts`.
 */
export const SERVICE_PLUGINS: readonly ServicePlugin[] = [
  NETFLIX_SERVICE,
  YOUTUBE_SERVICE,
];

export const SUPPORTED_SERVICE_DESCRIPTORS: readonly ServiceDescriptor[] =
  SERVICE_PLUGINS.map((p) => p.descriptor);

export function getPlugin(
  id: ServiceId | null | undefined,
): ServicePlugin | null {
  return SERVICE_PLUGINS.find((p) => p.descriptor.id === id) ?? null;
}

export function getServiceDescriptor(
  id: ServiceId | null | undefined,
): ServiceDescriptor | null {
  return getPlugin(id)?.descriptor ?? null;
}

/**
 * Resolve which registered service (if any) owns `url`, and whether the URL
 * points at a playable watch page. Returns null for URLs outside any service.
 */
export function findPluginByUrl(
  url: string | null | undefined,
): { plugin: ServicePlugin; isWatchPage: boolean } | null {
  if (!url) return null;
  const plugin = SERVICE_PLUGINS.find((p) => p.matchesService(url));
  return plugin
    ? { plugin, isWatchPage: plugin.matchesWatchPage(url) }
    : null;
}
