<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import type { ActiveTabSummary } from "$lib/active-tab.js";
  import { getServiceDescriptor } from "$lib/services/registry.js";
  import ServiceBadge from "./ServiceBadge.svelte";

  interface Props {
    activeTab: ActiveTabSummary;
    isBusy: boolean;
    onCreateRoom: () => void;
    onJoinRoom: (code: string) => void;
  }

  const { activeTab, isBusy, onCreateRoom, onJoinRoom }: Props = $props();

  let joinCode = $state("");

  const activeDescriptor = $derived(
    getServiceDescriptor(activeTab.activeServiceId),
  );

  const isReady = $derived(activeTab.isWatchPage);
  const canCreate = $derived(isReady && !isBusy);
  const canJoin = $derived(activeTab.tabId != null && !isBusy);

  const title = $derived.by(() => {
    if (isReady) {
      return activeTab.title || activeDescriptor?.label || "Ready to start";
    }
    return "Open a supported video page to create a room";
  });

  const trimmedCode = $derived(joinCode.trim());

  function handleJoin(): void {
    if (!trimmedCode) return;
    onJoinRoom(trimmedCode);
  }

  function handleCodeKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      handleJoin();
    }
  }
</script>

<section class="flex flex-col gap-3">
  <div class="flex items-center gap-3">
    {#if activeDescriptor}
      <ServiceBadge serviceId={activeTab.activeServiceId} />
    {/if}
    <div class="min-w-0 space-y-1">
      <p class="m-0 text-sm font-semibold leading-5">
        {title}
      </p>
    </div>
  </div>

  <Button class="font-semibold" onclick={onCreateRoom} disabled={!canCreate}>
    Create room
  </Button>

  <div class="h-px bg-border" role="separator" aria-hidden="true"></div>

  <form
    class="flex flex-col gap-2"
    onsubmit={(e) => {
      e.preventDefault();
      handleJoin();
    }}
  >
    <Label
      class="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      for="join-code"
    >
      Have a code?
    </Label>
    <div class="flex gap-2">
      <Input
        id="join-code"
        type="text"
        maxlength={8}
        autocomplete="off"
        spellcheck="false"
        placeholder="ABC123"
        class="flex-1 font-mono font-semibold uppercase tracking-widest"
        bind:value={joinCode}
        onkeydowncapture={handleCodeKeydown}
      />
      <Button
        variant="outline"
        class="font-semibold"
        type="submit"
        disabled={!canJoin || !trimmedCode}
      >
        Join
      </Button>
    </div>
  </form>
</section>
