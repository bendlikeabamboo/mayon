<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import ProviderConfig from '$lib/components/ai/ProviderConfig.svelte';
	import McpServers from '$lib/components/mcp/McpServers.svelte';
	import LabPromptConfig from '$lib/components/labs/LabPromptConfig.svelte';
	import QuizPromptConfig from '$lib/components/quizzes/QuizPromptConfig.svelte';
	import LearnerProfileConfig from '$lib/components/chat/LearnerProfileConfig.svelte';
	import ExpoundInstructionsConfig from '$lib/components/chat/ExpoundInstructionsConfig.svelte';
	import DataSection from '$lib/components/settings/DataSection.svelte';
	import SandboxDbSection from '$lib/components/settings/SandboxDbSection.svelte';
	import SecuritySection from '$lib/components/settings/SecuritySection.svelte';
	import SettingsRail from '$lib/components/settings/SettingsRail.svelte';
	import SettingsSearch from '$lib/components/settings/SettingsSearch.svelte';
	import MobileSectionJump from '$lib/components/settings/MobileSectionJump.svelte';
	import { SETTINGS_SECTIONS, visibleSections } from '$lib/settings/sections';
	import { createHashSync } from '$lib/settings/hash-sync';
	import { createScrollSpy, type ScrollSpy } from '$lib/settings/scroll-spy';
	import { serverStatus } from '$lib/services/status.svelte';

	const sections = $derived(visibleSections(SETTINGS_SECTIONS, serverStatus.caps));
	const hashSync = createHashSync(() => page.url.pathname);

	let activeId = $state<string | null>(null);
	let jumpingTo: string | null = $state(null);
	let pageRoot = $state<HTMLElement | null>(null);
	let spy: ScrollSpy | null = null;
	let flashTimer: ReturnType<typeof setTimeout> | null = null;
	let flashTarget: HTMLElement | null = null;
	let settleTimer: ReturnType<typeof setTimeout> | null = null;
	let lastSettleAt = 0;
	let searchRef: ReturnType<typeof SettingsSearch> | null = $state(null);

	function handleGlobalKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
			event.preventDefault();
			event.stopPropagation();
			searchRef?.focus();
		}
	}

	function onSpyActive(id: string | null) {
		activeId = id;
		if (jumpingTo !== null || id === null) return;
		if (performance.now() - lastSettleAt < 600) return;
		if (window.location.hash === `#${id}`) return;
		hashSync.replaceActive(id);
	}

	function flashHeading(id: string) {
		const heading = document.getElementById(id)?.querySelector('h2');
		if (!(heading instanceof HTMLElement)) return;
		if (flashTimer !== null) {
			clearTimeout(flashTimer);
			flashTimer = null;
		}
		flashTarget?.classList.remove('section-flash');
		flashTarget = heading;
		heading.classList.remove('section-flash');
		void heading.offsetWidth;
		heading.classList.add('section-flash');
		flashTimer = setTimeout(() => {
			heading.classList.remove('section-flash');
			flashTimer = null;
			flashTarget = null;
		}, 1600);
	}

	function scheduleSettle(id: string) {
		const main = pageRoot?.closest('main');
		if (!(main instanceof HTMLElement)) {
			hashSync.settle(id);
			jumpingTo = null;
			lastSettleAt = performance.now();
			return;
		}
		let done = false;
		const finish = () => {
			if (done || jumpingTo !== id) return;
			done = true;
			main.removeEventListener('scrollend', finish);
			if (settleTimer !== null) clearTimeout(settleTimer);
			settleTimer = null;
			hashSync.settle(id);
			jumpingTo = null;
			lastSettleAt = performance.now();
			spy?.refresh();
		};
		main.addEventListener('scrollend', finish, { once: true });
		settleTimer = setTimeout(finish, 800);
	}

	function isKnownSection(id: string) {
		return sections.some((section) => section.id === id);
	}

	function landOn(id: string, instant = false, waitForEl = false) {
		jumpingTo = id;
		activeId = id;
		let tries = 0;
		const attempt = () => {
			const el = document.getElementById(id);
			if (!el) {
				tries++;
				if (waitForEl && tries < 5) {
					requestAnimationFrame(attempt);
					return;
				}
			} else {
				const reduced = instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
				el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
			}
			scheduleSettle(id);
		};
		attempt();
	}

	function jumpToSection(id: string) {
		if (hashSync.pushJump(id) === null) return;
		landOn(id);
		flashHeading(id);
	}

	function onExternalHash(id: string | null) {
		if (id === null || !isKnownSection(id)) return;
		landOn(id);
	}

	$effect(() => {
		if (!pageRoot) return;
		if (!spy) {
			const main = pageRoot.closest('main');
			if (!(main instanceof HTMLElement)) return;
			spy = createScrollSpy(main, onSpyActive);
		}
		const observed: string[] = [];
		for (const entry of sections) {
			const el = document.getElementById(entry.id);
			if (!el || !el.isConnected) continue;
			spy.observe(entry.id, el);
			observed.push(entry.id);
		}
		return () => {
			if (!spy) return;
			for (const id of observed) spy.unobserve(id);
		};
	});

	onMount(() => {
		const unlistenExternal = hashSync.onExternalHash(onExternalHash);
		const initialId = hashSync.initial();
		if (initialId !== null && isKnownSection(initialId)) landOn(initialId, true, true);
		return () => {
			unlistenExternal();
			spy?.destroy();
			spy = null;
			if (flashTimer !== null) clearTimeout(flashTimer);
			if (settleTimer !== null) clearTimeout(settleTimer);
		};
	});
</script>

<svelte:window onkeydowncapture={handleGlobalKeydown} />

<div bind:this={pageRoot} class="relative mx-auto w-full max-w-[64rem] xl:pr-52">
	<div class="pointer-events-none absolute inset-y-0 right-6 hidden w-44 xl:block">
		<div class="sticky top-0 flex h-screen items-center">
			<SettingsRail {sections} {activeId} onJump={jumpToSection} />
		</div>
	</div>
	<ProviderConfig>
		{#snippet header()}
			<SettingsSearch {sections} onJump={jumpToSection} bind:this={searchRef} />
		{/snippet}
		<div id="mcp" class="scroll-mt-4">
			<McpServers />
		</div>
		<div id="learner-profile" class="scroll-mt-4">
			<LearnerProfileConfig />
		</div>
		<div id="expound-instructions" class="scroll-mt-4">
			<ExpoundInstructionsConfig />
		</div>
		<div id="lab-prompt" class="scroll-mt-4">
			<LabPromptConfig />
		</div>
		<div id="quiz-prompt" class="scroll-mt-4">
			<QuizPromptConfig />
		</div>
		<div id="security" class="scroll-mt-4">
			<SecuritySection />
		</div>
		<div id="data" class="scroll-mt-4">
			<DataSection />
		</div>
		{#if serverStatus.has('sandbox-db')}
			<div id="sandbox-db" class="scroll-mt-4">
				<SandboxDbSection />
			</div>
		{/if}
	</ProviderConfig>
</div>

<MobileSectionJump {sections} onJump={jumpToSection} />
