import { describe, expect, it } from 'vitest';
import {
	assertCanAttach,
	assertInputSize,
	bytesToDataUrl,
	dataUrlBytes,
	type ImageIntakeOps,
	intakeImage,
	MAX_IMAGES_PER_MESSAGE,
	MAX_INPUT_BYTES,
	MAX_LONG_EDGE,
	PASSTHROUGH_MAX_BYTES,
	planProcessing,
	resolveMime,
	sniffImageMime
} from './images';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF87A_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
const GIF89A_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP_BYTES = new Uint8Array([
	0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
]);
const TEXT_BYTES = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

/** A tiny valid 1×1 PNG, embedded as base64 so tests stay node-safe. */
const TINY_PNG_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function b64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
	return b64ToBytes(dataUrl.slice(dataUrl.indexOf(',') + 1));
}

interface StubOps {
	ops: ImageIntakeOps;
	decodeCalls: Uint8Array[];
	encodeCalls: { width: number; height: number }[];
}

/** Stub ImageIntakeOps recording every decode/encode call; no canvas involved. */
function makeStubOps(input: {
	/** Natural dims the fake bitmap reports (default 100×100). */
	bitmap?: { width: number; height: number };
	/** Bytes the fake encodeJpeg "produces" (default 16 zero bytes). */
	encoded?: Uint8Array;
}): StubOps {
	const decodeCalls: Uint8Array[] = [];
	const encodeCalls: { width: number; height: number }[] = [];
	const ops: ImageIntakeOps = {
		async decode(data) {
			decodeCalls.push(data);
			const { width = 100, height = 100 } = input.bitmap ?? {};
			return { width, height, close() {} } as unknown as ImageBitmap;
		},
		async encodeJpeg(_source, width, height) {
			encodeCalls.push({ width, height });
			return new Blob([(input.encoded ?? new Uint8Array(16)) as BlobPart], { type: 'image/jpeg' });
		}
	};
	return { ops, decodeCalls, encodeCalls };
}

describe('sniffImageMime', () => {
	it('detects PNG, JPEG, WebP, and both GIF variants by magic bytes', () => {
		expect(sniffImageMime(PNG_BYTES)).toBe('image/png');
		expect(sniffImageMime(JPEG_BYTES)).toBe('image/jpeg');
		expect(sniffImageMime(WEBP_BYTES)).toBe('image/webp');
		expect(sniffImageMime(GIF87A_BYTES)).toBe('image/gif');
		expect(sniffImageMime(GIF89A_BYTES)).toBe('image/gif');
	});

	it('returns null for non-image bytes and empty input', () => {
		expect(sniffImageMime(TEXT_BYTES)).toBeNull();
		expect(sniffImageMime(new Uint8Array())).toBeNull();
	});
});

describe('resolveMime', () => {
	it('magic bytes win even when the declared type disagrees (wrong extension case)', () => {
		expect(resolveMime(sniffImageMime(PNG_BYTES), 'text/plain')).toBe('image/png');
		expect(resolveMime(sniffImageMime(JPEG_BYTES), 'image/png')).toBe('image/jpeg');
	});

	it('sniffs when the declared type is missing (missing-type case)', () => {
		expect(resolveMime(sniffImageMime(PNG_BYTES), null)).toBe('image/png');
		expect(resolveMime(sniffImageMime(GIF89A_BYTES), '')).toBe('image/gif');
	});

	it('falls back to a declared supported type when sniffing is inconclusive', () => {
		expect(resolveMime(null, 'image/webp')).toBe('image/webp');
	});

	it('rejects when neither sniffing nor a supported declared type is available', () => {
		expect(resolveMime(null, 'image/bmp')).toBeNull();
		expect(resolveMime(null, null)).toBeNull();
		expect(resolveMime(sniffImageMime(TEXT_BYTES), 'image/bmp')).toBeNull();
	});
});

describe('assertInputSize', () => {
	it('accepts sizes up to and including the 20 MB cap', () => {
		expect(() => assertInputSize(0)).not.toThrow();
		expect(() => assertInputSize(MAX_INPUT_BYTES)).not.toThrow();
	});

	it('rejects sizes over the 20 MB cap with a clear message', () => {
		expect(() => assertInputSize(MAX_INPUT_BYTES + 1)).toThrow(/20 MB/);
	});
});

describe('assertCanAttach', () => {
	it('exposes the 8-images-per-message cap', () => {
		expect(MAX_IMAGES_PER_MESSAGE).toBe(8);
	});

	it('allows counts below the cap and throws at it', () => {
		expect(() => assertCanAttach(0)).not.toThrow();
		expect(() => assertCanAttach(MAX_IMAGES_PER_MESSAGE - 1)).not.toThrow();
		expect(() => assertCanAttach(MAX_IMAGES_PER_MESSAGE)).toThrow(/8 images/);
	});

	it('locks count semantics: 8 attach attempts (current counts 0–7) succeed, the 9th throws', () => {
		for (let currentCount = 0; currentCount < MAX_IMAGES_PER_MESSAGE; currentCount++) {
			expect(() => assertCanAttach(currentCount)).not.toThrow();
		}
		expect(() => assertCanAttach(MAX_IMAGES_PER_MESSAGE)).toThrow(/8 images/);
	});
});

describe('planProcessing', () => {
	it('passes through a small PNG untouched', () => {
		expect(planProcessing({ mime: 'image/png', bytes: 1000, width: 640, height: 480 })).toEqual({
			mode: 'passthrough',
			width: 640,
			height: 480
		});
	});

	it('passes through at the exact 1568 px and 300 KB boundaries (≤)', () => {
		expect(
			planProcessing({
				mime: 'image/png',
				bytes: PASSTHROUGH_MAX_BYTES,
				width: MAX_LONG_EDGE,
				height: 940
			})
		).toEqual({ mode: 'passthrough', width: 1568, height: 940 });
		expect(
			planProcessing({
				mime: 'image/jpeg',
				bytes: PASSTHROUGH_MAX_BYTES,
				width: 940,
				height: MAX_LONG_EDGE
			})
		).toEqual({ mode: 'passthrough', width: 940, height: 1568 });
	});

	it('downscales landscape and portrait sources to a 1568 px long edge', () => {
		expect(
			planProcessing({ mime: 'image/png', bytes: 10_000_000, width: 3136, height: 1572 })
		).toEqual({ mode: 'downscale', width: 1568, height: 786 });
		expect(
			planProcessing({ mime: 'image/png', bytes: 10_000_000, width: 2000, height: 1000 })
		).toEqual({ mode: 'downscale', width: 1568, height: 784 });
		expect(
			planProcessing({ mime: 'image/jpeg', bytes: 10_000_000, width: 1000, height: 2000 })
		).toEqual({ mode: 'downscale', width: 784, height: 1568 });
	});

	it('re-encodes an over-cap PNG without scaling below the long edge cap', () => {
		expect(
			planProcessing({
				mime: 'image/png',
				bytes: PASSTHROUGH_MAX_BYTES + 1,
				width: 100,
				height: 80
			})
		).toEqual({ mode: 'downscale', width: 100, height: 80 });
	});

	it('never passes WebP through (re-encodes to JPEG), even when small', () => {
		expect(planProcessing({ mime: 'image/webp', bytes: 500, width: 100, height: 100 })).toEqual({
			mode: 'downscale',
			width: 100,
			height: 100
		});
	});

	it('never passes GIF through (animated or not), even when tiny', () => {
		expect(planProcessing({ mime: 'image/gif', bytes: 500, width: 100, height: 100 })).toEqual({
			mode: 'downscale',
			width: 100,
			height: 100
		});
	});

	it('clamps scaled dimensions to at least 1 px', () => {
		expect(
			planProcessing({ mime: 'image/png', bytes: 10_000_000, width: 1, height: 4000 })
		).toEqual({
			mode: 'downscale',
			width: 1,
			height: 1568
		});
	});
});

describe('data URL helpers', () => {
	it('encodes known bytes and reports decoded byte length', () => {
		const url = bytesToDataUrl(new Uint8Array([0, 1, 2]), 'image/png');
		expect(url).toBe('data:image/png;base64,AAEC');
		expect(dataUrlBytes(url)).toBe(3);
	});

	it('round-trips byte length across chunk boundaries', () => {
		const bytes = new Uint8Array(100_000);
		for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
		const url = bytesToDataUrl(bytes, 'image/jpeg');
		expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
		expect(dataUrlBytes(url)).toBe(bytes.length);
	});

	it('returns 0 for a string without a data-URL payload', () => {
		expect(dataUrlBytes('not-a-data-url')).toBe(0);
	});
});

describe('intakeImage', () => {
	it('passes a small PNG through with its original bytes, mime, and dims untouched', async () => {
		const original = b64ToBytes(TINY_PNG_B64);
		const { ops, decodeCalls, encodeCalls } = makeStubOps({ bitmap: { width: 1, height: 1 } });
		const part = await intakeImage(new File([original as BlobPart], 'tiny.png'), undefined, ops);
		expect(part.type).toBe('image');
		expect(part.mimeType).toBe('image/png');
		expect(Array.from(dataUrlToBytes(part.data))).toEqual(Array.from(original));
		expect(part.bytes).toBe(original.byteLength);
		expect(part.width).toBe(1);
		expect(part.height).toBe(1);
		expect(part.name).toBe('tiny.png');
		expect(decodeCalls).toHaveLength(1); // decode runs to learn dims
		expect(encodeCalls).toHaveLength(0); // but there is no re-encode / generation loss
	});

	it('downscales a source 2× over the long edge through encode at exactly the planned dims', async () => {
		const encoded = new Uint8Array(2048);
		for (let i = 0; i < encoded.length; i++) encoded[i] = i % 253;
		const { ops, decodeCalls, encodeCalls } = makeStubOps({
			bitmap: { width: 3136, height: 1880 },
			encoded
		});
		const part = await intakeImage(
			new Blob([PNG_BYTES as BlobPart], { type: 'image/png' }),
			'shot.png',
			ops
		);
		expect(Array.from(decodeCalls[0])).toEqual(Array.from(PNG_BYTES));
		expect(encodeCalls).toEqual([{ width: 1568, height: 940 }]); // 3136×1880, aspect preserved
		expect(part.mimeType).toBe('image/jpeg');
		expect(part.width).toBe(1568);
		expect(part.height).toBe(940);
		expect(Array.from(dataUrlToBytes(part.data))).toEqual(Array.from(encoded));
		expect(part.bytes).toBe(encoded.byteLength);
		expect(part.bytes).toBe(dataUrlBytes(part.data));
		expect(part.name).toBe('shot.png');
	});

	it('always re-encodes GIF through decode/encode, even when tiny (never passthrough)', async () => {
		const { ops, encodeCalls } = makeStubOps({ bitmap: { width: 100, height: 100 } });
		const part = await intakeImage(
			new Blob([GIF89A_BYTES as BlobPart], { type: 'image/gif' }),
			undefined,
			ops
		);
		expect(encodeCalls).toEqual([{ width: 100, height: 100 }]);
		expect(part.mimeType).toBe('image/jpeg');
	});

	it('rejects input over the 20 MB cap before decoding anything', async () => {
		const oversized = new Uint8Array(MAX_INPUT_BYTES + 1);
		oversized[0] = 0x89;
		oversized.set([0x50, 0x4e, 0x47], 1); // even a sniffable PNG must hit the size gate first
		const { ops, decodeCalls } = makeStubOps({});
		await expect(
			intakeImage(new Blob([oversized as BlobPart], { type: 'image/png' }), undefined, ops)
		).rejects.toThrow(/20 MB/);
		expect(decodeCalls).toHaveLength(0);
	});

	it('rejects unsupported formats (PDF magic) with the formats message and never decodes', async () => {
		const { ops, decodeCalls } = makeStubOps({});
		await expect(
			intakeImage(new Blob([PDF_BYTES as BlobPart], { type: 'application/pdf' }), undefined, ops)
		).rejects.toThrow(/PNG, JPEG, WebP, and GIF/);
		expect(decodeCalls).toHaveLength(0);
	});
});
