<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '~/components/ui/button/index.js';
  import { Input } from '~/components/ui/input/index.js';
  import { Label } from '~/components/ui/label/index.js';
  import type { Settings as StoredSettings } from '~/storage/settings';

  interface Props {
    settings: StoredSettings;
    isBusy: boolean;
    onSave: (next: StoredSettings) => void;
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
  <div class="flex flex-col gap-2">
    <Label
      class="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      for="display-name"
    >
      Display name
    </Label>
    <Input
      id="display-name"
      type="text"
      maxlength={32}
      placeholder="Guest"
      bind:value={memberName}
    />
  </div>

  <Button
    class="font-semibold"
    type="submit"
    disabled={isBusy || !dirty}
  >
    {dirty ? 'Save changes' : 'Saved'}
  </Button>
</form>
