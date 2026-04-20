<script lang="ts">
  import { onMount } from 'svelte';

  import type { PlaybackUpdate } from '@watch-party/shared';
  import {
    coercePopupState,
    createDefaultPopupState,
    type PopupState,
    type RuntimeRequest,
  } from '../../lib/protocol/extension';

  import Header from './ui/Header.svelte';
  import Lobby from './ui/Lobby.svelte';
  import Room from './ui/Room.svelte';
  import Settings from './ui/Settings.svelte';
  import Notice from './ui/Notice.svelte';

  const emptyState = createDefaultPopupState();
  const POPUP_STATE_RETRY_DELAY_MS = 50;

  let popup: PopupState = $state(emptyState);
  let isBusy = $state(false);
  let settingsOpen = $state(false);

  async function syncState(): Promise<void> {
    try {
      popup = await requestPopupState({ type: 'party:get-state' });
    } catch (error) {
      popup = { ...popup, lastError: getErrorMessage(error) };
    }
  }

  async function sendRequest(request: RuntimeRequest): Promise<PopupState> {
    try {
      return await requestPopupState(request);
    } catch (error) {
      return { ...popup, lastError: getErrorMessage(error) };
    }
  }

  async function perform(request: RuntimeRequest): Promise<void> {
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

  function handlePlaybackUpdate(update: PlaybackUpdate): void {
    void perform({ type: 'room:playback-update', payload: update });
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

  async function requestPopupState(request: RuntimeRequest): Promise<PopupState> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await browser.runtime.sendMessage(request);
      if (attempt === 1 || response != null) {
        return coercePopupState(response, popup);
      }

      await new Promise((resolve) => setTimeout(resolve, POPUP_STATE_RETRY_DELAY_MS));
    }

    return popup;
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
            onPlaybackUpdate={handlePlaybackUpdate}
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
