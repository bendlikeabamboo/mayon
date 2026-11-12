import { describe, expect, it } from 'vitest';
import { BlockedTargetError, assertPublicHttpTarget, blockedAddressKind } from './url-target-guard';

describe('blockedAddressKind — IPv4', () => {
	it.each([
		['0.0.0.0', 'unspecified'],
		['0.1.2.3', 'unspecified'],
		['10.0.0.1', 'private'],
		['10.255.255.255', 'private'],
		['100.64.0.1', 'cgnat'],
		['100.127.255.255', 'cgnat'],
		['100.128.0.1', null],
		['127.0.0.1', 'loopback'],
		['127.255.0.7', 'loopback'],
		['169.254.1.1', 'link-local'],
		['169.255.0.1', null],
		['172.16.0.1', 'private'],
		['172.31.255.255', 'private'],
		['172.32.0.1', null],
		['192.168.1.1', 'private'],
		['192.169.0.1', null],
		['224.0.0.1', 'multicast'],
		['239.255.255.255', 'multicast'],
		['240.0.0.1', 'reserved'],
		['255.255.255.255', 'reserved'],
		['93.184.216.34', null],
		['8.8.8.8', null],
		['1.1.1.1', null]
	])('%s → %s', (ip, expected) => {
		expect(blockedAddressKind(ip)).toBe(expected);
	});
});

describe('blockedAddressKind — IPv6', () => {
	it.each([
		['::', 'unspecified'],
		['::1', 'loopback'],
		['fe80::1', 'link-local'],
		['febf::ffff', 'link-local'],
		['fe7f::1', null],
		['fec0::1', null],
		['fc00::1', 'unique-local'],
		['fdff::1', 'unique-local'],
		['fd00::dead:beef', 'unique-local'],
		['ff00::1', 'multicast'],
		['ff02::1', 'multicast'],
		['2606:4700::6810:85e5', null],
		['2001:db8::1', null],
		['::ffff:127.0.0.1', 'loopback'],
		['::ffff:7f00:1', 'loopback'],
		['::ffff:10.0.0.5', 'private'],
		['::ffff:192.168.1.1', 'private'],
		['::ffff:0.0.0.0', 'unspecified'],
		['::ffff:93.184.216.34', null],
		['::ffff:2606:4700:0:0', null],
		['[::1]', 'loopback'],
		['[fe80::1%25eth0]', 'link-local'],
		['[2606:4700::6810:85e5]', null]
	])('%s → %s', (ip, expected) => {
		expect(blockedAddressKind(ip)).toBe(expected);
	});
});

describe('blockedAddressKind — non-canonical IPv4 literals', () => {
	it.each([
		['0x7f000001', 'loopback'],
		['0177.0.0.1', 'loopback'],
		['127.1', 'loopback'],
		['2130706433', 'loopback'],
		['0.0.0.1', 'unspecified'],
		['0x5db8d822', null],
		['256.1.1.1', null],
		['not-an-ip', null]
	])('%s → %s', (ip, expected) => {
		expect(blockedAddressKind(ip)).toBe(expected);
	});
});

describe('assertPublicHttpTarget — literal fast path', () => {
	it.each([
		['http://127.0.0.1:4319/api/health', 'loopback'],
		['http://10.0.0.9/x', 'private'],
		['http://169.254.169.254/latest/meta-data', 'link-local'],
		['http://0x7f000001/x', 'loopback'],
		['http://[::1]/x', 'loopback'],
		['http://[::ffff:192.168.1.1]/x', 'private'],
		['http://[::ffff:7f00:1]/x', 'loopback']
	])('%s → BlockedTargetError(%s) without resolving DNS', async (url, kind) => {
		let error: unknown;
		await assertPublicHttpTarget(url).catch((e: unknown) => {
			error = e;
		});
		expect(error).toBeInstanceOf(BlockedTargetError);
		expect((error as BlockedTargetError).kind).toBe(kind);
	});

	it.each(['http://93.184.216.34/x', 'http://8.8.8.8:8080/x', 'http://[2606:4700::6810:85e5]/x'])(
		'allows public literal %s',
		async (url) => {
			await expect(assertPublicHttpTarget(url)).resolves.toBeUndefined();
		}
	);
});
