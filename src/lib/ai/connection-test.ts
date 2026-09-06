/**
 * Explicit "Test connection" probe (feature 021): one key pre-check, one
 * discovery attempt through the shared transport, and — for opaque browser
 * network failures — one credential-free `no-cors` reachability probe that
 * disambiguates "server not running" from "cross-origin blocked". Runs only on
 * explicit user action (never in the background — FR-015) and never mutates
 * stored state; failures come back classified with coached copy shaped like
 * `FormattedProviderError` so the status line renders them unchanged.
 */
import { hasProviderKey, kindRequiresKey } from './client';
import { classifyFetchError, formatProviderError, SERVER_REQUIRED_HINT } from './errors';
import { isLoopbackUrl } from './llm-target';
import { discoverModels } from './model-discovery';
import { PROVIDER_TEMPLATES } from './registry';
import {
	CorsBlockedError,
	MissingKeyError,
	NetworkError,
	ProviderHttpError,
	RateLimitError,
	TimeoutError,
	type ProviderConfig
} from './types';

export type ConnectionFailureClass =
	| 'key-missing'
	| 'not-running'
	| 'cors-blocked'
	| 'insecure-blocked'
	| 'timeout'
	| 'auth'
	| 'not-found'
	| 'rate-limited'
	| 'http';

/** Classified outcome of a failed test; mirrors `FormattedProviderError` plus
 *  optional HTTP status / upstream body. */
export interface ConnectionTestFailure {
	class: ConnectionFailureClass;
	title: string;
	message: string;
	hint?: string;
	status?: number;
	detail?: string;
}

export interface ConnectionTestResult {
	ok: boolean;
	/** Discovered model IDs (sorted, de-duplicated) when `ok`. */
	models?: string[];
	failure?: ConnectionTestFailure;
}

export interface ConnectionTestOptions {
	/** Probe 1 deadline in ms (default 8 s). Chat/streaming paths are unchanged. */
	timeoutMs?: number;
}

/**
 * Test a provider endpoint: fail fast when a required key is missing (no
 * network), otherwise fetch `<baseUrl>/models` via the existing discovery path
 * under a deadline. Failures are classified through the shared error vocabulary
 * (`classifyFetchError` / `httpStatusToError`); opaque network failures are
 * further probed with a credential-free `no-cors` fetch of the base URL: it
 * resolving (opaque) means a server is listening but the browser cannot read
 * the exchange (cross-origin); it rejecting means nothing answered (not
 * running).
 */
export async function testProviderConnection(
	config: ProviderConfig,
	opts?: ConnectionTestOptions
): Promise<ConnectionTestResult> {
	const timeoutMs = opts?.timeoutMs ?? 8_000;
	if (kindRequiresKey(config) && !(await hasProviderKey(config.id))) {
		return fail('key-missing', 'API key required', 'Add an API key below, then test again.');
	}

	try {
		const models = await discoverModels(
			config,
			{ hasKey: hasProviderKey },
			AbortSignal.timeout(timeoutMs)
		);
		return { ok: true, models };
	} catch (err) {
		return classify(err, config, timeoutMs);
	}
}

async function classify(
	err: unknown,
	config: ProviderConfig,
	timeoutMs: number
): Promise<ConnectionTestResult> {
	if (err instanceof MissingKeyError) {
		return fail('key-missing', 'API key required', 'Add an API key below, then test again.');
	}
	if (err instanceof RateLimitError) {
		return {
			ok: false,
			failure: { class: 'rate-limited', status: 429, ...formatProviderError(err) }
		};
	}
	if (err instanceof ProviderHttpError) {
		if (err.status === 401 || err.status === 403) {
			return fail(
				'auth',
				'Authentication failed',
				'The endpoint rejected the credentials. Check the API key for this provider.'
			);
		}
		if (err.status === 404) {
			return fail(
				'not-found',
				'Endpoint not found',
				`The server answered, but ${config.baseUrl}/models does not exist. Check the base URL (OpenAI-compatible servers usually end in \`/v1\`).`
			);
		}
		return {
			ok: false,
			failure: {
				class: 'http',
				title: `Server error (${err.status})`,
				message: err.message,
				status: err.status,
				detail: err.body
			}
		};
	}

	// Opaque network-level failure (typed by the transport, or a raw throw):
	// classify the raw underlying error so a deadline hiding as `cause` isn't
	// mistaken for a dead server, then disambiguate via the no-cors probe.
	const raw =
		err instanceof NetworkError || err instanceof CorsBlockedError ? (err.cause ?? err) : err;
	const mapped = classifyFetchError(raw, config.baseUrl);
	if (mapped instanceof TimeoutError || mapped instanceof DOMException) {
		return fail(
			'timeout',
			'No response in time',
			`${config.baseUrl} did not respond within ${Math.round(timeoutMs / 1000)} s. Check the host and port, and whether the server is under load.`
		);
	}
	return probeReachability(config, timeoutMs);
}

/** Probe 2: a no-cors fetch reads no data and sends no credentials; it only
 *  answers "is anything listening?" — resolves (opaque) ⇒ a server is listening
 *  but the browser cannot read the exchange (cross-origin); rejects ⇒ nothing
 *  answered (not running). */
async function probeReachability(
	config: ProviderConfig,
	timeoutMs: number
): Promise<ConnectionTestResult> {
	if (isInsecureTarget(config.baseUrl)) {
		return fail(
			'insecure-blocked',
			'Request blocked as insecure',
			'This browser refuses plain-HTTP requests from a secure page. Serve Mayon over HTTP, or expose your runtime over HTTPS.'
		);
	}
	try {
		await fetch(config.baseUrl, { mode: 'no-cors', signal: AbortSignal.timeout(timeoutMs) });
	} catch {
		return fail(
			'not-running',
			'Server not running',
			`Nothing is listening at ${config.baseUrl}. Start LM Studio / vLLM (or check the host and port) and test again.`
		);
	}
	if (isLoopbackUrl(config.baseUrl)) {
		return {
			ok: false,
			failure: {
				class: 'cors-blocked',
				title: 'Blocked before Mayon could read the reply',
				message: 'The server answered, but the browser blocked the exchange (cross-origin).',
				hint: localCorsHint(config)
			}
		};
	}
	return {
		ok: false,
		failure: {
			class: 'cors-blocked',
			title: 'Blocked before Mayon could read the reply',
			message:
				'The server answered, but the browser blocked the exchange (cross-origin). Enable CORS on the server and test again.',
			hint: SERVER_REQUIRED_HINT
		}
	};
}

/** Row 5: the page is HTTPS but the target is plain HTTP — the browser blocks
 *  the request as mixed content before any exchange can happen. */
function isInsecureTarget(baseUrl: string): boolean {
	if (typeof globalThis.location === 'undefined' || globalThis.location.protocol !== 'https:') {
		return false;
	}
	try {
		return new URL(baseUrl, globalThis.location.href).protocol === 'http:';
	} catch {
		return false;
	}
}

/** Row 4: loopback CORS coaching, picked by template match on kind + base URL. */
function localCorsHint(config: ProviderConfig): string {
	const baseUrl = config.baseUrl.replace(/\/+$/, '');
	const template = PROVIDER_TEMPLATES.find(
		(t) => t.kind === config.kind && t.baseUrl.replace(/\/+$/, '') === baseUrl
	);
	if (template?.label === 'LM Studio (local)') {
		return "Enable CORS in LM Studio's Developer settings, or start it with `lms server start --cors`, then test again.";
	}
	if (template?.label === 'vLLM (local)') {
		return "Start vLLM with `--allowed-origins` including Mayon's origin, then test again.";
	}
	return "Check your runtime's CORS/cross-origin setting.";
}

function fail(
	class_: ConnectionFailureClass,
	title: string,
	message: string
): ConnectionTestResult {
	return { ok: false, failure: { class: class_, title, message } };
}
