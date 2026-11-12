import { isIP } from 'node:net';
import { promises as dnsPromises } from 'node:dns';

/**
 * Guard for outbound relay targets (032): classifies addresses inside
 * non-public IP ranges and refuses any target whose hostname resolves (or
 * literal-parses) into one. Hand-rolled parsing, no new dependencies.
 * See `specs/032-secure-image-url-fetch/contracts/llm-proxy.md`.
 */

export class BlockedTargetError extends Error {
	readonly kind: string;
	constructor(kind: string) {
		super(`blocked target: ${kind}`);
		this.name = 'BlockedTargetError';
		this.kind = kind;
	}
}

const V4_RANGES: ReadonlyArray<{ prefix: number; bits: number; kind: string }> = [
	{ prefix: 0x00000000, bits: 8, kind: 'unspecified' }, // 0.0.0.0/8
	{ prefix: 0x0a000000, bits: 8, kind: 'private' }, // 10.0.0.0/8
	{ prefix: 0x64400000, bits: 10, kind: 'cgnat' }, // 100.64.0.0/10
	{ prefix: 0x7f000000, bits: 8, kind: 'loopback' }, // 127.0.0.0/8
	{ prefix: 0xa9fe0000, bits: 16, kind: 'link-local' }, // 169.254.0.0/16
	{ prefix: 0xac100000, bits: 12, kind: 'private' }, // 172.16.0.0/12
	{ prefix: 0xc0a80000, bits: 16, kind: 'private' }, // 192.168.0.0/16
	{ prefix: 0xe0000000, bits: 4, kind: 'multicast' }, // 224.0.0.0/4
	{ prefix: 0xf0000000, bits: 4, kind: 'reserved' } // 240.0.0.0/4
];

const V6_RANGES: ReadonlyArray<{ prefix: bigint; bits: number; kind: string }> = [
	{ prefix: 0n, bits: 128, kind: 'unspecified' }, // ::
	{ prefix: 1n, bits: 128, kind: 'loopback' }, // ::1
	{ prefix: 0xfe800000000000000000000000000000n, bits: 10, kind: 'link-local' }, // fe80::/10
	{ prefix: 0xfc000000000000000000000000000000n, bits: 7, kind: 'unique-local' }, // fc00::/7
	{ prefix: 0xff000000000000000000000000000000n, bits: 8, kind: 'multicast' } // ff00::/8
];

/**
 * WHATWG IPv4-number: decimal, `0x`-hex, or leading-`0` octal. Returns null
 * on any malformed part or out-of-range value.
 */
function parseIpv4Number(input: string): number | null {
	if (input.length === 0) return null;
	let radix = 10;
	let digits = input;
	if (input.length >= 2 && (input.startsWith('0x') || input.startsWith('0X'))) {
		radix = 16;
		digits = input.slice(2);
	} else if (input.length >= 2 && input.startsWith('0')) {
		radix = 8;
		digits = input.slice(1);
	}
	if (digits.length === 0) return null;
	const allowed = radix === 16 ? /^[0-9a-fA-F]+$/ : radix === 8 ? /^[0-7]+$/ : /^[0-9]+$/;
	if (!allowed.test(digits)) return null;
	const value = Number.parseInt(digits, radix);
	return Number.isNaN(value) ? null : value;
}

/**
 * WHATWG IPv4 parser: dotted shorthand of 1–4 parts (optional trailing dot),
 * last part may carry the leftover high bits (e.g. `0x7f000001`, `127.1`).
 * Returns the address as a uint32, or null when the input is not an IPv4
 * literal.
 */
function parseIPv4(input: string): number | null {
	const parts = input.split('.');
	if (parts.length > 4) return null;
	if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
	if (parts.length === 0) return null;
	const numbers: number[] = [];
	for (let i = 0; i < parts.length; i++) {
		const n = parseIpv4Number(parts[i]);
		if (n === null) return null;
		if (i < parts.length - 1 && n > 255) return null;
		numbers.push(n);
	}
	const last = numbers[numbers.length - 1];
	if (last >= 256 ** (5 - numbers.length)) return null;
	let value = last;
	for (let i = 0; i < numbers.length - 1; i++) {
		value += numbers[i] * 256 ** (3 - i);
	}
	return value >>> 0;
}

/** Expand an IPv6 literal (with `::` compression, optional IPv4 tail and zone) to a 128-bit BigInt, or null. */
function parseIPv6(input: string): bigint | null {
	let s = input;
	const zone = s.indexOf('%');
	if (zone !== -1) s = s.slice(0, zone);
	if (s.length === 0) return null;
	const dot = s.lastIndexOf('.');
	if (dot !== -1) {
		const colon = s.lastIndexOf(':');
		if (colon === -1) return null;
		const v4 = parseIPv4(s.slice(colon + 1));
		if (v4 === null) return null;
		s = `${s.slice(0, colon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
	}
	if (s.includes(':::')) return null;
	const sections = s.split('::');
	if (sections.length > 2) return null;
	const head = sections[0] === '' ? [] : sections[0].split(':');
	const tail = sections.length === 2 && sections[1] !== '' ? sections[1].split(':') : [];
	if (head.some((g) => g === '') || tail.some((g) => g === '')) return null;
	const missing = 8 - head.length - tail.length;
	if (missing < 0 || (sections.length === 1 && missing !== 0)) return null;
	const groups: number[] = [];
	for (const g of [...head, ...Array<string>(missing).fill('0'), ...tail]) {
		if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
		groups.push(Number.parseInt(g, 16));
	}
	let value = 0n;
	for (const g of groups) value = (value << 16n) | BigInt(g);
	return value;
}

function ipv4ToString(value: number): string {
	return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(
		'.'
	);
}

/**
 * Classify an IP address (v4 or v6 literal; brackets, zone indexes and
 * non-canonical shorthand tolerated). Returns the blocked class name, or
 * null when the address is public (or not an IP at all — callers validate
 * that separately).
 */
export function blockedAddressKind(ip: string): string | null {
	const literal = ip.trim().replace(/^\[/, '').replace(/\]$/, '');
	const v4 = parseIPv4(literal);
	if (v4 !== null) {
		for (const range of V4_RANGES) {
			const mask = (0xffffffff << (32 - range.bits)) >>> 0;
			if ((v4 & mask) >>> 0 === range.prefix) return range.kind;
		}
		return null;
	}
	const v6 = parseIPv6(literal);
	if (v6 === null) return null;
	// IPv4-mapped ::ffff:0:0/96 → recurse into the v4 table.
	if (v6 >> 32n === 0xffffn) {
		return blockedAddressKind(ipv4ToString(Number(v6 & 0xffffffffn)));
	}
	for (const range of V6_RANGES) {
		if (range.bits === 128) {
			if (v6 === range.prefix) return range.kind;
			continue;
		}
		const mask = ((1n << BigInt(range.bits)) - 1n) << BigInt(128 - range.bits);
		if ((v6 & mask) === range.prefix) return range.kind;
	}
	return null;
}

/**
 * Assert `url` targets a public address: IP literals are validated directly;
 * hostnames are resolved and **every** returned address must be public.
 * Throws `BlockedTargetError` on any blocked address; resolver errors and
 * invalid URLs propagate to the caller.
 */
export async function assertPublicHttpTarget(url: string): Promise<void> {
	const parsed = new URL(url);
	const rawHost = parsed.hostname;
	const literal = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
	if (isIP(literal) !== 0) {
		const kind = blockedAddressKind(literal);
		if (kind !== null) throw new BlockedTargetError(kind);
		return;
	}
	const addresses = await dnsPromises.lookup(literal, { all: true });
	for (const { address } of addresses) {
		const kind = blockedAddressKind(address);
		if (kind !== null) throw new BlockedTargetError(kind);
	}
}
