<script lang="ts">
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover/index.js';
	import type { ContextGauge } from '$lib/chat/context-usage';

	let { gauge }: { gauge: ContextGauge | null } = $props();

	function fmt(n: number): string {
		return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
	}

	const marked = $derived(gauge?.provenance === 'estimated');
	const critical = $derived(gauge?.state === 'critical');
	const tone = $derived(
		gauge == null
			? 'text-muted-foreground'
			: gauge.state === 'critical'
				? 'text-destructive'
				: gauge.state === 'low'
					? 'text-amber-600 dark:text-amber-400'
					: 'text-muted-foreground'
	);

	const guidance = 'Context nearly full — start a new chat or branch to free context';

	const limitSourceText = $derived(
		gauge == null
			? ''
			: gauge.limitSource === 'provider-declared'
				? 'declared on provider card'
				: gauge.limitSource === 'catalog'
					? 'model catalog'
					: 'unknown'
	);
	const provenanceText = $derived(marked ? 'estimated from context size' : 'reported usage');
	const modelMismatch = $derived(marked === true && gauge?.anchorModelId != null);
	const breakdown = $derived(
		gauge?.anchorUsage?.promptTokens != null && gauge.anchorUsage?.completionTokens != null
			? { prompt: gauge.anchorUsage.promptTokens, completion: gauge.anchorUsage.completionTokens }
			: null
	);
</script>

{#if gauge}
	<Popover>
		<PopoverTrigger
			aria-label="Context usage details"
			class="cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<span
				class="text-[11px] leading-none whitespace-nowrap {tone}"
				data-state={gauge.state}
				data-provenance={gauge.provenance}
				role={critical ? 'status' : undefined}
				class:tip={critical}
				data-tip={critical ? guidance : undefined}
				title={(marked ? 'estimated from context size' : 'reported usage') +
					(gauge.limit == null
						? ' — set "Context window" on the provider settings card to show the limit'
						: '') +
					(critical ? ` — ${guidance}` : '')}
			>
				{#if gauge.limit != null}
					{marked ? '~' : ''}{fmt(gauge.usedTokens)} / {fmt(gauge.limit)}
					({Math.round((1 - (gauge.remainingPct ?? 1 - gauge.usedTokens / gauge.limit)) * 100)}%)
				{:else}
					{marked ? '~' : ''}{fmt(gauge.usedTokens)} · window unknown
				{/if}{marked ? ' est.' : ''}
			</span>
		</PopoverTrigger>
		<PopoverContent side="top" align="end" class="w-64 p-3 text-xs">
			<div class="flex flex-col gap-1.5">
				<div class="flex justify-between gap-4">
					<span class="text-muted-foreground">Used</span>
					<span>{fmt(gauge.usedTokens)}{marked ? ' est.' : ''}</span>
				</div>
				<div class="flex justify-between gap-4">
					<span class="text-muted-foreground">Window</span>
					<span
						>{gauge.limit == null
							? 'unknown — set "Context window" on the provider card'
							: `${fmt(gauge.limit)} · ${limitSourceText}`}</span
					>
				</div>
				{#if breakdown}
					<div class="flex justify-between gap-4">
						<span class="text-muted-foreground">History + instructions</span>
						<span>{fmt(breakdown.prompt)}</span>
					</div>
					<div class="flex justify-between gap-4">
						<span class="text-muted-foreground">Latest reply</span>
						<span>{fmt(breakdown.completion)}</span>
					</div>
				{/if}
				<p class="text-muted-foreground">
					{provenanceText}{gauge.anchorModelId
						? ` · model: ${gauge.anchorModelId}`
						: ''}{modelMismatch ? ' (differs from active model)' : ''}
				</p>
			</div>
		</PopoverContent>
	</Popover>
{/if}
