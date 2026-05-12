import {
  STREAMING_SERVICE_DEFINITION_BY_ID,
  SUPPORTED_STREAMING_SERVICE_DESCRIPTORS,
  findStreamingServiceDefinitionByUrl,
  type StreamingServiceDefinition,
  type StreamingServiceDescriptor,
  type StreamingServiceId,
} from '@open-watch-party/shared';

export { SUPPORTED_STREAMING_SERVICE_DESCRIPTORS };
export type { StreamingServiceDefinition, StreamingServiceDescriptor, StreamingServiceId };

export function getStreamingServiceDefinition(
  id: StreamingServiceId | null | undefined,
): StreamingServiceDefinition | null {
  return id ? STREAMING_SERVICE_DEFINITION_BY_ID[id] : null;
}

export function getStreamingServiceDescriptor(
  id: StreamingServiceId | null | undefined,
): StreamingServiceDescriptor | null {
  return getStreamingServiceDefinition(id)?.descriptor ?? null;
}

export function findStreamingServiceByUrl(url: string | null | undefined): {
  streamingServiceId: StreamingServiceId;
  streamingService: StreamingServiceDefinition;
  isWatchPage: boolean;
} | null {
  if (!url) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  const streamingServiceMatch = findStreamingServiceDefinitionByUrl(parsedUrl);
  return streamingServiceMatch
    ? {
        streamingServiceId: streamingServiceMatch.streamingServiceId,
        streamingService: streamingServiceMatch.streamingService,
        isWatchPage: streamingServiceMatch.isWatchPage,
      }
    : null;
}
