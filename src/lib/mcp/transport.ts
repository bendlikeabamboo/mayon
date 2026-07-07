import type { McpNotification } from './types';

export interface McpTransport {
	start(): Promise<{ name: string; version: string }>;
	request(method: string, params?: unknown): Promise<unknown>;
	notify?(method: string, params?: unknown): void;
	close(): Promise<void>;
	onNotification?(handler: (n: McpNotification) => void): void;
	removeNotification?(handler: (n: McpNotification) => void): void;
}
