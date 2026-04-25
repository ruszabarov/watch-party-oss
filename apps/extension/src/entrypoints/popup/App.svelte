<script lang="ts">
  import {
    createDefaultPopupState,
    type PopupState,
  } from '../../utils/protocol/extension';
  import { sendMessage } from '../../utils/protocol/messaging';
  import { getErrorMessage } from '../../utils/errors';
  import { popupStateItem } from '../../utils/background/popup-state-item';

  import Header from '../../components/popup/Header.svelte';
  import Lobby from '../../components/popup/Lobby.svelte';
  import Room from '../../components/popup/Room.svelte';
  import Settings from '../../components/popup/Settings.svelte';
  import Notice from '../../components/popup/Notice.svelte';

  let popup: PopupState = $state(createDefaultPopupState());
  let isBusy = $state(false);
  let settingsOpen = $state(false);

  function setLastError(error: unknown): void {
    popup = { ...popup, lastError: getErrorMessage(error, 'Unexpected popup error.') };
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
    void perform(() => sendMessage('popup:create-room', undefined));
  }

  function handleJoinRoom(roomCode: string): void {
    void perform(() => sendMessage('popup:join-room', { roomCode }));
  }

  function handleLeaveRoom(): void {
    void perform(() => sendMessage('popup:leave-room', undefined));
  }

  function handleSaveSettings(next: PopupState['settings']): void {
    void perform(() => sendMessage('popup:update-settings', next)).then(closeSettings);
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

  $effect(() => {
    popupStateItem.getValue().then((v) => { popup = v; });

    const unwatch = popupStateItem.watch((newValue) => {
      popup = newValue;
    });

    return () => unwatch();
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
