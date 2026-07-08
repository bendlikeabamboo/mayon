import type { McpNotification } from './types';

export interface McpServerRequest {
	id: string | number;
	method: string;
	params?: unknown;
}

export interface McpTransport {
	start(): Promise<{ name: string; version: string }>;
	request(method: string, params?: unknown): Promise<unknown>;
	notify?(method: string, params?: unknown): void;
	close(): Promise<void>;
	onNotification?(handler: (n: McpNotification) => void): void;
	removeNotification?(handler: (n: McpNotification) => void): void;
	onRequest?(handler: (req: McpServerRequest) => void): void;
	removeRequest?(handler: (req: McpServerRequest) => void): void;
	respond?(id: string | number, result: unknown, error?: { code: number; message: string }): void;
}
