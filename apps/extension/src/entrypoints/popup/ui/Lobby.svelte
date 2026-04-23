<script lang="ts">
  import type { PopupState } from "../../../lib/protocol/extension";
  import {
    SUPPORTED_SERVICE_DESCRIPTORS,
    getServiceDescriptor,
  } from "../../../lib/services/registry";
  import ServiceBadge from "./ServiceBadge.svelte";

  interface Props {
    popup: PopupState;
    isBusy: boolean;
    onCreateRoom: () => void;
    onJoinRoom: (code: string) => void;
  }

  const { popup, isBusy, onCreateRoom, onJoinRoom }: Props = $props();

  let joinCode = $state("");

  const activeDescriptor = $derived(
    getServiceDescriptor(
      popup.activeTab.activeServiceId ?? popup.contentContext?.serviceId,
    ),
  );

  const isReady = $derived(popup.activeTab.isWatchPage);

  const title = $derived.by(() => {
    if (isReady) {
      return (
        popup.contentContext?.mediaTitle ??
        activeDescriptor?.label ??
        "Ready to start"
      );
    }
    return "Open a supported video page";
  });

  const hint = $derived.by(() => {
    if (isReady) {
      return activeDescriptor
        ? `Watching on ${activeDescriptor.label}. Invite friends with a code.`
        : "Create a room or join one with a code.";
    }
    return (
      popup.contentContext?.issue ??
      `Start a playback page to begin — try ${SUPPORTED_SERVICE_DESCRIPTORS.map(
        (d) => d.watchPathHint,
      ).join(", ")}.`
    );
  });

  const trimmedCode = $derived(joinCode.trim());

  const canAct = $derived(isReady && !isBusy);

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
    <ServiceBadge serviceId={activeDescriptor?.id ?? null} />
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
    onclickcapture={onCreateRoom}
    disabled={!canAct}
  >
    Create room
  </button>

  <div class="h-px bg-stone-200" role="separator" aria-hidden="true"></div>

  <form
    class="flex flex-col gap-2"
    onsubmitcapture={(e) => {
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
        disabled={!canAct || !trimmedCode}
      >
        Join
      </button>
    </div>
  </form>
</section>
