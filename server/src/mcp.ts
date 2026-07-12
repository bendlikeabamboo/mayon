import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { McpFrame } from '@mayon/shared';
import type { FastifyInstance } from 'fastify';

const DEFAULT_MAX_CHILDREN = 32;
let liveChildren = 0;

export function resetLiveChildren(): void {
	liveChildren = 0;
}

export function getMaxChildren(): number {
	return parseInt(process.env.MCP_MAX_CHILDREN ?? String(DEFAULT_MAX_CHILDREN), 10);
}

export function registerMcpBridge(app: FastifyInstance): void {
	app.get('/ws/mcp', { websocket: true }, (socket) => {
		const children = new Map<string, ChildProcess>();

		function send(frame: McpFrame) {
			socket.send(JSON.stringify(frame));
		}

		function sendExit(serverId: string, code: number, data: string) {
			send({ kind: 'exit', serverId, code, data });
		}

		function sendLine(serverId: string, kind: 'stdout' | 'stderr', line: string) {
			send({ kind, serverId, data: line });
		}

		function attachLineStream(
			child: ChildProcess,
			serverId: string,
			kind: 'stdout' | 'stderr',
			stream: NodeJS.ReadableStream
		) {
			let carry = '';
			stream.setEncoding('utf8');
			stream.on('data', (chunk: string) => {
				carry += chunk;
				let idx: number;
				while ((idx = carry.indexOf('\n')) !== -1) {
					const line = carry.slice(0, idx);
					carry = carry.slice(idx + 1);
					sendLine(serverId, kind, line);
				}
			});
			stream.on('error', () => {
				/* best-effort */
			});
		}

		socket.on('message', (raw: unknown) => {
			let frame: McpFrame;
			try {
				frame = JSON.parse(raw as string) as McpFrame;
			} catch {
				return;
			}

			switch (frame.kind) {
				case 'spawn': {
					const s = frame.spawn;
					if (!s || !s.command) {
						sendExit(frame.serverId, -1, 'missing command');
						return;
					}

					if (liveChildren >= getMaxChildren()) {
						sendExit(frame.serverId, -1, 'too many children');
						return;
					}

					if (!path.isAbsolute(s.command)) {
						console.warn(`[mcp] command is not an absolute path: ${s.command}`);
					}

					let child: ChildProcess;
					try {
						child = spawn(s.command, s.args ?? [], {
							env: { ...process.env, ...s.env },
							cwd: s.cwd,
							stdio: ['pipe', 'pipe', 'pipe']
						});
					} catch (err) {
						sendExit(frame.serverId, -1, (err as Error).message);
						return;
					}

					liveChildren++;
					children.set(frame.serverId, child);

					child.on('error', (err) => {
						liveChildren = Math.max(0, liveChildren - 1);
						children.delete(frame.serverId);
						sendExit(frame.serverId, -1, err.message);
					});

					child.on('exit', (code) => {
						liveChildren = Math.max(0, liveChildren - 1);
						children.delete(frame.serverId);
						sendExit(frame.serverId, code ?? 0, '');
					});

					attachLineStream(child, frame.serverId, 'stdout', child.stdout!);
					attachLineStream(child, frame.serverId, 'stderr', child.stderr!);

					send({ kind: 'spawned', serverId: frame.serverId });
					break;
				}

				case 'stdin': {
					const child = children.get(frame.serverId);
					if (!child?.stdin?.writable) return;
					child.stdin.write((frame.data ?? '') + '\n', () => {
						/* swallow write errors */
					});
					break;
				}

				case 'kill': {
					const child = children.get(frame.serverId);
					if (child) {
						child.kill();
						children.delete(frame.serverId);
					}
					break;
				}
			}
		});

		socket.on('close', () => {
			for (const [, child] of children) {
				child.kill();
			}
			liveChildren = Math.max(0, liveChildren - children.size);
			children.clear();
		});
	});
}
