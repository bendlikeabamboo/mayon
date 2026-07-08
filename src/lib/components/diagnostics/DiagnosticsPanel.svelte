<script lang="ts">
	import { Trash2, Copy, ChevronDown, ChevronRight, AlertTriangle } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Sheet, SheetContent, SheetHeader, SheetTitle } from '$lib/components/ui/sheet/index.js';
	import { diagnosticsStore } from '$lib/stores/diagnostics.svelte';
	import type { TraceEvent } from '$lib/agent/trace';
	import type { AgentTrace } from '$lib/db/schema';
	import { estimateContextLimit } from '$lib/ai/model-limits';

	let {
		chatId,
		labId,
		quizId,
		title
	}: {
		chatId?: string;
		labId?: string;
		quizId?: string;
		title?: string;
	} = $props();

	let expandedSystem = $state(false);

	const KIND_OPTIONS = [
		{ label: 'All', value: null as string[] | null },
		{ label: 'Chat', value: ['chat'] },
		{ label: 'Title', value: ['title'] },
		{ label: 'Brief', value: ['brief'] },
		{ label: 'Lab', value: ['lab'] },
		{ label: 'Quiz', value: ['quiz'] },
		{ label: 'Grade', value: ['grade'] }
	] as const;

	let defaultKind = $derived(labId ? ['lab'] : quizId ? ['quiz'] : ['chat']);

	let activeKind = $derived(diagnosticsStore.kinds ?? defaultKind);

	function resolveEntityId(): string | null {
		return labId ?? quizId ?? chatId ?? null;
	}

	$effect(() => {
		if (labId) {
			diagnosticsStore.loadByLab(labId);
		} else if (quizId) {
			diagnosticsStore.loadByQuiz(quizId);
		} else if (chatId) {
			diagnosticsStore.load(chatId, defaultKind);
		}
	});

	function onSelectKind(val: string[] | null) {
		const entityId = resolveEntityId();
		if (!entityId) return;
		diagnosticsStore.setKinds(val);
		if (labId) {
			diagnosticsStore.loadByLab(labId);
		} else if (quizId) {
			diagnosticsStore.loadByQuiz(quizId);
		} else if (chatId) {
			diagnosticsStore.load(chatId, val);
		}
	}

	function parseTrace(trace: AgentTrace): ReturnType<typeof tryParse> {
		return tryParse(trace.trace);
	}

	function tryParse(raw: string) {
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}

	function formatDuration(ms: number | null | undefined): string {
		if (ms == null) return '-';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	async function copyText(text: string) {
		await navigator.clipboard.writeText(text);
	}

	let selectedTrace = $derived(
		diagnosticsStore.selectedTurnId
			? (diagnosticsStore.traces.find((t) => t.id === diagnosticsStore.selectedTurnId) ?? null)
			: null
	);
	let selectedParsed = $derived(selectedTrace ? parseTrace(selectedTrace) : null);
	let selectedIsChat = $derived(selectedTrace?.kind === 'chat');

	let liveParts = $derived(
		diagnosticsStore.liveEvents
			.filter((e) => e.kind === 'part')
			.reduce<Array<{ type: string; count: number }>>((acc, e) => {
				const type = e.type;
				const last = acc[acc.length - 1];
				if (last && last.type === type) {
					last.count++;
				} else {
					acc.push({ type, count: 1 });
				}
				return acc;
			}, [])
	);

	let liveReasoning = $derived(
		diagnosticsStore.liveEvents
			.filter((e): e is Extract<TraceEvent, { kind: 'part' }> => e.kind === 'part')
			.filter((e) => e.type === 'reasoning-delta' || e.type === 'reasoning')
			.map((e) => {
				const p = e.payload as Record<string, unknown> | undefined;
				if (e.type === 'reasoning-delta') return String(p?.text ?? '');
				return String(p?.text ?? '');
			})
			.join('')
	);

	let liveText = $derived(
		diagnosticsStore.liveEvents
			.filter(
				(e): e is Extract<TraceEvent, { kind: 'part' }> =>
					e.kind === 'part' && e.type === 'text-delta'
			)
			.map((e) => String((e.payload as Record<string, unknown>)?.text ?? ''))
			.join('')
	);

	let liveError = $derived.by(() => {
		for (let i = diagnosticsStore.liveEvents.length - 1; i >= 0; i--) {
			const e = diagnosticsStore.liveEvents[i];
			if (e.kind === 'error') return e.message;
		}
		return null;
	});

	let liveUsage = $derived.by(() => {
		for (let i = diagnosticsStore.liveEvents.length - 1; i >= 0; i--) {
			const e = diagnosticsStore.liveEvents[i];
			if (e.kind === 'usage') return e;
		}
		return null;
	});

	let usageFmt = $state<'pct' | 'raw'>('pct');

	let turnNumbers = $derived.by(() => {
		const sorted = [...diagnosticsStore.traces].sort((a, b) => a.createdAt - b.createdAt);
		const result: Record<string, number> = {};
		sorted.forEach((t, i) => {
			result[t.id] = i + 1;
		});
		return result;
	});

	let isClearable = $derived(!!chatId || !!labId || !!quizId);

	async function onClear() {
		if (labId) await diagnosticsStore.clearLab(labId);
		else if (quizId) await diagnosticsStore.clearQuiz(quizId);
		else if (chatId) await diagnosticsStore.clear(chatId);
	}

	function fmtNum(n: number): string {
		if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
		return String(n);
	}
</script>

<Sheet bind:open={diagnosticsStore.open}>
	<SheetContent side="right" class="w-[480px] sm:w-[540px]">
		<SheetHeader>
			<SheetTitle>{title ?? 'Mayon console'}</SheetTitle>
		</SheetHeader>

		<div class="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
			<div class="flex items-center justify-between">
				<div class="flex flex-wrap gap-1">
					{#each KIND_OPTIONS as opt (opt.label)}
						<button
							type="button"
							class="rounded-md px-2 py-0.5 text-xs font-medium transition-colors {JSON.stringify(
								activeKind
							) === JSON.stringify(opt.value)
								? 'bg-primary text-primary-foreground'
								: 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
							onclick={() => onSelectKind(opt.value as string[] | null)}
						>
							{opt.label}
						</button>
					{/each}
				</div>
				{#if isClearable}
					<Button variant="outline" size="sm" onclick={() => void onClear()}>
						<Trash2 class="size-3" />
						Clear
					</Button>
				{/if}
			</div>

			<span class="text-xs text-muted-foreground">
				{diagnosticsStore.traces.length} trace{diagnosticsStore.traces.length !== 1 ? 's' : ''}
			</span>

			{#if diagnosticsStore.liveEvents.length > 0}
				<section class="rounded-lg border border-border p-3 space-y-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						In-flight turn...
					</h3>
					{#if liveParts.length > 0}
						<div class="flex flex-wrap gap-1">
							{#each liveParts as part (part.type)}
								<span
									class="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-mono"
								>
									{part.type}
									<span class="rounded-full bg-background px-1 text-[10px]">{part.count}</span>
								</span>
							{/each}
						</div>
					{/if}
					{#if liveReasoning}
						<div>
							<span class="text-xs font-medium text-muted-foreground">Reasoning</span>
							<pre
								class="overflow-auto max-h-64 bg-muted rounded p-2 font-mono text-xs mt-1 whitespace-pre-wrap"><span
									class="opacity-70">{liveReasoning}</span
								></pre>
						</div>
					{/if}
					{#if liveText}
						<div>
							<span class="text-xs font-medium text-muted-foreground">Text</span>
							<pre
								class="overflow-auto max-h-64 bg-muted rounded p-2 font-mono text-xs mt-1 whitespace-pre-wrap"><span
									class="opacity-70">{liveText}</span
								></pre>
						</div>
					{/if}
					{#if liveError}
						<div
							class="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
						>
							<span class="font-semibold">Error: </span>{liveError}
						</div>
					{/if}
					{#if liveUsage}
						{@const limit = estimateContextLimit(liveUsage.modelId)}
						{#if limit != null}
							<div class="flex items-center gap-2 text-xs text-muted-foreground">
								<span>
									{#if usageFmt === 'pct'}
										Context: ~{fmtNum(liveUsage.usage.totalTokens)} / {fmtNum(limit)} ({Math.round(
											(liveUsage.usage.totalTokens / limit) * 100
										)}%) est.
									{:else}
										Prompt: {fmtNum(liveUsage.usage.promptTokens)} / Completion: {fmtNum(
											liveUsage.usage.completionTokens
										)} / Total: {fmtNum(liveUsage.usage.totalTokens)}
									{/if}
								</span>
								<button
									type="button"
									class="underline hover:text-foreground"
									onclick={() => (usageFmt = usageFmt === 'pct' ? 'raw' : 'pct')}>toggle</button
								>
							</div>
						{/if}
					{/if}
				</section>
			{/if}

			<section class="space-y-1">
				{#each [...diagnosticsStore.traces].sort((a, b) => b.createdAt - a.createdAt) as trace (trace.id)}
					{@const parsed = parseTrace(trace)}
					{@const isChat = trace.kind === 'chat'}
					{@const isEmpty = isChat && parsed?.persisted?.empty === true}
					{@const errorMsg =
						typeof parsed?.error === 'string' && parsed.error ? parsed.error : null}
					{@const num = turnNumbers[trace.id] ?? 0}
					<button
						type="button"
						class="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent transition-colors {diagnosticsStore.selectedTurnId ===
						trace.id
							? 'bg-accent'
							: ''} {isEmpty ? 'border border-destructive/50' : ''}"
						onclick={() => diagnosticsStore.selectTurn(trace.id)}
					>
						<span class="text-xs text-muted-foreground w-5 shrink-0">#{num}</span>
						<span
							class="text-xs text-muted-foreground rounded bg-muted px-1 py-0.5 uppercase font-mono text-[10px]"
							>{trace.kind}</span
						>
						<span class="flex-1 truncate font-mono text-xs">{trace.model ?? '?'}</span>
						<span class="text-xs text-muted-foreground">
							{formatDuration(trace.durationMs)}
						</span>
						{#if errorMsg}
							<span class="text-destructive text-xs font-semibold flex items-center gap-0.5">
								<AlertTriangle class="size-3" />
								Error
							</span>
						{:else if isEmpty}
							<span class="text-destructive text-xs font-semibold flex items-center gap-0.5">
								<AlertTriangle class="size-3" />
								No text received
							</span>
						{:else if isChat && parsed?.iterations?.[0]?.finishReason}
							<span class="text-xs text-muted-foreground">
								{parsed.iterations[0].finishReason}
							</span>
						{/if}
					</button>
				{/each}
			</section>

			{#if selectedTrace && selectedParsed}
				<section class="space-y-4 border-t border-border pt-4">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Trace — #{turnNumbers[selectedTrace.id] ?? 0} ({selectedTrace.kind})
					</h3>

					{#if typeof selectedParsed.error === 'string' && selectedParsed.error}
						<div
							class="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive space-y-1"
						>
							<div class="flex items-center gap-1 font-semibold">
								<AlertTriangle class="size-3.5" />
								Turn errored
							</div>
							<pre class="whitespace-pre-wrap break-words font-mono">{selectedParsed.error}</pre>
							<Button
								variant="ghost"
								size="sm"
								class="h-6 px-2 text-xs"
								onclick={() => copyText(selectedParsed.error)}
							>
								<Copy class="size-3" /> Copy
							</Button>
						</div>
					{/if}

					{#if selectedIsChat}
						{@const parsed = selectedParsed}
						{#each parsed.iterations ?? [] as iter, i (i)}
							<div class="space-y-3">
								{#if i > 0}
									<div class="border-t border-border pt-3">
										<span class="text-xs font-semibold text-muted-foreground">
											Iteration {i + 1}
										</span>
									</div>
								{/if}

								<div class="space-y-2">
									<div class="flex items-center justify-between">
										<span class="text-xs font-semibold text-muted-foreground">
											Assembled Request
										</span>
										<Button
											variant="ghost"
											size="sm"
											class="h-6 px-2 text-xs"
											onclick={() => copyText(JSON.stringify(iter.request, null, 2))}
										>
											<Copy class="size-3" /> Copy
										</Button>
									</div>

									{#if iter.request.system}
										<div>
											<button
												type="button"
												class="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
												onclick={() => (expandedSystem = !expandedSystem)}
											>
												{#if expandedSystem}
													<ChevronDown class="size-3" />
												{:else}
													<ChevronRight class="size-3" />
												{/if}
												System note ({iter.request.system.length} chars)
											</button>
											{#if expandedSystem}
												<pre
													class="overflow-auto max-h-64 bg-muted rounded p-2 font-mono text-xs mt-1 whitespace-pre-wrap">{iter
														.request.system}</pre>
											{/if}
										</div>
									{/if}

									<div class="space-y-1">
										{#each iter.request.messages ?? [] as msg, _mi (_mi)}
											<div class="flex items-start gap-2 text-xs">
												<span
													class="shrink-0 rounded bg-muted px-1 py-0.5 font-mono font-semibold uppercase text-[10px]"
												>
													{msg.role}
												</span>
												<pre
													class="overflow-auto max-h-64 bg-muted rounded p-2 font-mono text-xs flex-1 whitespace-pre-wrap">{msg.content}</pre>
											</div>
										{/each}
									</div>
								</div>

								{#if iter.partSequence && iter.partSequence.length > 0}
									<div class="space-y-1">
										<span class="text-xs font-semibold text-muted-foreground"> Part Sequence </span>
										<div class="flex flex-wrap gap-1">
											{#each iter.partSequence as part (part.type)}
												<span
													class="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-mono"
												>
													{part.type}
													<span class="rounded-full bg-background px-1 text-[10px]"
														>{part.count}</span
													>
												</span>
											{/each}
										</div>
										{#if !iter.partSequence.some((p: { type: string; count: number }) => p.type === 'text-delta' && p.count > 0)}
											<span
												class="inline-flex items-center gap-1 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-0.5 text-xs text-destructive font-medium"
											>
												<AlertTriangle class="size-3" />
												0 text-delta parts
											</span>
										{/if}
									</div>
								{/if}

								{#if iter.reasoning}
									<div class="space-y-1">
										<div class="flex items-center justify-between">
											<span class="text-xs font-semibold text-muted-foreground"> Reasoning </span>
											<Button
												variant="ghost"
												size="sm"
												class="h-6 px-2 text-xs"
												onclick={() => copyText(iter.reasoning)}
											>
												<Copy class="size-3" /> Copy
											</Button>
										</div>
										<pre
											class="overflow-auto max-h-64 bg-muted rounded p-2 font-mono text-xs whitespace-pre-wrap">{iter.reasoning}</pre>
									</div>
								{/if}

								{#if iter.receivedText}
									<div class="space-y-1">
										<div class="flex items-center justify-between">
											<span class="text-xs font-semibold text-muted-foreground">
												Received Text
											</span>
											<Button
												variant="ghost"
												size="sm"
												class="h-6 px-2 text-xs"
												onclick={() => copyText(iter.receivedText)}
											>
												<Copy class="size-3" /> Copy
											</Button>
										</div>
										<pre
											class="overflow-auto max-h-64 bg-muted rounded p-2 font-mono text-xs whitespace-pre-wrap">{iter.receivedText}</pre>
									</div>
								{/if}

								{#if iter.toolCalls && iter.toolCalls.length > 0}
									<div class="space-y-1">
										<div class="flex items-center justify-between">
											<span class="text-xs font-semibold text-muted-foreground"> Tool Calls </span>
											<Button
												variant="ghost"
												size="sm"
												class="h-6 px-2 text-xs"
												onclick={() => copyText(JSON.stringify(iter.toolCalls, null, 2))}
											>
												<Copy class="size-3" /> Copy
											</Button>
										</div>
										{#each iter.toolCalls as tc, tci (`${tc.toolCallId}@${tci}`)}
											<div class="rounded-md bg-muted p-2 text-xs space-y-0.5">
												<span class="font-mono font-semibold">{tc.toolName}</span>
												<span class="text-muted-foreground">({tc.toolCallId})</span>
												<pre class="overflow-auto max-h-32 font-mono text-xs mt-1">{JSON.stringify(
														tc.args,
														null,
														2
													)}</pre>
											</div>
										{/each}
									</div>
								{/if}

								{#if iter.toolResults && iter.toolResults.length > 0}
									<div class="space-y-1">
										<div class="flex items-center justify-between">
											<span class="text-xs font-semibold text-muted-foreground">
												Tool Results
											</span>
											<Button
												variant="ghost"
												size="sm"
												class="h-6 px-2 text-xs"
												onclick={() => copyText(JSON.stringify(iter.toolResults, null, 2))}
											>
												<Copy class="size-3" /> Copy
											</Button>
										</div>
										{#each iter.toolResults as tr, tri (`${tr.toolCallId}@${tri}`)}
											<div class="rounded-md bg-muted p-2 text-xs space-y-0.5">
												<span class="text-muted-foreground">({tr.toolCallId})</span>
												<span class="font-medium">{tr.summary}</span>
												<pre class="overflow-auto max-h-32 font-mono text-xs mt-1">{JSON.stringify(
														tr.detail,
														null,
														2
													)}</pre>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
						{#if parsed.mcpEvents && parsed.mcpEvents.length > 0}
							<div class="mt-4">
								<h4 class="text-sm font-medium text-muted-foreground mb-2">MCP Events</h4>
								{#each parsed.mcpEvents as ev (ev.kind + ev.serverId)}
									<div class="text-xs font-mono p-2 rounded bg-muted mb-1">
										<span class="font-bold">{ev.kind}</span>
										<span class="text-muted-foreground ml-2">{ev.serverName}</span>
										{#if ev.kind === 'mcp-sampling'}
											<span class="ml-2">{ev.approved ? 'approved' : 'denied'}</span>
											{#if ev.tokensUsed}
												<span class="ml-1">({ev.tokensUsed} tokens)</span>
											{/if}
										{/if}
										{#if ev.kind === 'mcp-elicitation'}
											<span class="ml-2">{ev.accepted ? 'accepted' : 'declined'}</span>
										{/if}
										{#if ev.kind === 'mcp-lifecycle'}
											<span class="ml-2">{ev.action}</span>
											{#if ev.detail}
												<span class="ml-1 text-destructive">({ev.detail})</span>
											{/if}
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					{:else}
						{@const parsed = selectedParsed}
						{@const request = parsed.request}
						{@const result = parsed.result}
						{@const gradeFields =
							selectedTrace.kind === 'grade' ? (parsed as Record<string, unknown>) : null}

						{#if request}
							<div class="space-y-2">
								<span class="text-xs font-semibold text-muted-foreground">Request</span>
								{#if request.system}
									<div>
										<button
											type="button"
											class="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
											onclick={() => (expandedSystem = !expandedSystem)}
										>
											{#if expandedSystem}
												<ChevronDown class="size-3" />
											{:else}
												<ChevronRight class="size-3" />
											{/if}
											System note ({typeof request.system === 'string'
												? request.system.length
												: '?'} chars)
										</button>
										{#if expandedSystem}
											<pre
												class="overflow-auto max-h-64 bg-muted rounded p-2 font-mono text-xs mt-1 whitespace-pre-wrap">{typeof request.system ===
												'string'
													? request.system
													: JSON.stringify(request.system, null, 2)}</pre>
										{/if}
									</div>
								{/if}

								{#if request.messages?.length}
									<div class="space-y-1">
										{#each request.messages as msg, _mi (_mi)}
											<div class="flex items-start gap-2 text-xs">
												<span
													class="shrink-0 rounded bg-muted px-1 py-0.5 font-mono font-semibold uppercase text-[10px]"
												>
													{msg.role}
												</span>
												<pre
													class="overflow-auto max-h-64 bg-muted rounded p-2 font-mono text-xs flex-1 whitespace-pre-wrap">{typeof msg.content ===
													'string'
														? msg.content
														: JSON.stringify(msg.content, null, 2)}</pre>
											</div>
										{/each}
									</div>
								{/if}
								<div class="flex justify-end">
									<Button
										variant="ghost"
										size="sm"
										class="h-6 px-2 text-xs"
										onclick={() => copyText(JSON.stringify(request, null, 2))}
									>
										<Copy class="size-3" /> Copy
									</Button>
								</div>
							</div>
						{/if}

						{#if gradeFields}
							<div class="space-y-2">
								<span class="text-xs font-semibold text-muted-foreground">Grade Fields</span>
								{#each ['questionId', 'prompt', 'rubric', 'answer'] as field (field)}
									{#if gradeFields[field] != null}
										<div>
											<span class="text-xs text-muted-foreground">{field}</span>
											<pre
												class="overflow-auto max-h-32 bg-muted rounded p-2 font-mono text-xs mt-0.5 whitespace-pre-wrap">{typeof gradeFields[
													field
												] === 'string'
													? (gradeFields[field] as string)
													: JSON.stringify(gradeFields[field], null, 2)}</pre>
										</div>
									{/if}
								{/each}
							</div>
						{/if}

						{#if result}
							<div class="space-y-1">
								<div class="flex items-center justify-between">
									<span class="text-xs font-semibold text-muted-foreground">Result</span>
									<Button
										variant="ghost"
										size="sm"
										class="h-6 px-2 text-xs"
										onclick={() => copyText(JSON.stringify(result, null, 2))}
									>
										<Copy class="size-3" /> Copy
									</Button>
								</div>
								<pre
									class="overflow-auto max-h-64 bg-muted rounded p-2 font-mono text-xs whitespace-pre-wrap">{JSON.stringify(
										result,
										null,
										2
									)}</pre>
							</div>
						{/if}

						{#if typeof parsed.raw === 'string' && parsed.raw}
							<div class="space-y-1">
								<div class="flex items-center justify-between">
									<span class="text-xs font-semibold text-muted-foreground">Raw</span>
									<Button
										variant="ghost"
										size="sm"
										class="h-6 px-2 text-xs"
										onclick={() => copyText(parsed.raw)}
									>
										<Copy class="size-3" /> Copy
									</Button>
								</div>
								<pre
									class="overflow-auto max-h-64 bg-muted rounded p-2 font-mono text-xs whitespace-pre-wrap">{parsed.raw}</pre>
							</div>
						{/if}
					{/if}

					<div class="flex justify-end pt-2">
						<Button variant="outline" size="sm" onclick={() => copyText(selectedTrace.trace)}>
							<Copy class="size-3" />
							Copy raw JSON
						</Button>
					</div>
				</section>
			{/if}
		</div>
	</SheetContent>
</Sheet>
