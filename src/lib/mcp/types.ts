export const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface McpServerInfo {
	name: string;
	version: string;
}

export interface McpToolAnnotations {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	openWorldHint?: boolean;
	[key: string]: unknown;
}

export interface McpTool {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
	annotations?: McpToolAnnotations;
}

export interface McpContent {
	type: string;
	text: string;
	[key: string]: unknown;
}

export interface McpToolCallResult {
	content: McpContent[];
	isError?: boolean;
}

export interface McpResource {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

export interface McpPrompt {
	name: string;
	description?: string;
	arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpNotification {
	method: string;
	params?: unknown;
}

export interface McpServerConfig {
	id: string;
	name: string;
	transport: 'stdio' | 'http';
	command?: string;
	args?: string[];
	env?: Record<string, { secretRef: string }>;
	cwd?: string;
	url?: string;
	headers?: Record<string, { secretRef?: string; value?: string }>;
	enabled: boolean;
	trustedHash?: string;
	allowSampling?: boolean;
	allowElicitation?: boolean;
	samplingMaxCallsPerTurn?: number;
	samplingMaxTokensPerTurn?: number;
	callTimeoutMs?: number;
	resultCapBytes?: number;
	createdAt: number;
}

export interface ChatMcpConfig {
	[serverId: string]: { enabled: boolean; tools?: string[] };
}

export interface McpResourceContents {
	uri: string;
	mimeType?: string;
	type: 'text' | 'blob';
	text?: string;
	[key: string]: unknown;
}

export interface McpResourceReadResult {
	contents: McpResourceContents[];
}

export interface McpPromptMessage {
	role: 'user' | 'assistant';
	content: { type: 'text'; text: string } | { type: string; [k: string]: unknown };
}

export interface McpPromptGetResult {
	description?: string;
	messages: McpPromptMessage[];
}

export interface McpAttachedResource {
	serverId: string;
	serverName: string;
	uri: string;
	name: string;
	mimeType?: string;
	content: string;
	attachedAt: number;
}

export interface McpServerTemplate {
	label: string;
	description: string;
	transport: 'stdio' | 'http';
	command?: string;
	args?: string[];
	env?: Record<string, { secretRef: string }>;
	url?: string;
	headers?: Record<string, { secretRef?: string; value?: string }>;
	requiresTrust: boolean;
	discoverableTools?: string;
	platforms?: ('web' | 'desktop')[];
}
