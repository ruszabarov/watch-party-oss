<script lang="ts">
  import { CircleAlert, TriangleAlert, X } from '@lucide/svelte';
  import * as Alert from '~/components/ui/alert/index.js';
  import { Button } from '~/components/ui/button/index.js';

  interface Props {
    kind: 'error' | 'warning';
    message: string;
    onDismiss?: () => void;
  }

  const { kind, message, onDismiss }: Props = $props();

  const alertTones = {
    error: 'border-red-200 bg-red-50 text-red-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
  } as const;
</script>

<Alert.Root
  class={['flex items-start gap-2 px-3 py-3', alertTones[kind]]}
  role={kind === 'error' ? 'alert' : 'status'}
>
  <span class="inline-flex shrink-0 pt-0.5" aria-hidden="true">
    {#if kind === 'error'}
      <CircleAlert size={14} strokeWidth={1.75} />
    {:else}
      <TriangleAlert size={14} strokeWidth={1.75} />
    {/if}
  </span>

  <Alert.Description class="min-w-0 flex-1 wrap-break-word leading-5 text-foreground">
    {message}
  </Alert.Description>

  {#if onDismiss}
    <Button
      variant="ghost"
      size="icon-xs"
      class="h-5 w-5 shrink-0 text-current opacity-70 hover:bg-current/10 hover:opacity-100"
      aria-label="Dismiss"
      onclick={onDismiss}
    >
      <X size={12} strokeWidth={1.75} aria-hidden="true" />
    </Button>
  {/if}
</Alert.Root>
