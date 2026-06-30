import type { TraceEvent } from '$lib/agent/trace';
import type { AgentTrace } from '$lib/db/schema';
import { repos } from '$lib/db';

class DiagnosticsStore {
	open = $state(false);
	liveEvents = $state<TraceEvent[]>([]);
	traces = $state<AgentTrace[]>([]);
	selectedTurnId = $state<string | null>(null);
	kinds = $state<string[] | null>(null);

	async load(chatId: string, kinds?: string[] | null): Promise<void> {
		this.traces = await repos.agentTraces.listByChat(chatId, kinds);
		if (kinds !== undefined) this.kinds = kinds;
	}

	async loadByLab(labId: string): Promise<void> {
		this.traces = await repos.agentTraces.listByLab(labId);
		this.kinds = null;
	}

	async loadByQuiz(quizId: string): Promise<void> {
		this.traces = await repos.agentTraces.listByQuiz(quizId);
		this.kinds = null;
	}

	setKinds(kinds: string[] | null): void {
		this.kinds = kinds;
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
		this.kinds = null;
	}

	async clearLab(labId: string): Promise<void> {
		await repos.agentTraces.deleteByLab(labId);
		this.traces = [];
		this.selectedTurnId = null;
		this.kinds = null;
	}

	async clearQuiz(quizId: string): Promise<void> {
		await repos.agentTraces.deleteByQuiz(quizId);
		this.traces = [];
		this.selectedTurnId = null;
		this.kinds = null;
	}

	toggle(): void {
		this.open = !this.open;
	}

	selectTurn(id: string): void {
		this.selectedTurnId = this.selectedTurnId === id ? null : id;
	}
}

export const diagnosticsStore = new DiagnosticsStore();
