<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		DEFAULT_PROFILE,
		LEVEL_LABELS,
		LEVEL_OPTIONS,
		MODE_LABELS,
		MODE_OPTIONS,
		type BriefLevel,
		type BriefMode,
		type LearnerProfile
	} from '$lib/chat/brief';
	import { getLearnerProfile, setLearnerProfile } from '$lib/chat/profile';

	let context = $state('');
	let level = $state<BriefLevel>(DEFAULT_PROFILE.level!);
	let modeVal = $state<BriefMode>(DEFAULT_PROFILE.mode!);
	let loading = $state(true);
	let status = $state<string | null>(null);
	let isDefault = $state(true);

	onMount(async () => {
		try {
			const profile = await getLearnerProfile();
			context = profile.context ?? '';
			level = profile.level ?? DEFAULT_PROFILE.level!;
			modeVal = profile.mode ?? DEFAULT_PROFILE.mode!;
			isDefault =
				context === '' && level === DEFAULT_PROFILE.level && modeVal === DEFAULT_PROFILE.mode;
		} catch {
			// fall back to defaults
		}
		loading = false;
	});

	async function save() {
		const clean: LearnerProfile = { level, mode: modeVal };
		const ctx = context.trim();
		if (ctx.length > 0) clean.context = ctx;
		await setLearnerProfile(clean);
		isDefault =
			clean.context === undefined &&
			clean.level === DEFAULT_PROFILE.level &&
			clean.mode === DEFAULT_PROFILE.mode;
		status = 'Learner profile saved.';
	}

	async function reset() {
		context = '';
		level = DEFAULT_PROFILE.level!;
		modeVal = DEFAULT_PROFILE.mode!;
		await setLearnerProfile({ ...DEFAULT_PROFILE });
		isDefault = true;
		status = 'Reset to default profile.';
	}

	const inputClass =
		'min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
	const labelClass = 'block text-xs font-medium text-muted-foreground';
</script>

<section class="space-y-3">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
			Learner profile
		</h2>
		{#if !isDefault}
			<Button variant="ghost" size="sm" onclick={reset}>Reset to default</Button>
		{/if}
	</div>

	<p class="text-xs text-muted-foreground">
		Default knowledge level, teaching mode, and context pre-filled into each new chat's learning
		brief. Override per-chat at intake.
	</p>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else}
		<!-- Context -->
		<div class="space-y-1">
			<label class={labelClass} for="profile-context">
				Context <span class="text-muted-foreground/70">(optional)</span>
			</label>
			<textarea
				id="profile-context"
				bind:value={context}
				rows="2"
				placeholder="role / situation (e.g. on-call engineer)"
				class={inputClass}></textarea>
		</div>

		<!-- Level + Mode -->
		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-1">
				<label class={labelClass} for="profile-level">Level</label>
				<select id="profile-level" bind:value={level} class={inputClass}>
					{#each LEVEL_OPTIONS as l (l)}
						<option value={l}>{LEVEL_LABELS[l]}</option>
					{/each}
				</select>
			</div>
			<div class="space-y-1">
				<label class={labelClass} for="profile-mode">Teaching mode</label>
				<select id="profile-mode" bind:value={modeVal} class={inputClass}>
					{#each MODE_OPTIONS as m (m)}
						<option value={m}>{MODE_LABELS[m]}</option>
					{/each}
				</select>
			</div>
		</div>

		<div class="flex items-center gap-2 pt-1">
			<Button variant="outline" size="sm" onclick={save}>Save</Button>
			{#if status}
				<p class="text-xs text-muted-foreground" role="status">{status}</p>
			{/if}
		</div>
	{/if}
</section>
