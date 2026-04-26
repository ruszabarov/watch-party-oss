<script lang="ts">
  import { untrack } from 'svelte';
  import type { BackgroundState } from '../../utils/background/state';

  interface Props {
    settings: BackgroundState['settings'];
    isBusy: boolean;
    onSave: (next: BackgroundState['settings']) => void;
  }

  const { settings, isBusy, onSave }: Props = $props();

  let memberName = $state(untrack(() => settings.memberName));

  $effect(() => {
    memberName = settings.memberName;
  });

  const dirty = $derived(memberName !== settings.memberName);

  function handleSave(event: SubmitEvent): void {
    event.preventDefault();
    onSave({ memberName });
  }
</script>

<form class="flex flex-col gap-3" onsubmit={handleSave}>
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

  <button
    class="btn-primary"
    type="submit"
    disabled={isBusy || !dirty}
  >
    {dirty ? 'Save changes' : 'Saved'}
  </button>
</form>
