import type { McpClient } from './client';
import type { McpPrompt, McpPromptGetResult } from './types';
import { withTimeout } from './caps';

interface PromptServerEntry {
	client: McpClient;
	prompts: McpPrompt[];
	subs: Set<() => void>;
}

export const PROMPT_SERVERS = new Map<string, PromptServerEntry>();

export async function mountPrompts(serverId: string, client: McpClient): Promise<void> {
	if (!client.hasPrompts) return;

	const prompts = await client.promptsList();

	const subs = new Set<() => void>();
	const unsub = client.subscribePromptsListChanged(async () => {
		try {
			const updated = await client.promptsList();
			const entry = PROMPT_SERVERS.get(serverId);
			if (entry) {
				entry.prompts = updated;
			}
		} catch {
			// ignore refresh errors
		}
	});
	subs.add(unsub);

	PROMPT_SERVERS.set(serverId, {
		client,
		prompts,
		subs
	});
}

export function unmountPrompts(serverId: string): void {
	const entry = PROMPT_SERVERS.get(serverId);
	if (!entry) return;
	for (const unsub of entry.subs) {
		unsub();
	}
	PROMPT_SERVERS.delete(serverId);
}

export function listMountedPrompts(): Array<{
	serverId: string;
	prompts: McpPrompt[];
}> {
	const result: Array<{ serverId: string; prompts: McpPrompt[] }> = [];
	for (const [serverId, entry] of PROMPT_SERVERS) {
		result.push({ serverId, prompts: [...entry.prompts] });
	}
	return result;
}

export async function renderPrompt(
	serverId: string,
	name: string,
	args?: Record<string, unknown>
): Promise<{ text: string; error?: string }> {
	const entry = PROMPT_SERVERS.get(serverId);
	if (!entry) {
		return { text: '', error: `unknown prompt server: ${serverId}` };
	}

	try {
		const result = await withTimeout(entry.client.promptsGet(name, args), 30000);
		return { text: flattenPromptMessages(result) };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { text: '', error: msg };
	}
}

function flattenPromptMessages(result: McpPromptGetResult): string {
	const messages = result.messages ?? [];
	if (messages.length === 0) return '';

	const parts: string[] = [];
	for (const msg of messages) {
		const text = extractTextContent(msg.content);
		if (messages.length > 1) {
			const label = msg.role === 'user' ? 'User:' : 'Assistant:';
			parts.push(`${label} ${text}`);
		} else {
			parts.push(text);
		}
	}
	return parts.join('\n\n');
}

function extractTextContent(content: McpPromptGetResult['messages'][0]['content']): string {
	if (!content) return '';
	if (typeof content === 'object' && 'type' in content) {
		if (content.type === 'text' && 'text' in content) {
			return (content as { type: 'text'; text: string }).text;
		}
		return `[unsupported content type: ${content.type}]`;
	}
	return String(content);
}
