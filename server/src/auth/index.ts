import { randomUUID } from 'node:crypto';
import type { AuthIdentityDTO, AuthMode, AuthSessionResponse } from '@mayon/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { generateSecret, generateURI, verify } from 'otplib';
import { nextLocalMidnight, setSessionCookie } from './cookies';
import { hashPassword, randomToken, sha256Hex, unwrapSecret, wrapSecret } from './crypto';
import type { AuthStore } from './store';

const LABEL_MAX = 64;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 1024;
const TOTP_STEP_SECONDS = 30;

interface SetupBody {
	label?: unknown;
	password?: unknown;
}

interface ConfirmBody {
	code?: unknown;
}

interface PendingEnrollment {
	label: string;
	passwordHash: string;
	secretEnc: string;
}

export interface RegisterAuthDeps {
	store: AuthStore;
	getSecurityMode: () => Promise<AuthMode>;
	setSecurityMode: (mode: AuthMode) => Promise<void>;
	getAuthKey: () => Buffer;
	resolveSessionToken: (request: FastifyRequest) => string | undefined;
	now: () => number;
}

export function registerAuth(app: FastifyInstance, deps: RegisterAuthDeps): void {
	let pending: PendingEnrollment | undefined;

	const setupClosed = async (): Promise<boolean> =>
		(await deps.getSecurityMode()) === 'locked' || (await deps.store.findActiveOwner()) !== null;

	function keyFailure(reply: FastifyReply, err: unknown): FastifyReply {
		console.error('auth: auth key unavailable —', err instanceof Error ? err.message : err);
		return reply.code(500).send({ error: 'auth key unavailable' });
	}

	app.post('/api/auth/session', async (request): Promise<AuthSessionResponse> => {
		const mode = await deps.getSecurityMode();
		const token = deps.resolveSessionToken(request);
		const found = token
			? await deps.store.findValidSessionByTokenHash(sha256Hex(token), deps.now())
			: null;
		const setupRequired = mode === 'open' && (await deps.store.countNonRevokedIdentities()) === 0;
		return {
			mode,
			setupRequired,
			authenticated: found !== null,
			identity: found ? { label: found.identity.label, role: found.identity.role } : null,
			session: found ? { expiresAt: found.session.expiresAt } : null
		};
	});

	app.post<{ Body: SetupBody }>('/api/auth/setup', async (request, reply) => {
		if (await setupClosed()) {
			return reply.code(409).send({ error: 'setup closed' });
		}
		const label = typeof request.body?.label === 'string' ? request.body.label.trim() : '';
		if (label.length < 1 || label.length > LABEL_MAX) {
			return reply.code(400).send({ error: 'invalid label' });
		}
		const password = request.body?.password;
		if (
			typeof password !== 'string' ||
			password.length < PASSWORD_MIN ||
			password.length > PASSWORD_MAX
		) {
			return reply.code(400).send({ error: 'invalid password' });
		}
		let secretEnc: string;
		const secret = generateSecret();
		try {
			secretEnc = wrapSecret(secret, deps.getAuthKey());
		} catch (err) {
			return keyFailure(reply, err);
		}
		pending = {
			label,
			passwordHash: await hashPassword(password),
			secretEnc
		};
		return {
			otpauthUri: generateURI({ issuer: 'mayon', label, secret })
		};
	});

	app.post<{ Body: ConfirmBody }>('/api/auth/setup/confirm', async (request, reply) => {
		if (await setupClosed()) {
			return reply.code(409).send({ error: 'setup closed' });
		}
		if (!pending) {
			return reply.code(409).send({ error: 'setup closed' });
		}
		const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
		if (!/^\d{6}$/.test(code)) {
			return reply.code(400).send({ error: 'invalid code' });
		}
		let secret: string;
		try {
			secret = unwrapSecret(pending.secretEnc, deps.getAuthKey());
		} catch (err) {
			return keyFailure(reply, err);
		}
		const result = await verify({
			secret,
			token: code,
			epochTolerance: TOTP_STEP_SECONDS,
			epoch: Math.floor(deps.now() / 1000)
		}).catch(() => null);
		if (!result?.valid) {
			return reply.code(400).send({ error: 'invalid code' });
		}
		const now = deps.now();
		const { label, passwordHash, secretEnc } = pending;
		const identityId = randomUUID();
		await deps.store.createIdentity({
			id: identityId,
			label,
			role: 'owner',
			status: 'active',
			passwordHash,
			totpSecretEnc: secretEnc
		});
		await deps.store.setIdentityMfa(identityId, {
			totpSecretEnc: secretEnc,
			totpLastStep: result.timeStep,
			mfaEnrolledAt: now
		});
		await deps.setSecurityMode('locked');
		const token = randomToken();
		const expiresAt = nextLocalMidnight(now);
		await deps.store.createSession({
			id: randomUUID(),
			identityId,
			tokenHash: sha256Hex(token),
			expiresAt
		});
		pending = undefined;
		setSessionCookie(reply, token, expiresAt);
		const identity: AuthIdentityDTO = { label, role: 'owner' };
		return { authenticated: true, identity, session: { expiresAt } };
	});
}
