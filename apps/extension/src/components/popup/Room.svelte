<script lang="ts">
  import { Check, Copy } from '@lucide/svelte';
  import { selectRoom, selectSession, type BackgroundState } from '../../utils/background/state';

  interface Props {
    popup: BackgroundState;
    isBusy: boolean;
    onLeave: () => void;
  }

  const { popup, isBusy, onLeave }: Props = $props();

  const room = $derived(selectRoom(popup)!);
  const roomMemberId = $derived(selectSession(popup)?.memberId ?? null);

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(room.roomCode);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1600);
    } catch {
      // Clipboard may be unavailable — silently ignore.
    }
  }
</script>

<section class="flex flex-col gap-3">
  <div class="card flex items-center justify-between gap-3 bg-linear-to-b from-stone-100 to-white">
    <div class="min-w-0 space-y-1">
      <p class="m-0 label-tiny">Room code</p>
      <p class="m-0 text-2xl font-bold tracking-wider" aria-live="polite">
        {room.roomCode}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <button
        class="btn-icon"
        type="button"
        aria-label={copied ? 'Copied' : 'Copy room code'}
        onclick={copyCode}
      >
        {#if copied}
          <Check size={14} strokeWidth={1.75} aria-hidden="true" />
        {:else}
          <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
        {/if}
      </button>
      <button
        class="btn-danger"
        type="button"
        onclick={onLeave}
        disabled={isBusy}
      >
        Leave
      </button>
    </div>
  </div>

  {#if room.members.length}
    <div>
      <p class="mb-2 mt-0 label-tiny">
        {room.members.length} {room.members.length === 1 ? 'member' : 'members'}
      </p>
      <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
        {#each room.members as member (member.id)}
          {@const isMe = member.id === roomMemberId}
          <li
            class={[
              'inline-flex max-w-full items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm',
              isMe
                ? 'bg-stone-900 border-stone-900 text-stone-50'
                : 'bg-white border-stone-200 text-stone-900',
            ]}
            title={member.name}
          >
            <span
              class={[
                'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                isMe ? 'bg-white/20 text-stone-50' : 'bg-stone-100 text-stone-900',
              ]}
              aria-hidden="true"
            >
              {member.name.slice(0, 1).toUpperCase()}
            </span>
            <span class="max-w-44 truncate">
              {member.name}{isMe ? ' (you)' : ''}
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
