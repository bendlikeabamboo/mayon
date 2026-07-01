<script lang="ts">
	let { variant, class: className = '' }: { variant: 'pulse' | 'orbit'; class?: string } = $props();
</script>

{#if variant === 'pulse'}
	<span class="mayon-spinner inline-flex size-4 items-center justify-center {className}">
		<span class="size-1.5 rounded-full bg-current"></span>
		<span
			class="mayon-spinner absolute size-4 rounded-full border-2 border-current"
			style="animation: mayon-pulse-ring 0.7s ease-out infinite"
		></span>
	</span>
{:else}
	<span
		class="mayon-spinner inline-flex size-4 items-center justify-center {className}"
		style="animation: mayon-orbit-spin 1.6s linear infinite"
	>
		<svg viewBox="0 0 16 16" class="size-4" fill="none">
			<path
				d="M8 2a6 6 0 0 1 4.24 1.76"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			/>
			<circle cx="12.24" cy="3.76" r="1.5" fill="currentColor" />
		</svg>
	</span>
{/if}
