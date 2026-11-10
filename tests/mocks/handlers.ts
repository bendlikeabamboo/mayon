// Shared MSW handlers for Tier 1 (setupServer) and Tier 2 (setupWorker).
// Paths are regexes so the same handler matches browser-origin requests and
// absolute Node requests without assuming a test host.
// See specs/032-test-suite-tiering/research.md R5.

import type { AuthSessionResponse, CopilotTokenResponse, LlmProxyRequest } from '@mayon/shared';
import { http, HttpResponse } from 'msw';

const AUTH_SESSION = /\/api\/auth\/session$/;
const LLM_PROXY = /\/api\/llm\/proxy$/;
const COPILOT_TOKEN = /\/api\/llm\/copilot\/token$/;
const MODEL_LIST = /\/models$/;

const authSession: AuthSessionResponse = {
	mode: 'locked',
	setupRequired: false,
	authenticated: true,
	identity: { label: 'test-owner', role: 'owner' },
	session: { expiresAt: Number.MAX_SAFE_INTEGER }
};

const modelList = {
	object: 'list',
	data: [
		{ id: 'mock-model', object: 'model', context_length: 8192 },
		{ id: 'mock-reasoning-model', object: 'model', context_length: 32768 }
	]
};

function chatCompletion(stream: boolean): Response {
	if (stream) {
		const chunk = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
		const body = [
			chunk({
				id: 'chatcmpl-mock',
				object: 'chat.completion.chunk',
				created: 0,
				model: 'mock-model',
				choices: [{ index: 0, delta: { role: 'assistant', content: 'Mock response' } }]
			}),
			chunk({
				id: 'chatcmpl-mock',
				object: 'chat.completion.chunk',
				created: 0,
				model: 'mock-model',
				choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
			}),
			'data: [DONE]\n\n'
		].join('');
		return HttpResponse.text(body, { headers: { 'content-type': 'text/event-stream' } });
	}

	return HttpResponse.json({
		id: 'chatcmpl-mock',
		object: 'chat.completion',
		created: 0,
		model: 'mock-model',
		choices: [
			{
				index: 0,
				message: { role: 'assistant', content: 'Mock response' },
				finish_reason: 'stop'
			}
		],
		usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
	});
}

export const handlers = [
	http.get(AUTH_SESSION, () => HttpResponse.json(authSession)),
	http.post(AUTH_SESSION, () => HttpResponse.json(authSession)),

	http.get(MODEL_LIST, () => HttpResponse.json(modelList)),

	http.post(LLM_PROXY, async ({ request }) => {
		let proxy: LlmProxyRequest;
		try {
			proxy = (await request.json()) as LlmProxyRequest;
		} catch {
			return HttpResponse.json({ error: 'invalid proxy body' }, { status: 400 });
		}

		let target: URL;
		try {
			target = new URL(proxy.url, 'http://localhost');
		} catch {
			return HttpResponse.json({ error: 'invalid proxy url' }, { status: 400 });
		}
		if (target.pathname.endsWith('/models')) {
			return HttpResponse.json(modelList);
		}

		let stream = false;
		if (typeof proxy.body === 'string') {
			try {
				const parsed = JSON.parse(proxy.body) as { stream?: unknown };
				stream = parsed.stream === true;
			} catch {
				// non-JSON request body: answer with a plain completion
			}
		}
		return chatCompletion(stream);
	}),

	http.post(COPILOT_TOKEN, () => {
		const response: CopilotTokenResponse = {
			token: 'tid=mock;exp=999;',
			expiresAt: Number.MAX_SAFE_INTEGER,
			endpoint: 'https://api.mock-copilot.test',
			refreshInSeconds: 1500
		};
		return HttpResponse.json(response);
	})
];
