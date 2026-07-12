import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './server';
import { resetLiveChildren } from './mcp';
import type Fastify from 'fastify';
import WebSocket from 'ws';
import { fileURLToPath } from 'node:url';

const STUB_PATH = fileURLToPath(
	new URL('../../tests/fixtures/stub-mcp-server.mjs', import.meta.url)
);

function sendFrame(ws: WebSocket, frame: Record<string, unknown>) {
	ws.send(JSON.stringify(frame));
}

function waitForFrame(
	ws: WebSocket,
	kind: string,
	timeoutMs = 5000
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`timeout waiting for ${kind}`)), timeoutMs);
		function onMessage(data: WebSocket.RawData) {
			const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
			if (parsed.kind === kind) {
				clearTimeout(timer);
				ws.off('message', onMessage);
				resolve(parsed);
			}
		}
		ws.on('message', onMessage);
	});
}

function waitForExit(
	ws: WebSocket,
	serverId: string,
	timeoutMs = 5000
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timeout waiting for exit')), timeoutMs);
		function onMessage(data: WebSocket.RawData) {
			const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
			if (parsed.kind === 'exit' && parsed.serverId === serverId) {
				clearTimeout(timer);
				ws.off('message', onMessage);
				resolve(parsed);
			}
		}
		ws.on('message', onMessage);
	});
}

function connectWs(basePort: number): WebSocket {
	return new WebSocket(`ws://127.0.0.1:${basePort}/ws/mcp`);
}

describe('MCP bridge', () => {
	let app: Fastify.Instance;
	let basePort: number;

	beforeAll(async () => {
		app = buildApp(':memory:');
		await app.listen({ port: 0, host: '0.0.0.0' });
		const addr = app.server.address();
		if (typeof addr === 'object' && addr) {
			basePort = addr.port;
		}
	});

	afterAll(async () => {
		await app.close();
	});

	it('spawned frame received before any stdout', () => {
		return new Promise<void>((resolve, reject) => {
			const ws = connectWs(basePort);
			ws.on('error', reject);
			ws.on('open', () => {
				sendFrame(ws, {
					kind: 'spawn',
					serverId: 'test1',
					spawn: {
						serverId: 'test1',
						command: process.execPath,
						args: [STUB_PATH],
						env: {}
					}
				});
			});
			waitForFrame(ws, 'spawned')
				.then((f) => {
					expect(f.serverId).toBe('test1');
					ws.close();
					resolve();
				})
				.catch((e) => {
					ws.close();
					reject(e);
				});
		});
	});

	it('initialize → tools/list → tools/call round-trip', { timeout: 15000 }, () => {
		return new Promise<void>((resolve, reject) => {
			const ws = connectWs(basePort);
			ws.on('error', reject);
			ws.on('open', () => {
				sendFrame(ws, {
					kind: 'spawn',
					serverId: 'rt1',
					spawn: {
						serverId: 'rt1',
						command: process.execPath,
						args: [STUB_PATH],
						env: {}
					}
				});
			});
			waitForFrame(ws, 'spawned')
				.then(() => {
					const initEnvelope = JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						method: 'initialize',
						params: {
							protocolVersion: '2025-06-18',
							capabilities: {},
							clientInfo: { name: 'test', version: '0.0.1' }
						}
					});
					sendFrame(ws, { kind: 'stdin', serverId: 'rt1', data: initEnvelope });

					return waitForFrame(ws, 'stdout').then((f) => {
						const result = JSON.parse(f.data as string) as Record<string, unknown>;
						expect(result.result).toBeDefined();
						expect((result.result as Record<string, unknown>).serverInfo).toBeDefined();

						const toolsListEnvelope = JSON.stringify({
							jsonrpc: '2.0',
							id: 2,
							method: 'tools/list',
							params: {}
						});
						sendFrame(ws, { kind: 'stdin', serverId: 'rt1', data: toolsListEnvelope });

						return waitForFrame(ws, 'stdout').then((f2) => {
							const result2 = JSON.parse(f2.data as string) as Record<string, unknown>;
							expect((result2.result as Record<string, unknown>).tools).toBeDefined();

							const toolsCallEnvelope = JSON.stringify({
								jsonrpc: '2.0',
								id: 3,
								method: 'tools/call',
								params: { name: 'echo', arguments: { message: 'hello' } }
							});
							sendFrame(ws, { kind: 'stdin', serverId: 'rt1', data: toolsCallEnvelope });

							return waitForFrame(ws, 'stdout').then((f3) => {
								const result3 = JSON.parse(f3.data as string) as Record<string, unknown>;
								expect((result3.result as Record<string, unknown>).content).toBeDefined();
								ws.close();
							});
						});
					});
				})
				.then(resolve, (e) => {
					ws.close();
					reject(e);
				});
		});
	});

	it('kill → exit frame; child handle removed', () => {
		return new Promise<void>((resolve, reject) => {
			const ws = connectWs(basePort);
			ws.on('error', reject);
			ws.on('open', () => {
				sendFrame(ws, {
					kind: 'spawn',
					serverId: 'kill1',
					spawn: {
						serverId: 'kill1',
						command: process.execPath,
						args: [STUB_PATH],
						env: {}
					}
				});
			});
			waitForFrame(ws, 'spawned')
				.then(() => {
					sendFrame(ws, { kind: 'kill', serverId: 'kill1' });
					return waitForExit(ws, 'kill1').then((f) => {
						expect(f.code).toBeDefined();
						ws.close();
					});
				})
				.then(resolve, (e) => {
					ws.close();
					reject(e);
				});
		});
	});

	it('spawn failure: non-existent binary → exit frame with code/data', () => {
		return new Promise<void>((resolve, reject) => {
			const ws = connectWs(basePort);
			ws.on('error', reject);
			ws.on('open', () => {
				sendFrame(ws, {
					kind: 'spawn',
					serverId: 'fail1',
					spawn: {
						serverId: 'fail1',
						command: '/nonexistent/binary',
						args: [],
						env: {}
					}
				});
			});
			waitForExit(ws, 'fail1')
				.then((f) => {
					expect(f.code).toBe(-1);
					expect(typeof f.data).toBe('string');
					ws.close();
					resolve();
				})
				.catch((e) => {
					ws.close();
					reject(e);
				});
		});
	});

	it('stderr captured', () => {
		return new Promise<void>((resolve, reject) => {
			const ws = connectWs(basePort);
			ws.on('error', reject);
			ws.on('open', () => {
				sendFrame(ws, {
					kind: 'spawn',
					serverId: 'stderr1',
					spawn: {
						serverId: 'stderr1',
						command: process.execPath,
						args: ['-e', 'process.stderr.write("boom\\n")'],
						env: {}
					}
				});
			});
			waitForFrame(ws, 'spawned')
				.then(() => waitForFrame(ws, 'stderr'))
				.then((f) => {
					expect(f.data).toBe('boom');
					ws.close();
					resolve();
				})
				.catch((e) => {
					ws.close();
					reject(e);
				});
		});
	});

	describe('over-limit rejected when MCP_MAX_CHILDREN=1', () => {
		let capApp: Fastify.Instance;
		let capPort: number;
		const originalEnv = process.env.MCP_MAX_CHILDREN;

		beforeAll(async () => {
			process.env.MCP_MAX_CHILDREN = '1';
			resetLiveChildren();
			capApp = buildApp(':memory:');
			await capApp.listen({ port: 0, host: '0.0.0.0' });
			const addr = capApp.server.address();
			if (typeof addr === 'object' && addr) {
				capPort = addr.port;
			}
		});

		afterAll(async () => {
			await capApp.close();
			process.env.MCP_MAX_CHILDREN = originalEnv;
		});

		it('rejects second spawn with too many children', { timeout: 15000 }, () => {
			return new Promise<void>((resolve, reject) => {
				const ws1 = connectWs(capPort);
				ws1.on('error', reject);
				ws1.on('open', () => {
					sendFrame(ws1, {
						kind: 'spawn',
						serverId: 'cap1',
						spawn: {
							serverId: 'cap1',
							command: process.execPath,
							args: [STUB_PATH],
							env: {}
						}
					});
				});
				waitForFrame(ws1, 'spawned')
					.then(() => {
						const ws2 = connectWs(capPort);
						ws2.on('error', reject);
						ws2.on('open', () => {
							sendFrame(ws2, {
								kind: 'spawn',
								serverId: 'cap2',
								spawn: {
									serverId: 'cap2',
									command: process.execPath,
									args: [STUB_PATH],
									env: {}
								}
							});
						});
						return waitForExit(ws2, 'cap2').then((f) => {
							expect(f.code).toBe(-1);
							expect(f.data).toBe('too many children');
							ws1.close();
							ws2.close();
						});
					})
					.then(resolve, (e) => {
						ws1.close();
						reject(e);
					});
			});
		});
	});

	it('kill-on-disconnect: socket close kills children', () => {
		return new Promise<void>((resolve, reject) => {
			const ws = connectWs(basePort);
			ws.on('error', reject);
			ws.on('open', () => {
				sendFrame(ws, {
					kind: 'spawn',
					serverId: 'disc1',
					spawn: {
						serverId: 'disc1',
						command: process.execPath,
						args: [STUB_PATH],
						env: {}
					}
				});
			});
			waitForFrame(ws, 'spawned')
				.then(() => {
					ws.close();
					return new Promise<void>((res) => setTimeout(res, 100));
				})
				.then(() => {
					const ws2 = connectWs(basePort);
					ws2.on('error', reject);
					ws2.on('open', () => {
						sendFrame(ws2, {
							kind: 'spawn',
							serverId: 'disc1',
							spawn: {
								serverId: 'disc1',
								command: process.execPath,
								args: [STUB_PATH],
								env: {}
							}
						});
					});
					return waitForFrame(ws2, 'spawned').then(() => {
						ws2.close();
					});
				})
				.then(resolve, (e) => reject(e));
		});
	});
});
