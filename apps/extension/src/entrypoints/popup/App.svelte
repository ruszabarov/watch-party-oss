<script lang="ts">
    import { onMount } from "svelte";
    import {
        backgroundStateItem,
        type BackgroundState,
    } from "../../utils/background/state";
    import {
        queryActiveTabSummary,
        type ActiveTabSummary,
    } from "$lib/active-tab.js";
    import { getErrorMessage } from "$lib/errors.js";
    import Notice from "$lib/components/popup/Notice.svelte";
    import PopupContent from "./PopupContent.svelte";

    let backgroundState: BackgroundState | undefined = $state();
    let activeTab: ActiveTabSummary | undefined = $state();
    let activeTabError: string | null = $state(null);

    onMount(() => {
        queryActiveTabSummary()
            .then((summary) => {
                activeTab = summary;
            })
            .catch((error) => {
                activeTabError = getErrorMessage(
                    error,
                    "Could not read the active tab.",
                );
            });
    });

    onMount(() => {
        const unwatch = backgroundStateItem.watch((newValue) => {
            backgroundState = newValue;
        });

        backgroundStateItem.getValue().then((value) => {
            backgroundState = value;
        });

        return () => unwatch();
    });
</script>

<div class="flex w-90 flex-col overflow-hidden bg-muted/40 text-foreground">
    {#if backgroundState && activeTab}
        <PopupContent {backgroundState} {activeTab} />
    {:else if activeTabError}
        <main class="p-3">
            <Notice kind="error" message={activeTabError} />
        </main>
    {/if}
</div>
