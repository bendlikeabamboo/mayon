/**
 * Composer image intake (specs/018-image-chat-parts, research D3/D9).
 *
 * Pure, environment-free logic (mime sniffing, size caps, dimension planning,
 * data-URL helpers) is exported and unit-tested in node. All browser-dependent
 * decode/draw/encode work is isolated behind `ImageIntakeOps` with a
 * `browserOps` default so tests can inject stubs instead of a canvas.
 */
import type { ImagePart } from './kinds';

export const SUPPORTED_IMAGE_MIMES = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif'
] as const;
export type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIMES)[number];

/** Per-message attachment cap (D9). */
export const MAX_IMAGES_PER_MESSAGE = 8;
/** Pre-decode input cap (D9); prevents decode memory spikes on pathological inputs. */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
/** Long-edge cap (D3): the vision patch-grid sweet spot; larger buys no legibility. */
export const MAX_LONG_EDGE = 1568;
/** Sources at or below this byte size skip re-encoding to avoid generation loss (D3). */
export const PASSTHROUGH_MAX_BYTES = 300 * 1024;
export const JPEG_QUALITY = 0.85;

/** Throws when the composer already holds the per-message image cap (D9). */
export function assertCanAttach(currentCount: number): void {
	if (currentCount >= MAX_IMAGES_PER_MESSAGE) {
		throw new Error(`At most ${MAX_IMAGES_PER_MESSAGE} images can be attached per message.`);
	}
}

/** Pre-decode size gate (D9). */
export function assertInputSize(bytes: number): void {
	if (bytes > MAX_INPUT_BYTES) {
		throw new Error(
			`Image is too large (${(bytes / (1024 * 1024)).toFixed(1)} MB). The limit is ${MAX_INPUT_BYTES / (1024 * 1024)} MB.`
		);
	}
}

function asciiAt(data: Uint8Array, start: number, length: number): string {
	let out = '';
	for (let i = start; i < start + length && i < data.length; i++) {
		out += String.fromCharCode(data[i]);
	}
	return out;
}

/** Detect the image format from magic bytes; never consults names or declared types. */
export function sniffImageMime(data: Uint8Array): SupportedImageMime | null {
	if (asciiAt(data, 0, 4) === '\x89PNG') return 'image/png';
	if (asciiAt(data, 0, 3) === '\xff\xd8\xff') return 'image/jpeg';
	if (asciiAt(data, 0, 4) === 'RIFF' && asciiAt(data, 8, 4) === 'WEBP') return 'image/webp';
	if (asciiAt(data, 0, 4) === 'GIF8') return 'image/gif';
	return null;
}

export function isSupportedImageMime(mime: string): mime is SupportedImageMime {
	return (SUPPORTED_IMAGE_MIMES as readonly string[]).includes(mime);
}

/** Magic bytes win; the blob's declared type is only a fallback when sniffing is inconclusive. */
export function resolveMime(
	sniffed: SupportedImageMime | null,
	declaredType: string | null
): SupportedImageMime | null {
	if (sniffed) return sniffed;
	if (declaredType && isSupportedImageMime(declaredType)) return declaredType;
	return null;
}

export interface ProcessingPlan {
	mode: 'passthrough' | 'downscale';
	/** Target pixel dimensions (input dims when no scaling is needed). */
	width: number;
	height: number;
}

/**
 * Decide passthrough vs JPEG re-encode from the sniffed mime, byte size, and
 * natural pixel size (D3). Only small-enough PNG/JPEG passes through untouched;
 * GIF (animated or not) always goes through the re-encode pipeline.
 */
export function planProcessing(input: {
	mime: string;
	bytes: number;
	width: number;
	height: number;
}): ProcessingPlan {
	const eligibleForPassthrough =
		(input.mime === 'image/png' || input.mime === 'image/jpeg') &&
		input.bytes <= PASSTHROUGH_MAX_BYTES &&
		Math.max(input.width, input.height) <= MAX_LONG_EDGE;
	if (eligibleForPassthrough) {
		return { mode: 'passthrough', width: input.width, height: input.height };
	}
	const scale = Math.min(1, MAX_LONG_EDGE / Math.max(input.width, input.height));
	return {
		mode: 'downscale',
		width: Math.max(1, Math.round(input.width * scale)),
		height: Math.max(1, Math.round(input.height * scale))
	};
}

const B64_CHUNK = 0x8000;

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i += B64_CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
	}
	return `data:${mime};base64,${btoa(binary)}`;
}

/** Decoded byte length of a base64 data URL — what an ImagePart's `bytes` reports. */
export function dataUrlBytes(dataUrl: string): number {
	const comma = dataUrl.indexOf(',');
	if (comma === -1) return 0;
	const base64 = dataUrl.slice(comma + 1);
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * The only browser-dependent surface. `intakeImage` accepts an override so
 * tests (T028) can stub decode/encode without a canvas environment.
 */
export interface ImageIntakeOps {
	/** Decode image bytes to a bitmap. Animated GIFs yield their first frame
	 *  (createImageBitmap semantics) — the only frame a GIF ever contributes. */
	decode(data: Uint8Array): Promise<ImageBitmap>;
	/** Draw at the target size over a flat white background and encode JPEG q0.85. */
	encodeJpeg(source: ImageBitmap, width: number, height: number): Promise<Blob>;
}

const browserOps: ImageIntakeOps = {
	decode(data) {
		return createImageBitmap(new Blob([data as BlobPart]));
	},
	async encodeJpeg(source, width, height) {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas 2D context is unavailable.');
		ctx.fillStyle = '#ffffff'; // alpha flattens onto white (D3)
		ctx.fillRect(0, 0, width, height);
		ctx.drawImage(source, 0, 0, width, height);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
		);
		if (!blob) throw new Error('JPEG encoding failed.');
		return blob;
	}
};

function imagePart(
	data: string,
	mimeType: string,
	width: number,
	height: number,
	bytes: number,
	name?: string
): ImagePart {
	return name === undefined
		? { type: 'image', data, mimeType, width, height, bytes }
		: { type: 'image', data, mimeType, width, height, bytes, name };
}

/**
 * Full intake pipeline: sniff mime, size-gate, then passthrough (original
 * bytes, no generation loss) or decode → downscale → JPEG q0.85. Returns a
 * finished ImagePart ready to attach and store.
 */
export async function intakeImage(
	source: File | Blob,
	name?: string,
	ops: ImageIntakeOps = browserOps
): Promise<ImagePart> {
	const data = new Uint8Array(await source.arrayBuffer());
	assertInputSize(data.byteLength);
	const mime = resolveMime(sniffImageMime(data), source.type || null);
	if (!mime) {
		throw new Error('Unsupported image format. Supported formats: PNG, JPEG, WebP, and GIF.');
	}
	const fileName = name ?? (source instanceof File ? source.name : undefined);
	const bitmap = await ops.decode(data);
	try {
		const plan = planProcessing({
			mime,
			bytes: data.byteLength,
			width: bitmap.width,
			height: bitmap.height
		});
		if (plan.mode === 'passthrough') {
			return imagePart(
				bytesToDataUrl(data, mime),
				mime,
				bitmap.width,
				bitmap.height,
				data.byteLength,
				fileName
			);
		}
		// Yield to the event loop between decode and encode so intake of several
		// images never serializes into one long main-thread task — the UI can
		// paint between attachments (spec SC-007).
		await new Promise((resolve) => setTimeout(resolve, 0));
		const blob = await ops.encodeJpeg(bitmap, plan.width, plan.height);
		const encoded = new Uint8Array(await blob.arrayBuffer());
		return imagePart(
			bytesToDataUrl(encoded, 'image/jpeg'),
			'image/jpeg',
			plan.width,
			plan.height,
			encoded.byteLength,
			fileName
		);
	} finally {
		bitmap.close();
	}
}
