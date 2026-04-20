<script lang="ts">
  import { onMount } from 'svelte';

  import type { PopupState } from '../../lib/protocol/extension';
  import { DEFAULT_SERVER_URL } from '../../lib/protocol/extension';
  import type { PlaybackUpdate } from '@watch-party/shared';

  const emptyState: PopupState = {
    settings: {
      serverUrl: DEFAULT_SERVER_URL,
      memberName: 'Guest',
    },
    connectionStatus: 'disconnected',
    room: null,
    roomMemberId: null,
    activeTab: {
      tabId: null,
      title: '',
      url: '',
      isNetflix: false,
      isNetflixWatchPage: false,
    },
    controlledTabId: null,
    contentContext: null,
    lastError: null,
    lastWarning: null,
  };

  let state: PopupState = emptyState;
  let joinCode = '';
  let isBusy = false;

  let serverUrl = DEFAULT_SERVER_URL;
  let memberName = 'Guest';
  let positionSec = 0;

  const syncState = async (): Promise<void> => {
    try {
      const nextState = (await browser.runtime.sendMessage({
        type: 'party:get-state',
      })) as PopupState;

      state = nextState;
      serverUrl = nextState.settings.serverUrl;
      memberName = nextState.settings.memberName;
    } catch (error) {
      state = {
        ...state,
        lastError: getErrorMessage(error),
      };
    }
  };

  const saveSettings = async (): Promise<void> => {
    state = await sendRequest({
      type: 'settings:update',
      payload: { serverUrl, memberName },
    });
  };

  const perform = async (request: unknown): Promise<void> => {
    isBusy = true;

    try {
      state = await sendRequest(request);
    } finally {
      isBusy = false;
    }
  };

  const sendRequest = async (request: unknown): Promise<PopupState> => {
    try {
      return (await browser.runtime.sendMessage(request)) as PopupState;
    } catch (error) {
      return {
        ...state,
        lastError: getErrorMessage(error),
      };
    }
  };

  const issuePlaybackUpdate = async (overrides: {
    playing?: boolean;
    positionDeltaSec?: number;
  }): Promise<void> => {
    if (!state.contentContext?.mediaId) {
      return;
    }

    const payload: PlaybackUpdate = {
      serviceId: 'netflix',
      mediaId: state.contentContext.mediaId,
      title: state.contentContext.mediaTitle,
      positionSec: Math.max(0, positionSec + (overrides.positionDeltaSec ?? 0)),
      playing: overrides.playing ?? state.room?.playback?.playing ?? false,
      issuedAt: Date.now(),
    };

    await perform({
      type: 'room:playback-update',
      payload,
    });
  };

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

  function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unexpected popup error.';
  }

  $: positionSec = state.room?.playback?.positionSec ?? 0;
</script>

<main class="shell">
  <section class="hero">
    <div class="hero-copy">
      <p class="eyebrow">Realtime Netflix Sync</p>
      <h1>Watch Party</h1>
      <p class="lede">
        Shared playback control for the tab you already have open.
      </p>
    </div>
    <div class={`signal signal-${state.connectionStatus}`}>
      <span></span>
      {state.connectionStatus}
    </div>
  </section>

  <section class="panel">
    <label>
      <span>Realtime Server</span>
      <input bind:value={serverUrl} type="url" placeholder={DEFAULT_SERVER_URL} />
    </label>
    <label>
      <span>Display Name</span>
      <input bind:value={memberName} type="text" maxlength="32" placeholder="Guest 101" />
    </label>
    <button class="ghost" onclick={saveSettings} disabled={isBusy}>Save Settings</button>
  </section>

  <section class="panel tab-status">
    <div class="section-header">
      <h2>Current Tab</h2>
      <span class:ok={state.activeTab.isNetflixWatchPage}>
        {state.activeTab.isNetflixWatchPage ? 'Netflix ready' : 'Needs Netflix /watch'}
      </span>
    </div>
    <p class="media-title">{state.contentContext?.mediaTitle || state.activeTab.title || 'No active tab detected'}</p>
    <p class="muted">{state.contentContext?.issue || state.activeTab.url || 'Open a Netflix watch page to start syncing.'}</p>
    {#if state.contentContext?.mediaId}
      <p class="meta">Media ID {state.contentContext.mediaId}</p>
    {/if}
  </section>

  {#if state.room}
    <section class="panel room-panel">
      <div class="section-header">
        <h2>Room {state.room.roomCode}</h2>
        <button class="ghost danger" onclick={() => perform({ type: 'room:leave' })} disabled={isBusy}>
          Leave
        </button>
      </div>

      <div class="playback-card">
        <div>
          <p class="eyebrow">Canonical Playback</p>
          <p class="media-title">{state.room.playback?.title ?? 'Waiting for playback state'}</p>
          <p class="meta">{positionSec.toFixed(1)}s · {state.room.playback?.playing ? 'Playing' : 'Paused'}</p>
        </div>
        <div class="controls">
          <button onclick={() => issuePlaybackUpdate({ positionDeltaSec: -10 })} disabled={isBusy}>-10</button>
          <button onclick={() => issuePlaybackUpdate({ playing: true })} disabled={isBusy}>Play</button>
          <button onclick={() => issuePlaybackUpdate({ playing: false })} disabled={isBusy}>Pause</button>
          <button onclick={() => issuePlaybackUpdate({ positionDeltaSec: 10 })} disabled={isBusy}>+10</button>
        </div>
      </div>

      <div class="members">
        {#each state.room.members as member}
          <div class:me={member.id === state.roomMemberId}>
            <strong>{member.name}</strong>
            <span>{member.id === state.roomMemberId ? 'You' : 'Guest'}</span>
          </div>
        {/each}
      </div>
    </section>
  {:else}
    <section class="panel room-actions">
      <div class="section-header">
        <h2>Party Session</h2>
        <span>Anonymous room code</span>
      </div>
      <button class="primary" onclick={() => perform({ type: 'room:create' })} disabled={isBusy || !state.activeTab.isNetflixWatchPage}>
        Create Room
      </button>
      <div class="join-row">
        <input bind:value={joinCode} type="text" maxlength="8" placeholder="ROOM42" />
        <button onclick={() => perform({ type: 'room:join', payload: { roomCode: joinCode } })} disabled={isBusy || !state.activeTab.isNetflixWatchPage || !joinCode.trim()}>
          Join
        </button>
      </div>
    </section>
  {/if}

  {#if state.lastError}
    <section class="notice error">{state.lastError}</section>
  {/if}

  {#if state.lastWarning}
    <section class="notice warning">{state.lastWarning}</section>
  {/if}
</main>
