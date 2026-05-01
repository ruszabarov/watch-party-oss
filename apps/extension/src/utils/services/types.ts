import type { ServiceDefinition } from '@open-watch-party/shared';

/**
 * Service integration plus the extension-only DOM hooks needed by a content script.
 */
export type ServicePlugin = ServiceDefinition & {
  /** Shown when a watch URL matched but the `<video>` element isn't ready. */
  readonly playerNotReadyMessage: string;
  getVideo(): HTMLVideoElement | null;
  getMediaTitle(): string;
};
