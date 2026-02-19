<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import AppTopMenu from "../components/AppTopMenu.vue";
import { useToolHubState } from "../composables/use-tool-hub-state";

const route = useRoute();
const router = useRouter();
const { activeTab, dispose, enterSettingsMode, init, tabs } = useToolHubState();

const isSettingsRoute = computed(() => route.name === "settings");
const isGeneratorRoute = computed(() => route.name === "generator");

function handleTabSelect(tabId: string) {
    activeTab.value = tabId;
    if (route.name !== "workspace") {
        void router.push({ name: "workspace" });
    }
}

function handleGeneratorToggle() {
    if (isGeneratorRoute.value) {
        void router.push({ name: "workspace" });
        return;
    }
    void router.push({ name: "generator" });
}

function handleSettingsToggle() {
    if (isSettingsRoute.value) {
        void router.push({ name: "workspace" });
        return;
    }
    enterSettingsMode();
    void router.push({ name: "settings" });
}

watch(
    isSettingsRoute,
    (enabled) => {
        if (enabled) {
            enterSettingsMode();
        }
    },
    { immediate: true },
);

onMounted(() => {
    init();
});

onUnmounted(() => {
    dispose();
});
</script>

<template>
    <div class="relative min-h-screen bg-slate-950 text-slate-100">
        <div
            class="pointer-events-none absolute inset-0 bg-mesh-glow opacity-70"
        />

        <AppTopMenu
            :tabs="tabs"
            :active-tab="activeTab"
            :is-settings-active="isSettingsRoute"
            :is-generator-active="isGeneratorRoute"
            @select="handleTabSelect"
            @generator="handleGeneratorToggle"
            @settings="handleSettingsToggle"
        />

        <main class="relative mx-auto w-full px-4 pb-10 pt-7 md:px-6">
            <RouterView />
        </main>
    </div>
</template>
