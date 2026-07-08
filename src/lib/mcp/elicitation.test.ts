import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from './client';
import { FakeMcpTransport } from './fake-transport';
import { registerElicitationHandler } from './elicitation';
import type { ElicitationCallbacks, ElicitationOutcome } from './elicitation';
import type { McpServerConfig } from './types';

const baseConfig: McpServerConfig = {
	id: 'srv-1',
	name: 'test-server',
	transport: 'stdio',
	enabled: true,
	allowElicitation: true,
	createdAt: Date.now()
};

async function setup(
	configOverrides: Partial<McpServerConfig> = {},
	elicitationOutcome?: ElicitationOutcome
) {
	const transport = new FakeMcpTransport();
	const config = { ...baseConfig, ...configOverrides };
	const client = new McpClient(transport, config);

	const requestElicitation = vi
		.fn<ElicitationCallbacks['requestElicitation']>()
		.mockResolvedValue(elicitationOutcome ?? { accepted: true, data: { answer: 'yes' } });

	registerElicitationHandler(client, config, { requestElicitation });
	await client.initialize();

	return { client, transport, config, requestElicitation };
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe('registerElicitationHandler', () => {
	it('returns accepted result with user data', async () => {
		const { transport, requestElicitation } = await setup();
		const userData = { color: 'blue', size: 10 };
		requestElicitation.mockResolvedValue({ accepted: true, data: userData });

		transport.emitRequest({
			id: 1,
			method: 'elicitation/create',
			params: {
				message: 'Pick a color',
				requestedSchema: { type: 'object', properties: { color: { type: 'string' } } }
			}
		});

		await vi.waitFor(() => {
			expect(transport.sentResponses).toHaveLength(1);
		});

		const resp = transport.sentResponses[0];
		expect(resp.id).toBe(1);
		expect(resp.result).toEqual({
			action: 'accept',
			content: { type: 'text', text: JSON.stringify(userData) }
		});
		expect(resp.error).toBeUndefined();
	});

	it('returns declined when user cancels', async () => {
		const { transport } = await setup(undefined, {
			accepted: false,
			declined: true
		});

		transport.emitRequest({
			id: 2,
			method: 'elicitation/create',
			params: {
				requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean' } } }
			}
		});

		await vi.waitFor(() => {
			expect(transport.sentResponses).toHaveLength(1);
		});

		const resp = transport.sentResponses[0];
		expect(resp.id).toBe(2);
		expect(resp.result).toEqual({ action: 'declined' });
		expect(resp.error).toBeUndefined();
	});

	it('handles malformed schema gracefully', async () => {
		const { transport } = await setup();

		transport.emitRequest({
			id: 3,
			method: 'elicitation/create',
			params: {
				message: 'bad schema',
				requestedSchema: 'not a schema'
			}
		});

		await vi.waitFor(() => {
			expect(transport.sentResponses).toHaveLength(1);
		});

		const resp = transport.sentResponses[0];
		expect(resp.id).toBe(3);
		expect(resp.result).toBeDefined();
		expect(resp.error).toBeUndefined();
	});

	it('handles missing params', async () => {
		const { transport } = await setup();

		transport.emitRequest({
			id: 4,
			method: 'elicitation/create'
		});

		await vi.waitFor(() => {
			expect(transport.sentResponses).toHaveLength(1);
		});

		const resp = transport.sentResponses[0];
		expect(resp.id).toBe(4);
		expect(resp.result).toBeDefined();
		expect(resp.error).toBeUndefined();
	});

	it('returns error when allowElicitation is false', async () => {
		const { transport, requestElicitation } = await setup({ allowElicitation: false });

		transport.emitRequest({
			id: 5,
			method: 'elicitation/create',
			params: { requestedSchema: { type: 'object', properties: {} } }
		});

		await vi.waitFor(() => {
			expect(transport.sentResponses).toHaveLength(1);
		});

		const resp = transport.sentResponses[0];
		expect(resp.id).toBe(5);
		expect(resp.result).toBeUndefined();
		expect(resp.error).toEqual({ code: -32603, message: 'elicitation declined' });
		expect(requestElicitation).not.toHaveBeenCalled();
	});

	it('returns error when allowElicitation is undefined', async () => {
		const { transport, requestElicitation } = await setup({ allowElicitation: undefined });

		transport.emitRequest({
			id: 6,
			method: 'elicitation/create',
			params: { requestedSchema: { type: 'object', properties: {} } }
		});

		await vi.waitFor(() => {
			expect(transport.sentResponses).toHaveLength(1);
		});

		const resp = transport.sentResponses[0];
		expect(resp.error).toEqual({ code: -32603, message: 'elicitation declined' });
		expect(requestElicitation).not.toHaveBeenCalled();
	});

	it('uses default message when none provided', async () => {
		const { transport, requestElicitation } = await setup();

		transport.emitRequest({
			id: 7,
			method: 'elicitation/create',
			params: { requestedSchema: { type: 'object', properties: {} } }
		});

		await vi.waitFor(() => {
			expect(transport.sentResponses).toHaveLength(1);
		});

		expect(requestElicitation).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Server requests input'
			})
		);
	});

	it('passes correct requestId and serverName to callback', async () => {
		const { transport, requestElicitation } = await setup();

		transport.emitRequest({
			id: 8,
			method: 'elicitation/create',
			params: {
				message: 'hello',
				requestedSchema: { type: 'object', properties: {} }
			}
		});

		await vi.waitFor(() => {
			expect(transport.sentResponses).toHaveLength(1);
		});

		expect(requestElicitation).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: 'mcp-elicitation-srv-1',
				serverName: 'test-server'
			})
		);
	});

	it('catches callback rejection and returns error', async () => {
		const { transport, requestElicitation } = await setup();
		requestElicitation.mockRejectedValue(new Error('ui unavailable'));

		transport.emitRequest({
			id: 9,
			method: 'elicitation/create',
			params: { requestedSchema: { type: 'object', properties: {} } }
		});

		await vi.waitFor(() => {
			expect(transport.sentResponses).toHaveLength(1);
		});

		const resp = transport.sentResponses[0];
		expect(resp.id).toBe(9);
		expect(resp.result).toBeUndefined();
		expect(resp.error).toEqual({ code: -32603, message: 'ui unavailable' });
	});

	it('handles abort-like rejection from callback', async () => {
		const { transport, requestElicitation } = await setup();
		requestElicitation.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

		transport.emitRequest({
			id: 10,
			method: 'elicitation/create',
			params: { requestedSchema: { type: 'object', properties: {} } }
		});

		await vi.waitFor(() => {
			expect(transport.sentResponses).toHaveLength(1);
		});

		const resp = transport.sentResponses[0];
		expect(resp.error).toEqual({ code: -32603, message: 'Aborted' });
	});
});
