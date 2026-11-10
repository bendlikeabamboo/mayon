/**
 * Composer image intake (docs/history/018-image-chat-parts.qmd, research D3/D9).
 *
 * Pure, environment-free logic (mime sniffing, size caps, dimension planning,
 * data-URL helpers) is exported and unit-tested in node. All browser-dependent
 * decode/draw/encode work is isolated behind `ImageIntakeOps` with a
 * `browserOps` default so tests can inject stubs instead of a canvas.
 */
import type { ImageCandidate } from '#lib/ai/dialects.js';
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

// ---------------------------------------------------------------------------
// Output-side budget (specs/030-image-generation, data-model validation rule 4):
// bound persisted assistant rows so their insert fits the 16 MiB
// /api/db/query request envelope (server/src/pg.ts), re-encoding down through
// the same canvas pipeline instead of rejecting.
// ---------------------------------------------------------------------------

/**
 * Per-image decoded-byte cap (030). 1 MiB keeps chart/text detail intact — a
 * ≤1568 px JPEG q0.85 re-encode typically lands ~200–400 KB, so only heavy
 * generations get re-encoded.
 */
export const MAX_OUTPUT_IMAGE_BYTES = 1024 * 1024;
/**
 * Per-message cap on the persisted data-URL strings of output images (030).
 * A worst-case 8-image row insert stays ≈8 MB, half of the 16 MiB envelope
 * (server/src/pg.ts bodyLimit), leaving headroom for content text and SQL.
 */
export const MAX_OUTPUT_TOTAL_DATA_URL_BYTES = 8 * 1024 * 1024;
/** Bounded re-encode attempts before the best (smallest) attempt ships as-is. */
const OUTPUT_REENCODE_MAX_ATTEMPTS = 12;

function dataUrlToBytes(dataUrl: string): Uint8Array {
	const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * Re-encode one image down to `targetBytes` decoded bytes: decode the data
 * URL, then encode JPEG at a shrinking scale until it fits (JPEG size tracks
 * area, so each step aims straight at the scale that should fit) or the
 * attempt bound is hit — the result is never a rejection.
 */
async function reencodeOutputImage(
	image: ImagePart,
	targetBytes: number,
	ops: ImageIntakeOps
): Promise<ImagePart> {
	const bitmap = await ops.decode(dataUrlToBytes(image.data));
	try {
		// Same yield as intake (spec SC-007): finalize of several images must not
		// serialize into one long main-thread task.
		await new Promise((resolve) => setTimeout(resolve, 0));
		let scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
		let width = 1;
		let height = 1;
		let data = '';
		let bytes = 0;
		for (let attempt = 0; attempt < OUTPUT_REENCODE_MAX_ATTEMPTS; attempt++) {
			width = Math.max(1, Math.round(bitmap.width * scale));
			height = Math.max(1, Math.round(bitmap.height * scale));
			const blob = await ops.encodeJpeg(bitmap, width, height);
			const encoded = new Uint8Array(await blob.arrayBuffer());
			data = bytesToDataUrl(encoded, 'image/jpeg');
			bytes = encoded.byteLength;
			if (bytes <= targetBytes) break;
			scale = Math.min(scale, scale * Math.sqrt(targetBytes / bytes));
		}
		return imagePart(data, 'image/jpeg', width, height, bytes, image.name);
	} finally {
		bitmap.close();
	}
}

/**
 * Apply the output-side budget to the images of one assistant row before
 * finalize (030 contracts/stream-image-parts.md §3). In-budget images pass
 * through untouched (byte-identical); anything over the per-image cap — or
 * pushing the row past the per-message total — is re-encoded down via the
 * existing canvas pipeline, never rejected. Earlier images keep their bytes;
 * later ones absorb the squeeze when the total binds.
 */
export async function applyOutputBudget(
	images: ImagePart[],
	ops: ImageIntakeOps = browserOps
): Promise<ImagePart[]> {
	const kept: ImagePart[] = [];
	let remaining = MAX_OUTPUT_TOTAL_DATA_URL_BYTES;
	for (const image of images) {
		if (image.bytes <= MAX_OUTPUT_IMAGE_BYTES && image.data.length <= remaining) {
			remaining -= image.data.length;
			kept.push(image);
			continue;
		}
		// Base64 expands ~4/3, so the decoded target is 3/4 of what's left; at
		// least 0 so a drained budget still yields a (tiny) best-effort image.
		const target = Math.min(MAX_OUTPUT_IMAGE_BYTES, Math.floor((Math.max(remaining, 0) * 3) / 4));
		const rebuilt = await reencodeOutputImage(image, target, ops);
		remaining -= rebuilt.data.length;
		kept.push(rebuilt);
	}
	return kept;
}

/**
 * Convert one recognized stream-image candidate (030) into a finished
 * ImagePart. Width/height come from a best-effort decode probe (0×0 when no
 * bitmap decoder is available, e.g. node tests); URL-only candidates return
 * null — T009 fetches them through the keychain/proxy path first.
 */
export async function candidateToImagePart(
	candidate: ImageCandidate,
	ops: ImageIntakeOps = browserOps
): Promise<ImagePart | null> {
	if (candidate.base64 === undefined) return null;
	const bytes = dataUrlToBytes(`data:;base64,${candidate.base64}`);
	const mime = candidate.mediaType ?? sniffImageMime(bytes) ?? 'image/png';
	let width = 0;
	let height = 0;
	try {
		const bitmap = await ops.decode(bytes);
		width = bitmap.width;
		height = bitmap.height;
		bitmap.close();
	} catch {
		/* dimension probe is best-effort */
	}
	return imagePart(
		`data:${mime};base64,${candidate.base64}`,
		mime,
		width,
		height,
		bytes.byteLength
	);
}

/**
 * Bounded fetch timeout for remote-URL image candidates (030 R-4). Generated
 * images are multi-MB downloads through the server proxy; 15 s matches the
 * model-discovery bound (model-discovery.ts) without pinning finalize for long.
 */
export const IMAGE_FETCH_TIMEOUT_MS = 15_000;

/**
 * Byte cap on remote-URL image materialization (032): `fetchImageCandidate`
 * reads via a streaming reader and bails (null) once the body exceeds this,
 * so an oversized or hostile link can never balloon the tab's heap. Well above
 * legitimate generated images (request-side ceiling is 16 MiB) and below the
 * relay's 64 MiB response cap.
 */
export const IMAGE_FETCH_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Materialize one remote-URL image candidate (030 R-4) by fetching its bytes
 * through the provider fetch (keychain auth + server proxy apply) and
 * returning a ready `{ mediaType, base64 }` candidate — display never depends
 * on the live link. The caller passes the provider's fetch; tests inject a
 * stub. Returns null when the link is un-fetchable (network error, non-2xx,
 * truncated body, body over IMAGE_FETCH_MAX_BYTES, non-image payload) — never
 * throws — so the caller can render a contained inline notice instead of a
 * broken frame or a dropped message.
 */
export async function fetchImageCandidate(
	url: string,
	mediaType: string | undefined,
	fetchImpl: typeof fetch = globalThis.fetch
): Promise<ImageCandidate | null> {
	try {
		const res = await fetchImpl(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
		if (!res.ok) return null;
		// Bounded read (032): accumulate chunks and stop (null) past the cap so a
		// huge body is never fully buffered; plain arrayBuffer only when the
		// runtime exposes no stream, with the same length check.
		let bytes: Uint8Array;
		if (res.body) {
			const reader = res.body.getReader();
			const chunks: Uint8Array[] = [];
			let total = 0;
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value) continue;
				total += value.byteLength;
				if (total > IMAGE_FETCH_MAX_BYTES) {
					reader.cancel().catch(() => {});
					return null;
				}
				chunks.push(value);
			}
			bytes = new Uint8Array(total);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
		} else {
			const buffer = await res.arrayBuffer();
			if (buffer.byteLength > IMAGE_FETCH_MAX_BYTES) return null;
			bytes = new Uint8Array(buffer);
		}
		const declared = res.headers.get('content-type')?.split(';')[0]?.trim() || mediaType || null;
		const mime = resolveMime(sniffImageMime(bytes), declared);
		if (!mime) return null;
		const dataUrl = bytesToDataUrl(bytes, mime);
		return { mediaType: mime, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
	} catch {
		return null;
	}
}
