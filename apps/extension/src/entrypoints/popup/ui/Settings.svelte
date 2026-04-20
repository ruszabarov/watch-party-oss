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
</script>

<form class="flex flex-col gap-3" onsubmitcapture={handleSave}>
  <label class="flex flex-col gap-2">
    <span class="label-tiny">Display name</span>
    <input
      type="text"
      maxlength="32"
      placeholder="Guest"
      class="input-field"
      bind:value={memberName}
    />
  </label>

  {#if SHOW_SERVER_SETTINGS}
    <label class="flex flex-col gap-2">
      <span class="label-tiny">Server URL</span>
      <input
        type="url"
        placeholder={DEFAULT_SERVER_URL}
        class="input-field"
        bind:value={serverUrl}
      />
      <span class="text-xs leading-5 text-stone-500">
        Point the extension at a self-hosted backend.
      </span>
    </label>
  {/if}

  <button
    class="btn-primary"
    type="submit"
    disabled={isBusy || !dirty}
  >
    {dirty ? 'Save changes' : 'Saved'}
  </button>
</form>
