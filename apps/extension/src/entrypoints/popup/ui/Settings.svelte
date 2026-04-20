<script lang="ts">
  import { untrack } from 'svelte';
  import {
    DEFAULT_SERVER_URL,
    SHOW_SERVER_SETTINGS,
    type PopupState,
  } from '../../../lib/protocol/extension';

  interface Props {
    settings: PopupState['settings'];
    isBusy: boolean;
    onSave: (next: PopupState['settings']) => void;
  }

  const { settings, isBusy, onSave }: Props = $props();

  let memberName = $state(untrack(() => settings.memberName));
  let serverUrl = $state(untrack(() => settings.serverUrl));

  $effect(() => {
    memberName = settings.memberName;
    serverUrl = settings.serverUrl;
  });

  const dirty = $derived(
    memberName !== settings.memberName || serverUrl !== settings.serverUrl,
  );

  function handleSave(event: SubmitEvent): void {
    event.preventDefault();
    onSave({ memberName, serverUrl });
  }

  const inputClass =
    'h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-stone-900 transition-colors ease-out placeholder:text-stone-400 hover:border-stone-300 focus-visible:border-stone-300 focus-ring';
</script>

<form class="flex flex-col gap-3" onsubmitcapture={handleSave}>
  <label class="flex flex-col gap-2">
    <span class="text-sm font-semibold text-stone-500">Display name</span>
    <input
      type="text"
      maxlength="32"
      placeholder="Guest"
      class={inputClass}
      bind:value={memberName}
    />
  </label>

  {#if SHOW_SERVER_SETTINGS}
    <label class="flex flex-col gap-2">
      <span class="text-sm font-semibold text-stone-500">Server URL</span>
      <input
        type="url"
        placeholder={DEFAULT_SERVER_URL}
        class={inputClass}
        bind:value={serverUrl}
      />
      <span class="text-xs leading-5 text-stone-400">
        Point the extension at a self-hosted backend.
      </span>
    </label>
  {/if}

  <button
    class="inline-flex h-10 items-center justify-center rounded-lg border border-stone-900 bg-stone-900 px-4 text-base font-bold text-white shadow-sm transition-colors ease-out hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-45 focus-ring"
    type="submit"
    disabled={isBusy || !dirty}
  >
    {dirty ? 'Save changes' : 'Saved'}
  </button>
</form>
