<script lang="ts">
    import {
        selectRoom,
        selectSession,
        type BackgroundState,
    } from "../../utils/background/state";
    import { sendMessage } from "../../utils/protocol/messaging";
    import type { ActiveTabSummary } from "$lib/active-tab.js";
    import { getErrorMessage } from "$lib/errors.js";

    import Header from "$lib/components/popup/Header.svelte";
    import Lobby from "$lib/components/popup/Lobby.svelte";
    import Room from "$lib/components/popup/Room.svelte";
    import Settings from "$lib/components/popup/Settings.svelte";
    import Notice from "$lib/components/popup/Notice.svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Card, CardContent } from "$lib/components/ui/card/index.js";

    interface Props {
        backgroundState: BackgroundState;
        activeTab: ActiveTabSummary;
    }

    const { backgroundState, activeTab }: Props = $props();

    let commandError: string | null = $state(null);
    let dismissedBackgroundError: string | null = $state(null);
    let dismissedBackgroundWarning: string | null = $state(null);
    let isBusy = $state(false);
    let settingsOpen = $state(false);

    const room = $derived(selectRoom(backgroundState));
    const session = $derived(selectSession(backgroundState));
    const isActiveRoomOnCurrentTab = $derived(
        backgroundState.controlledTab != null &&
            backgroundState.controlledTab.tabId === activeTab.tabId,
    );
    const visibleError = $derived(
        commandError ??
            (backgroundState.lastError !== dismissedBackgroundError
                ? backgroundState.lastError
                : null),
    );
    const visibleWarning = $derived(
        backgroundState.lastWarning !== dismissedBackgroundWarning
            ? backgroundState.lastWarning
            : null,
    );
    const leaveFirstMessage =
        "This tab is not controlling your active room. Leave it before starting or joining a room here.";

    function setLastError(error: unknown): void {
        commandError = getErrorMessage(error, "Unexpected popup error.");
    }

    function perform(
        action: () => Promise<void>,
        onSuccess?: () => void,
    ): void {
        isBusy = true;

        action()
            .then(onSuccess)
            .catch(setLastError)
            .finally(() => {
                isBusy = false;
            });
    }

    function handleCreateRoom(): void {
        perform(() =>
            sendMessage("popup:create-room", { tabId: activeTab.tabId }),
        );
    }

    function handleJoinRoom(roomCode: string): void {
        perform(() =>
            sendMessage("popup:join-room", {
                roomCode,
                tabId: activeTab.tabId,
            }),
        );
    }

    function handleLeaveRoom(): void {
        perform(() => sendMessage("popup:leave-room", undefined));
    }

    function handleSaveSettings(next: BackgroundState["settings"]): void {
        perform(
            () => sendMessage("popup:update-settings", next),
            closeSettings,
        );
    }

    function dismissError(): void {
        commandError = null;
        dismissedBackgroundError = backgroundState.lastError;
    }

    function dismissWarning(): void {
        dismissedBackgroundWarning = backgroundState.lastWarning;
    }

    function toggleSettings(): void {
        settingsOpen = !settingsOpen;
    }

    function closeSettings(): void {
        settingsOpen = false;
    }

</script>

<Header {settingsOpen} onToggleSettings={toggleSettings} />

<main class="p-3">
    {#if settingsOpen}
        <div class="flex flex-col gap-3">
            <Settings
                settings={backgroundState.settings}
                {isBusy}
                onSave={handleSaveSettings}
            />
        </div>
    {:else}
        <div class="flex flex-col gap-3">
            {#if room}
                <Room popup={backgroundState} {isBusy} onLeave={handleLeaveRoom} />
                {#if !isActiveRoomOnCurrentTab}
                    <Notice kind="warning" message={leaveFirstMessage} />
                {/if}
            {:else if session}
                <section class="flex flex-col gap-3">
                    <Card size="sm">
                        <CardContent class="flex flex-col gap-3">
                            <div class="space-y-1">
                                <p
                                    class="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                                >
                                    Active room
                                </p>
                                <p
                                    class="m-0 text-sm font-semibold text-foreground"
                                >
                                    Reconnecting to room {session.roomCode}
                                </p>
                                <p
                                    class="m-0 text-sm leading-5 text-muted-foreground"
                                >
                                    {leaveFirstMessage}
                                </p>
                            </div>
                            <Button
                                variant="destructive"
                                class="font-semibold"
                                onclick={handleLeaveRoom}
                                disabled={isBusy}
                            >
                                Leave
                            </Button>
                        </CardContent>
                    </Card>
                </section>
            {:else}
                <Lobby
                    {activeTab}
                    {isBusy}
                    onCreateRoom={handleCreateRoom}
                    onJoinRoom={handleJoinRoom}
                />
            {/if}

            {#if visibleError}
                <Notice
                    kind="error"
                    message={visibleError}
                    onDismiss={dismissError}
                />
            {/if}

            {#if visibleWarning}
                <Notice
                    kind="warning"
                    message={visibleWarning}
                    onDismiss={dismissWarning}
                />
            {/if}
        </div>
    {/if}
</main>
