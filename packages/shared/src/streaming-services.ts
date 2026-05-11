import { NETFLIX_STREAMING_SERVICE_DEFINITION } from './streaming-services/netflix';
import { YOUTUBE_STREAMING_SERVICE_DEFINITION } from './streaming-services/youtube';

export type StreamingServiceDescriptor = {
  readonly label: string;
  readonly accent: string;
  readonly accentContrast: string;
  readonly glyph: string;
};

export type StreamingServiceDefinition = {
  readonly descriptor: StreamingServiceDescriptor;
  readonly contentMatches: readonly string[];
  matchesUrl(url: URL): boolean;
  extractMediaId(url: URL): string | null;
  isMediaIdValid(mediaId: string): boolean;
  buildCanonicalWatchUrl(mediaId: string): string;
};

export const STREAMING_SERVICE_DEFINITION_BY_ID = {
  netflix: NETFLIX_STREAMING_SERVICE_DEFINITION,
  youtube: YOUTUBE_STREAMING_SERVICE_DEFINITION,
} satisfies Record<string, StreamingServiceDefinition>;

export const STREAMING_SERVICE_DEFINITIONS = Object.values(STREAMING_SERVICE_DEFINITION_BY_ID);

export type StreamingServiceId = keyof typeof STREAMING_SERVICE_DEFINITION_BY_ID;
export type StreamingServiceUrlMatch = {
  streamingServiceId: StreamingServiceId;
  streamingService: StreamingServiceDefinition;
  isWatchPage: boolean;
};

export const SUPPORTED_STREAMING_SERVICES = Object.keys(STREAMING_SERVICE_DEFINITION_BY_ID);

export function isStreamingServiceId(value: string): value is StreamingServiceId {
  return value in STREAMING_SERVICE_DEFINITION_BY_ID;
}

export const SUPPORTED_STREAMING_SERVICE_DESCRIPTORS = STREAMING_SERVICE_DEFINITIONS.map(
  (streamingService) => streamingService.descriptor,
);

export const SUPPORTED_STREAMING_SERVICE_CONTENT_MATCHES = STREAMING_SERVICE_DEFINITIONS.flatMap(
  (streamingService) => streamingService.contentMatches,
);

export function findStreamingServiceDefinitionByUrl(
  url: URL,
): StreamingServiceUrlMatch | undefined {
  for (const streamingServiceId of SUPPORTED_STREAMING_SERVICES) {
    if (!isStreamingServiceId(streamingServiceId)) continue;

    const streamingService = STREAMING_SERVICE_DEFINITION_BY_ID[streamingServiceId];
    if (streamingService.matchesUrl(url)) {
      return {
        streamingServiceId,
        streamingService,
        isWatchPage: streamingService.extractMediaId(url) !== null,
      };
    }
  }

  return undefined;
}
