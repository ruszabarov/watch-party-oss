<script lang="ts">
  import { Settings } from '@lucide/svelte';
  import { Button } from '~/components/ui/button/index.js';

  interface Props {
    settingsOpen: boolean;
    onToggleSettings: () => void;
  }

  const { settingsOpen, onToggleSettings }: Props = $props();
  const settingsLabel = $derived(settingsOpen ? 'Go to lobby' : 'Go to settings');
  const settingsCopy = $derived(settingsOpen ? 'Lobby' : 'Settings');
</script>

<header class="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-3">
  <div class="font-semibold">
    <span class="text-sm">Open Watch Party</span>
  </div>

  <div class="flex shrink-0 items-center gap-2">
    <Button
      variant="outline"
      class="font-semibold"
      aria-label={settingsLabel}
      aria-pressed={settingsOpen}
      onclick={onToggleSettings}
    >
      <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>{settingsCopy}</span>
    </Button>
  </div>
</header>
