<script lang="ts">
  import type { ActiveTabSummary } from "../../utils/active-tab";
  import {
    SUPPORTED_SERVICE_DESCRIPTORS,
    getServiceDescriptor,
  } from "../../utils/services/registry";
  import ServiceBadge from "./ServiceBadge.svelte";

  interface Props {
    activeTab: ActiveTabSummary;
    isBusy: boolean;
    onCreateRoom: () => void;
    onJoinRoom: (code: string) => void;
  }

  const { activeTab, isBusy, onCreateRoom, onJoinRoom }: Props = $props();

  let joinCode = $state("");

  const activeDescriptor = $derived(getServiceDescriptor(activeTab.activeServiceId));

  const isReady = $derived(activeTab.isWatchPage);
  const canCreate = $derived(isReady && !isBusy);
  const canJoin = $derived(activeTab.tabId != null && !isBusy);

  const title = $derived.by(() => {
    if (isReady) {
      return activeTab.title || activeDescriptor?.label || "Ready to start";
    }
    return "Open a video page to create a room";
  });

  const hint = $derived.by(() => {
    if (isReady) {
      return activeDescriptor
        ? `Watching on ${activeDescriptor.label}. Invite friends with a code.`
        : "Create a room or join one with a code.";
    }
    const watchPageHint = SUPPORTED_SERVICE_DESCRIPTORS.map(
      (d) => d.watchPathHint,
    ).join(", ");
    return `Create rooms from a playback page — try ${watchPageHint}. You can join with a code from any tab.`;
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
  <div class="flex items-start gap-3">
    <ServiceBadge serviceId={activeTab.activeServiceId} />
    <div class="min-w-0 space-y-1">
      <p class="m-0 text-sm font-semibold leading-5">
        {title}
      </p>
      <p class="m-0 text-sm leading-5 text-stone-500">{hint}</p>
    </div>
  </div>

  <button
    class="btn-primary"
    type="button"
    onclick={onCreateRoom}
    disabled={!canCreate}
  >
    Create room
  </button>

  <div class="h-px bg-stone-200" role="separator" aria-hidden="true"></div>

  <form
    class="flex flex-col gap-2"
    onsubmit={(e) => {
      e.preventDefault();
      handleJoin();
    }}
  >
    <label class="label-tiny" for="join-code">
      Have a code?
    </label>
    <div class="flex gap-2">
      <input
        id="join-code"
        type="text"
        maxlength="8"
        autocomplete="off"
        spellcheck="false"
        placeholder="ABC123"
        class="input-field flex-1 font-mono font-semibold uppercase tracking-widest"
        bind:value={joinCode}
        onkeydowncapture={handleCodeKeydown}
      />
      <button
        class="btn-secondary"
        type="submit"
        disabled={!canJoin || !trimmedCode}
      >
        Join
      </button>
    </div>
  </form>
</section>
