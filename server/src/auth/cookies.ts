import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';

export const SESSION_COOKIE = 'mayon_session';
export const ENROLL_COOKIE = 'mayon_enroll';

const ENROLL_COOKIE_MAX_AGE_SECONDS = 900;

export function setSessionCookie(
	reply: FastifyReply,
	token: string,
	expiresAt: number,
	nowMs: number = Date.now()
): void {
	reply.setCookie(SESSION_COOKIE, token, cookieOptions(secondsUntil(expiresAt, nowMs)));
}

export function clearSessionCookie(reply: FastifyReply): void {
	reply.clearCookie(SESSION_COOKIE, cookieOptions(0));
}

export function setEnrollCookie(reply: FastifyReply, token: string): void {
	reply.setCookie(ENROLL_COOKIE, token, cookieOptions(ENROLL_COOKIE_MAX_AGE_SECONDS));
}

export function clearEnrollCookie(reply: FastifyReply): void {
	reply.clearCookie(ENROLL_COOKIE, cookieOptions(0));
}

export function nextLocalMidnight(nowMs: number): number {
	const d = new Date(nowMs);
	d.setHours(24, 0, 0, 0);
	return d.getTime();
}

function cookieOptions(maxAge: number): CookieSerializeOptions {
	return {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		secure: process.env.MAYON_COOKIE_SECURE !== 'false',
		maxAge
	};
}

function secondsUntil(expiresAt: number, nowMs: number): number {
	return Math.max(0, Math.ceil((expiresAt - nowMs) / 1000));
}
