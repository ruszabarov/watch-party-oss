<script lang="ts">
  import { onMount } from 'svelte';

  import {
    createDefaultPopupState,
    type PopupState,
  } from '../../utils/protocol/extension';
  import { sendMessage, type PopupRequest } from '../../utils/protocol/messaging';

  import Header from '../../components/popup/Header.svelte';
  import Lobby from '../../components/popup/Lobby.svelte';
  import Room from '../../components/popup/Room.svelte';
  import Settings from '../../components/popup/Settings.svelte';
  import Notice from '../../components/popup/Notice.svelte';

  const emptyState = createDefaultPopupState();

  let popup: PopupState = $state(emptyState);
  let isBusy = $state(false);
  let settingsOpen = $state(false);

  async function syncState(): Promise<void> {
    try {
      popup = await sendBackgroundRequest({ type: 'party:get-state' });
    } catch (error) {
      popup = { ...popup, lastError: getErrorMessage(error) };
    }
  }

  async function sendRequest(request: PopupRequest): Promise<PopupState> {
    try {
      return await sendBackgroundRequest(request);
    } catch (error) {
      return { ...popup, lastError: getErrorMessage(error) };
    }
  }

  async function perform(request: PopupRequest): Promise<void> {
    isBusy = true;
    try {
      popup = await sendRequest(request);
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

  async function sendBackgroundRequest(request: PopupRequest): Promise<PopupState> {
    switch (request.type) {
      case 'party:get-state':
        return sendMessage('party:get-state');
      case 'settings:update':
        return sendMessage('settings:update', request.payload);
      case 'room:create':
        return sendMessage('room:create');
      case 'room:join':
        return sendMessage('room:join', request.payload);
      case 'room:leave':
        return sendMessage('room:leave');
      case 'room:playback-update':
        return sendMessage('room:playback-update', request.payload);
    }
  }

  onMount(() => {
    void syncState();

    const listener = (message: { type?: string }) => {
      if (message?.type === 'party:state-updated') {
        void syncState();
      }
    };

    browser.runtime.onMessage.addListener(listener);

    return () => {
      browser.runtime.onMessage.removeListener(listener);
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
