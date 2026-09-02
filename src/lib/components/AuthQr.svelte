<script lang="ts">
	import { toString as qrToString } from 'qrcode';

	let { uri }: { uri: string } = $props();

	let svg = $state<string | null>(null);

	$effect(() => {
		const value = uri;
		let cancelled = false;
		qrToString(value, {
			type: 'svg',
			margin: 1,
			width: 192,
			color: { dark: '#000000', light: '#ffffff' }
		})
			.then((markup) => {
				if (!cancelled) svg = markup;
			})
			.catch(() => {
				if (!cancelled) svg = null;
			});
		return () => {
			cancelled = true;
		};
	});
</script>

<div class="flex flex-col items-center gap-3">
	<div class="rounded-lg border border-border bg-white p-3">
		{#if svg}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- generated locally by the qrcode lib from the otpauth URI -->
			{@html svg}
		{:else}
			<div class="size-[192px] animate-pulse rounded bg-muted"></div>
		{/if}
	</div>
	<p class="max-w-full break-all text-center font-mono text-xs text-muted-foreground">{uri}</p>
</div>
