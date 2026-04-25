<script lang="ts">
  import { onMount } from 'svelte';
  import { createProxyService } from '@webext-core/proxy-service';

  import {
    createDefaultPopupState,
    type PopupState,
  } from '../../utils/protocol/extension';
  import { onMessage } from '../../utils/protocol/messaging';
  import { getErrorMessage } from '../../utils/errors';
  import {
    POPUP_BACKGROUND_SERVICE_KEY,
    type PopupBackgroundService,
  } from '../../utils/background/popup-background-service';

  import Header from '../../components/popup/Header.svelte';
  import Lobby from '../../components/popup/Lobby.svelte';
  import Room from '../../components/popup/Room.svelte';
  import Settings from '../../components/popup/Settings.svelte';
  import Notice from '../../components/popup/Notice.svelte';

  const backgroundService = createProxyService<PopupBackgroundService>(
    POPUP_BACKGROUND_SERVICE_KEY,
  );

  let popup: PopupState = $state(createDefaultPopupState());
  let isBusy = $state(false);
  let settingsOpen = $state(false);

  function setLastError(error: unknown): void {
    popup = { ...popup, lastError: getErrorMessage(error, 'Unexpected popup error.') };
  }

  async function syncState(): Promise<void> {
    try {
      popup = await backgroundService.getState();
    } catch (error) {
      setLastError(error);
    }
  }

  async function perform(action: () => Promise<void>): Promise<void> {
    isBusy = true;
    try {
      await action();
    } catch (error) {
      setLastError(error);
    } finally {
      isBusy = false;
    }
  }

  function handleCreateRoom(): void {
    void perform(() => backgroundService.createRoom());
  }

  function handleJoinRoom(roomCode: string): void {
    void perform(() => backgroundService.joinRoom({ roomCode }));
  }

  function handleLeaveRoom(): void {
    void perform(() => backgroundService.leaveRoom());
  }

  function handleSaveSettings(next: PopupState['settings']): void {
    void perform(() => backgroundService.updateSettings(next)).then(closeSettings);
  }

  function dismissError(): void {
    popup = { ...popup, lastError: null };
  }

  function dismissWarning(): void {
    popup = { ...popup, lastWarning: null };
  }

  function toggleSettings(): void {
    settingsOpen = !settingsOpen;
  }

  function closeSettings(): void {
    settingsOpen = false;
  }

  onMount(() => {
    void syncState();

    const removeStateListener = onMessage('party:state-updated', ({ data }) => {
      popup = data;
    });

    return () => {
      removeStateListener();
    };
  });
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
