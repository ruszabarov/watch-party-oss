<script lang="ts">
  import { Settings } from '@lucide/svelte';
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
      <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>{settingsCopy}</span>
    </button>
    <ConnectionDot {status} />
  </div>
</header>
