<script lang="ts">
  import type { ConnectionStatus } from '@open-watch-party/shared';

  interface Props {
    status: ConnectionStatus;
  }

  const { status }: Props = $props();

  const labels: Record<ConnectionStatus, string> = {
    disconnected: 'Offline',
    connecting: 'Connecting',
    connected: 'Online',
    reconnecting: 'Reconnecting',
    error: 'Connection error',
  };

  const toneClasses: Record<ConnectionStatus, string> = {
    disconnected: 'bg-stone-400 text-stone-400',
    connecting: 'animate-pulse bg-amber-700 text-amber-700',
    connected: 'bg-green-600 text-green-600',
    reconnecting: 'animate-pulse bg-amber-700 text-amber-700',
    error: 'bg-red-700 text-red-700',
  };
</script>

<span
  class={`inline-block h-2 w-2 rounded-full ring-2 ring-current/10 transition-colors ease-out ${toneClasses[status]}`}
  title={labels[status]}
  aria-label={labels[status]}
></span>
