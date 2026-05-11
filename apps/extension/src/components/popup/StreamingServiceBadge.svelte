<script lang="ts">
  import type { StreamingServiceId } from '@open-watch-party/shared';
  import {
    SUPPORTED_STREAMING_SERVICE_DESCRIPTORS,
    getStreamingServiceDescriptor,
  } from '~/streaming-services/catalog.js';

  interface Props {
    streamingServiceId?: StreamingServiceId | null;
    size?: 'sm' | 'md';
  }

  const { streamingServiceId = null, size = 'md' }: Props = $props();

  const descriptor = $derived(
    getStreamingServiceDescriptor(streamingServiceId) ?? SUPPORTED_STREAMING_SERVICE_DESCRIPTORS[0],
  );
</script>

<span
  class={[
    'inline-flex shrink-0 items-center justify-center rounded-lg leading-none font-bold',
    size === 'sm' ? 'h-6 w-6 text-xs' : 'h-9 w-9 text-lg',
  ]}
  style:background={descriptor.accent}
  style:color={descriptor.accentContrast}
  aria-label={descriptor.label}
>
  {descriptor.glyph}
</span>
