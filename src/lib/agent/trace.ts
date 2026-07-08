export type TraceEvent =
	| {
			kind: 'request';
			system: string;
			messages: Array<{ role: string; content: string }>;
			tools: string[];
			providerOptions: Record<string, unknown>;
	  }
	| { kind: 'part'; type: string; payload?: unknown }
	| { kind: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }
	| { kind: 'tool-result'; toolCallId: string; summary: string; detail: Record<string, unknown> }
	| { kind: 'persisted'; messageId: string; finalText: string; empty: boolean }
	| { kind: 'aborted' }
	| { kind: 'error'; message: string }
	| {
			kind: 'usage';
			usage: { promptTokens: number; completionTokens: number; totalTokens: number };
			modelId: string;
	  }
	| {
			kind: 'mcp-sampling';
			serverId: string;
			serverName: string;
			approved: boolean;
			tokensUsed?: number;
	  }
	| { kind: 'mcp-elicitation'; serverId: string; serverName: string; accepted: boolean }
	| {
			kind: 'mcp-lifecycle';
			serverId: string;
			serverName: string;
			action: 'connect' | 'disconnect' | 'error';
			detail?: string;
	  };

interface TurnTrace {
	aborted: boolean;
	error: string | null;
	iterations: Array<{
		index: number;
		request: {
			system: string;
			messages: Array<{ role: string; content: string }>;
			tools: string[];
			providerOptions: Record<string, unknown>;
		};
		partSequence: Array<{ type: string; count: number }>;
		reasoning: string;
		receivedText: string;
		finishReason?: string;
		toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>;
		toolResults: Array<{ toolCallId: string; summary: string; detail: Record<string, unknown> }>;
	}>;
	finalText: string;
	persisted: { messageId: string; empty: boolean } | null;
	mcpEvents?: Array<{ kind: string; serverId: string; serverName: string; [k: string]: unknown }>;
}

interface IterationState {
	index: number;
	request: {
		system: string;
		messages: Array<{ role: string; content: string }>;
		tools: string[];
		providerOptions: Record<string, unknown>;
	};
	partSequence: Array<{ type: string; count: number }>;
	reasoning: string;
	receivedText: string;
	finishReason?: string;
	toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>;
	toolResults: Array<{ toolCallId: string; summary: string; detail: Record<string, unknown> }>;
}

export interface ObjectTraceRequest {
	system: string;
	messages: Array<{ role: string; content: string }>;
	schema?: string;
}

export interface ObjectTraceInput {
	kind: string;
	request: ObjectTraceRequest;
	result?: { object: unknown };
	error?: string;
	raw?: string;
	questionId?: string;
	prompt?: string;
	rubric?: string;
	answer?: string;
}

export function buildObjectTrace(input: ObjectTraceInput): string {
	const { kind, request, result, error, raw, questionId, prompt, rubric, answer } = input;
	const payload: Record<string, unknown> = { kind, request };
	if (result) payload.result = result;
	if (error) payload.error = error;
	if (raw) payload.raw = raw;
	if (questionId) payload.questionId = questionId;
	if (prompt) payload.prompt = prompt;
	if (rubric) payload.rubric = rubric;
	if (answer) payload.answer = answer;
	return JSON.stringify(payload);
}

export class TraceBuilder {
	startTime: number | null = null;
	private aborted = false;
	private iterations: IterationState[] = [];
	private current: IterationState | null = null;
	private persistedText = '';
	private persistedInfo: { messageId: string; empty: boolean } | null = null;
	private errorMessage: string | null = null;
	private _assistantMessageId: string | null = null;
	private _empty = false;
	#mcpEvents: Array<{ kind: string; serverId: string; serverName: string; [k: string]: unknown }> =
		[];

	set assistantMessageId(v: string | null) {
		this._assistantMessageId = v;
	}

	set empty(v: boolean) {
		this._empty = v;
	}

	emit(event: TraceEvent): void {
		if (this.startTime === null) this.startTime = Date.now();

		switch (event.kind) {
			case 'request': {
				const iter: IterationState = {
					index: this.iterations.length,
					request: {
						system: event.system,
						messages: event.messages,
						tools: event.tools,
						providerOptions: event.providerOptions
					},
					partSequence: [],
					reasoning: '',
					receivedText: '',
					toolCalls: [],
					toolResults: []
				};
				this.iterations.push(iter);
				this.current = iter;
				break;
			}

			case 'part': {
				if (!this.current) break;

				const seq = this.current.partSequence;
				if (seq.length > 0 && seq[seq.length - 1].type === event.type) {
					seq[seq.length - 1].count++;
				} else {
					seq.push({ type: event.type, count: 1 });
				}

				const payload = event.payload as Record<string, unknown> | undefined;

				if (event.type === 'text-delta' && payload?.text) {
					this.current.receivedText += String(payload.text);
				} else if (event.type === 'reasoning-delta' && payload?.text) {
					this.current.reasoning += String(payload.text);
				} else if (event.type === 'reasoning' && payload?.text) {
					this.current.reasoning += String(payload.text);
				} else if (event.type === 'finish' && payload?.finishReason) {
					this.current.finishReason = String(payload.finishReason);
				} else if (event.type === 'tool-call' && payload) {
					if (
						!this.current.toolCalls.some((tc) => tc.toolCallId === String(payload.toolCallId ?? ''))
					) {
						this.current.toolCalls.push({
							toolCallId: String(payload.toolCallId ?? ''),
							toolName: String(payload.toolName ?? ''),
							args: (payload.args as Record<string, unknown>) ?? {}
						});
					}
				} else if (event.type === 'tool-result' && payload) {
					if (
						!this.current.toolResults.some(
							(tr) => tr.toolCallId === String(payload.toolCallId ?? '')
						)
					) {
						this.current.toolResults.push({
							toolCallId: String(payload.toolCallId ?? ''),
							summary: String(payload.summary ?? ''),
							detail: (payload.detail as Record<string, unknown>) ?? {}
						});
					}
				}
				break;
			}

			case 'tool-call': {
				if (this.current) {
					if (!this.current.toolCalls.some((tc) => tc.toolCallId === event.toolCallId)) {
						this.current.toolCalls.push({
							toolCallId: event.toolCallId,
							toolName: event.toolName,
							args: event.args
						});
					}
				}
				break;
			}

			case 'tool-result': {
				if (this.current) {
					if (!this.current.toolResults.some((tr) => tr.toolCallId === event.toolCallId)) {
						this.current.toolResults.push({
							toolCallId: event.toolCallId,
							summary: event.summary,
							detail: event.detail
						});
					}
				}
				break;
			}

			case 'persisted': {
				this.persistedText = event.finalText;
				this.persistedInfo = { messageId: event.messageId, empty: event.empty };
				break;
			}

			case 'aborted': {
				this.aborted = true;
				break;
			}

			case 'error': {
				this.errorMessage = event.message;
				break;
			}

			case 'usage':
				break;

			case 'mcp-sampling':
				this.#mcpEvents.push({
					kind: event.kind,
					serverId: event.serverId,
					serverName: event.serverName,
					approved: event.approved,
					tokensUsed: event.tokensUsed
				});
				break;
			case 'mcp-elicitation':
				this.#mcpEvents.push({
					kind: event.kind,
					serverId: event.serverId,
					serverName: event.serverName,
					accepted: event.accepted
				});
				break;
			case 'mcp-lifecycle':
				this.#mcpEvents.push({
					kind: event.kind,
					serverId: event.serverId,
					serverName: event.serverName,
					action: event.action,
					detail: event.detail
				});
				break;
		}
	}

	toJSON(): string {
		const finalText = this.persistedText || (this.current ? this.current.receivedText : '');

		const trace: TurnTrace = {
			aborted: this.aborted,
			error: this.errorMessage,
			iterations: this.iterations,
			finalText,
			persisted: this.persistedInfo,
			mcpEvents: this.#mcpEvents.length > 0 ? this.#mcpEvents : undefined
		};

		return JSON.stringify(trace);
	}
}
