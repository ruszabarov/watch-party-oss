import {
  SERVICE_DEFINITION_BY_ID,
  SUPPORTED_SERVICE_DESCRIPTORS,
  findServiceDefinitionByUrl,
  type ServiceDefinition,
  type ServiceDescriptor,
  type ServiceId,
} from '@open-watch-party/shared';

export { SUPPORTED_SERVICE_DESCRIPTORS };
export type { ServiceDefinition, ServiceDescriptor, ServiceId };

export function getServiceDefinition(id: ServiceId | null | undefined): ServiceDefinition | null {
  return id ? SERVICE_DEFINITION_BY_ID[id] : null;
}

export function getServiceDescriptor(id: ServiceId | null | undefined): ServiceDescriptor | null {
  return getServiceDefinition(id)?.descriptor ?? null;
}

export function findServiceByUrl(
  url: string | null | undefined,
): { serviceId: ServiceId; service: ServiceDefinition; isWatchPage: boolean } | null {
  if (!url) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  const serviceMatch = findServiceDefinitionByUrl(parsedUrl);
  return serviceMatch
    ? {
        serviceId: serviceMatch.serviceId,
        service: serviceMatch.service,
        isWatchPage: serviceMatch.isWatchPage,
      }
    : null;
}
