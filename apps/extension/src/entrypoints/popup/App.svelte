<script lang="ts">
  import {
    backgroundStateItem,
    createBackgroundState,
    selectConnectionStatus,
    selectRoom,
    selectSession,
    type BackgroundState,
  } from '../../utils/background/state';
  import { sendMessage } from '../../utils/protocol/messaging';
  import {
    createEmptyActiveTabSummary,
    queryActiveTabSummary,
  } from '../../utils/active-tab';
  import { getErrorMessage } from '../../utils/errors';

  import Header from '../../components/popup/Header.svelte';
  import Lobby from '../../components/popup/Lobby.svelte';
  import Room from '../../components/popup/Room.svelte';
  import Settings from '../../components/popup/Settings.svelte';
  import Notice from '../../components/popup/Notice.svelte';

  let popup: BackgroundState = $state(createBackgroundState());
  let activeTab = $state(createEmptyActiveTabSummary());
  let isBusy = $state(false);
  let settingsOpen = $state(false);

  const connectionStatus = $derived(selectConnectionStatus(popup));
  const room = $derived(selectRoom(popup));
  const session = $derived(selectSession(popup));
  const isActiveRoomOnCurrentTab = $derived(
    popup.controlledTab != null &&
      activeTab.tabId != null &&
      popup.controlledTab.tabId === activeTab.tabId,
  );
  const leaveFirstMessage =
    'This tab is not controlling your active room. Leave it before starting or joining a room here.';

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

  function requireActiveTabId(): number {
    if (activeTab.tabId == null) {
      throw new Error('Open a browser tab before continuing.');
    }

    return activeTab.tabId;
  }

  function handleCreateRoom(): void {
    void perform(() => sendMessage('popup:create-room', { tabId: requireActiveTabId() }));
  }

  function handleJoinRoom(roomCode: string): void {
    void perform(() => sendMessage('popup:join-room', { roomCode, tabId: requireActiveTabId() }));
  }

  function handleLeaveRoom(): void {
    void perform(() => sendMessage('popup:leave-room', undefined));
  }

  function handleSaveSettings(next: BackgroundState['settings']): void {
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
    backgroundStateItem.getValue().then((v) => { popup = v; });
    queryActiveTabSummary().then((v) => { activeTab = v; }).catch(setLastError);

    const unwatch = backgroundStateItem.watch((newValue) => {
      popup = newValue;
    });

    return () => unwatch();
  });
</script>

<div class="flex flex-col overflow-hidden bg-stone-50 text-stone-900">
  <Header
    status={connectionStatus}
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
        {#if room}
          <Room
            popup={popup}
            {isBusy}
            onLeave={handleLeaveRoom}
          />
          {#if !isActiveRoomOnCurrentTab}
            <Notice kind="warning" message={leaveFirstMessage} />
          {/if}
        {:else if session}
          <section class="flex flex-col gap-3">
            <div class="card flex flex-col gap-3">
              <div class="space-y-1">
                <p class="m-0 label-tiny">Active room</p>
                <p class="m-0 text-sm font-semibold text-stone-900">
                  Reconnecting to room {session.roomCode}
                </p>
                <p class="m-0 text-sm leading-5 text-stone-500">
                  {leaveFirstMessage}
                </p>
              </div>
              <button
                class="btn-danger"
                type="button"
                onclick={handleLeaveRoom}
                disabled={isBusy}
              >
                Leave
              </button>
            </div>
          </section>
        {:else}
          <Lobby
            activeTab={activeTab}
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
