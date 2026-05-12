<script lang="ts">
    import { untrack } from "svelte";
    import type { BackgroundState } from "../../background/state";
    import { sendMessage } from "../../messaging";
    import {
        updateSettings,
        type Settings as StoredSettings,
    } from "../../storage/settings";
    import type { ActiveTabSummary } from "./active-tab.js";
    import { getErrorMessage } from "~/utils/errors.js";

    import Header from "~/components/popup/Header.svelte";
    import Lobby from "~/components/popup/Lobby.svelte";
    import Room from "~/components/popup/Room.svelte";
    import Settings from "~/components/popup/Settings.svelte";
    import Notice from "~/components/popup/Notice.svelte";
    import { Button } from "~/components/ui/button/index.js";
    import { Card, CardContent } from "~/components/ui/card/index.js";

    interface Props {
        backgroundState: BackgroundState;
        settings: StoredSettings;
        activeTab: ActiveTabSummary;
    }

    const { backgroundState, settings, activeTab }: Props = $props();

    let currentBackgroundState: BackgroundState = $state(
        untrack(() => backgroundState),
    );
    let currentSettings: StoredSettings = $state(untrack(() => settings));
    let commandError: string | null = $state(null);
    let dismissedBackgroundError: string | null = $state(null);
    let dismissedBackgroundWarning: string | null = $state(null);
    let isBusy = $state(false);
    let settingsOpen = $state(false);

    const room = $derived(currentBackgroundState.room);
    const session = $derived(currentBackgroundState.session);
    const isActiveRoomOnCurrentTab = $derived(
        currentBackgroundState.controlledTab != null &&
            currentBackgroundState.controlledTab.tabId === activeTab.tabId,
    );
    const visibleError = $derived(
        commandError ??
            (currentBackgroundState.lastError !== dismissedBackgroundError
                ? currentBackgroundState.lastError
                : null),
    );
    const visibleWarning = $derived(
        currentBackgroundState.lastWarning !== dismissedBackgroundWarning
            ? currentBackgroundState.lastWarning
            : null,
    );
    const leaveFirstMessage =
        "This tab is not controlling your active room. Leave it before starting or joining a room here.";

    function setLastError(error: unknown): void {
        commandError = getErrorMessage(error, "Unexpected popup error.");
    }

    function perform(
        action: () => Promise<BackgroundState>,
        onSuccess?: () => void,
    ): void {
        isBusy = true;

        action()
            .then((nextState) => {
                currentBackgroundState = nextState;
                commandError = null;
                onSuccess?.();
            })
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

    function handleSaveSettings(next: StoredSettings): void {
        perform(
            async () => {
                currentSettings = await updateSettings(next);
                return currentBackgroundState;
            },
            closeSettings,
        );
    }

    function dismissError(): void {
        commandError = null;
        dismissedBackgroundError = currentBackgroundState.lastError;
    }

    function dismissWarning(): void {
        dismissedBackgroundWarning = currentBackgroundState.lastWarning;
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
                settings={currentSettings}
                {isBusy}
                onSave={handleSaveSettings}
            />
        </div>
    {:else}
        <div class="flex flex-col gap-3">
            {#if room}
                <Room popup={currentBackgroundState} {isBusy} onLeave={handleLeaveRoom} />
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
