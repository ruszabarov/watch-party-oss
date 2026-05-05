<script lang="ts">
  import { CircleAlert, TriangleAlert, X } from '@lucide/svelte';

  interface Props {
    kind: 'error' | 'warning';
    message: string;
    onDismiss?: () => void;
  }

  const { kind, message, onDismiss }: Props = $props();

  const tones = {
    error: 'border-red-200 bg-red-50 text-red-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
  } as const;
</script>

<div
  class={['flex items-start gap-2 rounded-lg border p-3 text-sm', tones[kind]]}
  role={kind === 'error' ? 'alert' : 'status'}
>
  <span class="inline-flex shrink-0 pt-0.5" aria-hidden="true">
    {#if kind === 'error'}
      <CircleAlert size={14} strokeWidth={1.75} />
    {:else}
      <TriangleAlert size={14} strokeWidth={1.75} />
    {/if}
  </span>

  <span class="min-w-0 flex-1 wrap-break-word leading-5 text-stone-900">{message}</span>

  {#if onDismiss}
    <button
      class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-current opacity-70 transition-opacity ease-out hover:bg-current/10 hover:opacity-100 focus-ring"
      type="button"
      aria-label="Dismiss"
      onclick={onDismiss}
    >
      <X size={12} strokeWidth={1.75} aria-hidden="true" />
    </button>
  {/if}
</div>
