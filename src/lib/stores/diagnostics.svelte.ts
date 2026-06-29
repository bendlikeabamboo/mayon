import type { TraceEvent } from '$lib/agent/trace';
import type { AgentTrace } from '$lib/db/schema';
import { repos } from '$lib/db';

class DiagnosticsStore {
	open = $state(false);
	liveEvents = $state<TraceEvent[]>([]);
	traces = $state<AgentTrace[]>([]);
	selectedTurnId = $state<string | null>(null);

	async load(chatId: string): Promise<void> {
		this.traces = await repos.agentTraces.listByChat(chatId);
	}

	liveEmit(e: TraceEvent): void {
		this.liveEvents = [...this.liveEvents, e];
	}

	endTurn(): void {
		this.liveEvents = [];
	}

	async clear(chatId: string): Promise<void> {
		await repos.agentTraces.deleteByChat(chatId);
		this.traces = [];
		this.selectedTurnId = null;
	}

	toggle(): void {
		this.open = !this.open;
	}

	selectTurn(id: string): void {
		this.selectedTurnId = this.selectedTurnId === id ? null : id;
	}
}

export const diagnosticsStore = new DiagnosticsStore();
