import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
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

/**
 * Resolve a spawn command to an executable path. Absolute paths and
 * slash-relative commands pass through untouched (spawn resolves those against
 * cwd). Bare names (npx, node, …) are resolved against PATH so they work
 * regardless of the runtime's spawn semantics, and unresolvable names fail
 * fast with the real reason instead of surfacing as a generic timeout later.
 *
 * PATH entries are mirrored with execvp semantics as seen by the child:
 * relative entries and empty entries (current directory) resolve against the
 * child's cwd, not the bridge process's.
 */
export function resolveCommand(
	command: string,
	env: NodeJS.ProcessEnv,
	cwd?: string
): { path: string } | { error: string } {
	if (process.platform === 'win32') return { path: command };
	if (command === '') return { error: 'missing command' };
	if (path.isAbsolute(command) || command.includes('/')) return { path: command };

	const childCwd = path.resolve(cwd && cwd.length > 0 ? cwd : process.cwd());
	for (const raw of String(env.PATH ?? '').split(path.delimiter)) {
		const dir = raw === '' ? childCwd : path.resolve(childCwd, raw);
		const candidate = path.join(dir, command);
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			return { path: candidate };
		} catch {
			/* keep searching */
		}
	}
	return { error: `command not found in PATH: ${command}` };
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

					const spawnEnv: NodeJS.ProcessEnv = { ...process.env, ...s.env };
					const resolved = resolveCommand(s.command, spawnEnv, s.cwd);
					if ('error' in resolved) {
						console.warn(`[mcp] ${resolved.error}`);
						sendExit(frame.serverId, -1, resolved.error);
						return;
					}

					let child: ChildProcess;
					try {
						child = spawn(resolved.path, s.args ?? [], {
							env: spawnEnv,
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
