<script lang="ts">
  import type { ServiceId } from '@watch-party/shared';
  import {
    SERVICE_REGISTRY,
    getServiceDescriptor,
  } from '../../../lib/services/registry';

  interface Props {
    serviceId?: ServiceId | null;
    size?: 'sm' | 'md';
  }

  const { serviceId = null, size = 'md' }: Props = $props();

  const descriptor = $derived(
    getServiceDescriptor(serviceId) ?? SERVICE_REGISTRY.netflix,
  );
</script>

<span
  class={[
    "inline-flex shrink-0 items-center justify-center leading-none font-bold font-display [font-variation-settings:'SOFT'_100,'opsz'_60]",
    size === 'sm' ? 'h-5 w-5 rounded-md text-xs' : 'h-8 w-8 rounded-lg text-lg',
  ]}
  style:background={descriptor.accent}
  style:color={descriptor.accentContrast}
  aria-label={descriptor.label}
>
  {descriptor.glyph}
</span>
