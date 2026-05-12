<script lang="ts">
    import { onMount } from "svelte";
    import type { BackgroundState } from "../../background/state";
    import { sendMessage } from "../../messaging";
    import { getSettings, type Settings } from "../../storage/settings";
    import {
        queryActiveTabSummary,
        type ActiveTabSummary,
    } from "./active-tab.js";
    import { getErrorMessage } from "~/utils/errors.js";
    import Notice from "~/components/popup/Notice.svelte";
    import PopupContent from "./PopupContent.svelte";

    let backgroundState: BackgroundState | undefined = $state();
    let settings: Settings | undefined = $state();
    let activeTab: ActiveTabSummary | undefined = $state();
    let activeTabError: string | null = $state(null);

    onMount(() => {
        Promise.all([
            queryActiveTabSummary(),
            sendMessage("popup:get-state", undefined),
            getSettings(),
        ])
            .then(([summary, state, storedSettings]) => {
                activeTab = summary;
                backgroundState = state;
                settings = storedSettings;
            })
            .catch((error) => {
                activeTabError = getErrorMessage(
                    error,
                    "Could not read the active tab.",
                );
            });
    });
</script>

<div class="flex w-90 flex-col overflow-hidden bg-muted/40 text-foreground">
    {#if backgroundState && settings && activeTab}
        <PopupContent {backgroundState} {settings} {activeTab} />
    {:else if activeTabError}
        <main class="p-3">
            <Notice kind="error" message={activeTabError} />
        </main>
    {/if}
</div>
