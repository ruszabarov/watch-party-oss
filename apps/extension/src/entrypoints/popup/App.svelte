<script lang="ts">
  import { onDestroy } from 'svelte';

  import {
    createDefaultPopupState,
    type PopupCommand,
    type PopupState,
  } from '../../lib/protocol/extension';
  import { createPopupClient } from '../../lib/protocol/popup-client';

  import Header from './ui/Header.svelte';
  import Lobby from './ui/Lobby.svelte';
  import Room from './ui/Room.svelte';
  import Settings from './ui/Settings.svelte';
  import Notice from './ui/Notice.svelte';

  let popup: PopupState = $state(createDefaultPopupState());
  let isBusy = $state(false);
  let settingsOpen = $state(false);

  const client = createPopupClient({
    onState: (state) => {
      popup = state;
    },
  });

  onDestroy(() => client.close());

  async function perform(command: PopupCommand): Promise<void> {
    isBusy = true;
    try {
      await client.send(command);
    } catch (error) {
      popup = { ...popup, lastError: getErrorMessage(error) };
    } finally {
      isBusy = false;
    }
  }

  function handleCreateRoom(): void {
    void perform({ type: 'room:create' });
  }

  function handleJoinRoom(roomCode: string): void {
    void perform({ type: 'room:join', payload: { roomCode } });
  }

  function handleLeaveRoom(): void {
    void perform({ type: 'room:leave' });
  }

  function handleSaveSettings(next: PopupState['settings']): void {
    void perform({ type: 'settings:update', payload: next }).then(() => {
      closeSettings();
    });
  }

  function dismissError(): void {
    popup = { ...popup, lastError: null };
  }

  function dismissWarning(): void {
    popup = { ...popup, lastWarning: null };
  }

  function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return 'Unexpected popup error.';
  }

  function toggleSettings(): void {
    settingsOpen = !settingsOpen;
  }

  function closeSettings(): void {
    settingsOpen = false;
  }
</script>

<div class="flex flex-col overflow-hidden bg-stone-50 text-stone-900">
  <Header
    status={popup.connectionStatus}
    settingsOpen={settingsOpen}
    onToggleSettings={toggleSettings}
  />

  <main class="p-3">
    {#if settingsOpen}
      <div class="flex flex-col gap-3">
        <Settings
          settings={popup.settings}
          {isBusy}
          onSave={handleSaveSettings}
        />
      </div>
    {:else}
      <div class="flex flex-col gap-3">
        {#if popup.room}
          <Room
            popup={popup}
            {isBusy}
            onLeave={handleLeaveRoom}
          />
        {:else}
          <Lobby
            popup={popup}
            {isBusy}
            onCreateRoom={handleCreateRoom}
            onJoinRoom={handleJoinRoom}
          />
        {/if}

        {#if popup.lastError}
          <Notice kind="error" message={popup.lastError} onDismiss={dismissError} />
        {/if}

        {#if popup.lastWarning}
          <Notice kind="warning" message={popup.lastWarning} onDismiss={dismissWarning} />
        {/if}
      </div>
    {/if}
  </main>
</div>
