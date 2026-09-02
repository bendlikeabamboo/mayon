import type { AuthMode, GateRole } from '@mayon/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sha256Hex } from './crypto';
import type { AuthStore } from './store';

export interface RequestAuth {
	identityId: string;
	label: string;
	role: GateRole;
	sessionId: string;
}

declare module 'fastify' {
	interface FastifyRequest {
		auth?: RequestAuth;
	}
}

/** Route + method pairs reachable without a session while locked (contracts/auth-api.md). */
export const PUBLIC_ALLOWLIST: Readonly<Record<string, string>> = {
	'/api/health': 'GET',
	'/api/auth/session': 'POST',
	'/api/auth/login': 'POST',
	'/api/auth/setup': 'POST',
	'/api/auth/setup/confirm': 'POST',
	'/api/auth/enroll': 'POST',
	'/api/auth/logout': 'POST'
};

const LAST_SEEN_THROTTLE_MS = 60_000;

export interface AuthGateDeps {
	store: AuthStore;
	getSecurityMode: () => Promise<AuthMode>;
	resolveSessionToken: (request: FastifyRequest) => string | undefined;
	now: () => number;
}

export function registerAuthGate(app: FastifyInstance, deps: AuthGateDeps): void {
	const lastSeenTouch = new Map<string, number>();
	const LAST_SEEN_MAP_CAP = 5_000;

	app.addHook('onRequest', async (request, reply) => {
		if ((await deps.getSecurityMode()) === 'open') {
			return;
		}

		if (request.method !== 'GET' && !originMatches(request)) {
			reply.code(403).send({ error: 'bad origin' });
			return;
		}

		const path = request.url.split('?')[0];
		if (PUBLIC_ALLOWLIST[path] === request.method) {
			return;
		}

		const token = deps.resolveSessionToken(request);
		if (!token) {
			refuseUnauthenticated(reply);
			return;
		}
		const found = await deps.store.findValidSessionByTokenHash(sha256Hex(token), deps.now());
		if (!found) {
			refuseUnauthenticated(reply);
			return;
		}

		request.auth = {
			identityId: found.identity.id,
			label: found.identity.label,
			role: found.identity.role,
			sessionId: found.session.id
		};

		const ts = deps.now();
		if (lastSeenTouch.size > LAST_SEEN_MAP_CAP) {
			lastSeenTouch.clear();
		}
		if (ts - (lastSeenTouch.get(found.session.id) ?? 0) >= LAST_SEEN_THROTTLE_MS) {
			lastSeenTouch.set(found.session.id, ts);
			void deps.store.touchSession(found.session.id, ts).catch(() => {});
		}
	});
}

function refuseUnauthenticated(reply: FastifyReply): void {
	reply.code(401).send({ error: 'unauthenticated' });
}

function originMatches(request: FastifyRequest): boolean {
	const origin = request.headers.origin;
	if (origin === undefined) {
		return true;
	}
	let originHost: string;
	try {
		originHost = new URL(origin).host;
	} catch {
		return false;
	}
	if (originHost === request.host) {
		return true;
	}
	// Behind an extra proxy that rewrites Host (e.g. Caddy floor), the
	// original host surfaces in X-Forwarded-Host — browsers cannot forge it
	// cross-site, so accepting a match there keeps the CSRF guarantee.
	// With trustProxy: 1 the rightmost entry is the one our own proxy saw.
	const forwardedHost = request.headers['x-forwarded-host'];
	if (typeof forwardedHost === 'string' && forwardedHost.length > 0) {
		const entries = forwardedHost.split(',').map((value) => value.trim());
		return originHost === entries[entries.length - 1];
	}
	return false;
}
