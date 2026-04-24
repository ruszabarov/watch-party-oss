<script lang="ts">
  import type { ConnectionStatus } from '@open-watch-party/shared';
  import ConnectionDot from './ConnectionDot.svelte';

  interface Props {
    status: ConnectionStatus;
    settingsOpen: boolean;
    onToggleSettings: () => void;
  }

  const { status, settingsOpen, onToggleSettings }: Props = $props();
  const settingsLabel = $derived(settingsOpen ? 'Go to lobby' : 'Go to settings');
  const settingsCopy = $derived(settingsOpen ? 'Lobby' : 'Settings');
</script>

<header class="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-3 py-3">
  <div class="font-semibold">
    <span class="text-sm">Open Watch Party</span>
  </div>

  <div class="flex shrink-0 items-center gap-2">
    <button
      class="btn-secondary"
      type="button"
      aria-label={settingsLabel}
      aria-pressed={settingsOpen}
      onclick={onToggleSettings}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 10a2 2 0 100-4 2 2 0 000 4z"
          stroke="currentColor"
          stroke-width="1.4"
        />
        <path
          d="M12.7 9.6l1.1.9-1.2 2-1.3-.4c-.3.2-.7.4-1 .5l-.3 1.4H7l-.3-1.4c-.3-.1-.7-.3-1-.5l-1.3.4-1.2-2 1.1-.9c-.1-.4-.1-.8 0-1.2L3.2 7.1l1.2-2 1.3.4c.3-.2.7-.4 1-.5L7 3.6h2l.3 1.4c.3.1.7.3 1 .5l1.3-.4 1.2 2-1.1.9c.1.4.1.8 0 1.2z"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linejoin="round"
        />
      </svg>
      <span>{settingsCopy}</span>
    </button>
    <ConnectionDot {status} />
  </div>
</header>
