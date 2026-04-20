<script lang="ts">
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
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.4" />
        <path d="M7 4.5v3m0 2v.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    {:else}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M7 2l5.2 9H1.8L7 2z"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linejoin="round"
        />
        <path d="M7 6v2m0 2v.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    {/if}
  </span>

  <span class="min-w-0 flex-1 wrap-break-word leading-5 text-stone-900">{message}</span>

  {#if onDismiss}
    <button
      class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-current opacity-70 transition-opacity ease-out hover:bg-current/10 hover:opacity-100 focus-ring"
      type="button"
      aria-label="Dismiss"
      onclickcapture={onDismiss}
    >
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3.5 3.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </button>
  {/if}
</div>
