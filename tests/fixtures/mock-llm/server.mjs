#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { BRIEF_FIXTURE } from './brief-fixture.mjs';
import { LAB_FIXTURE } from './lab-fixture.mjs';
import {
	BRIEF_MARKER,
	GRADING_MARKER,
	LAB_CONTRACT_OPENING,
	QUIZ_CONTRACT_OPENING
} from './markers.mjs';
import { QUIZ_FIXTURE } from './quiz-fixture.mjs';

const PORT = Number(process.env.MOCK_LLM_PORT ?? 9999);
const MODEL_ID = 'mock-sink';
const CHUNK_INTERVAL_MS = 150;
const BLOCKS_PER_CHUNK = 3;

// ---------------------------------------------------------------------------
// Request-kind classification markers live in ./markers.mjs (single source of
// truth; the drift-guard unit test
// src/lib/ai/generate/classification-markers.test.ts keeps them pinned to the
// product constants).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Grading lever (short_grading kind) — fixed, deterministic constants. The
// verdict shape mirrors GradedAnswerSchema (src/lib/ai/generate/quiz.ts):
// { isCorrect, feedback }. Trigger precedence: when BOTH triggers appear in
// the scanned text, 'should be wrong' wins — a false verdict is the
// fail-unsafe direction (research.md D3: an unmarked or ambiguous answer can
// never fake a green score).
// ---------------------------------------------------------------------------
const LEVER_TRIGGER_CORRECT = 'should be correct';
const LEVER_TRIGGER_WRONG = 'should be wrong';
const LEVER_FEEDBACK_CORRECT =
	'Deterministic mock verdict: the lever matched, so this answer is graded correct.';
const LEVER_FEEDBACK_WRONG =
	'Deterministic mock verdict: the lever matched, so this answer is graded incorrect.';
const LEVER_FEEDBACK_DEFAULT =
	'Deterministic mock default: the answer carried no lever trigger, so it is not correct.';

// ---------------------------------------------------------------------------
// Back-propagation dispatch (feature 027, quickstart V6) — deterministic
// constants, same pattern as the grading lever: fixture-only triggers with no
// product-constant pin, so they live here instead of markers.mjs (the
// drift-guard only pins markers that mirror product constants). Mirrored for
// spec assertions in tests/e2e/fixtures/kitchen-sink.ts.
// ---------------------------------------------------------------------------
const PROPAGATE_TRIGGER = 'backpropagate this branch';
const PROPAGATE_TOOL_NAME = 'propagate_to_parent';
const PROPAGATE_TOOL_ARGS = '{"mode":"raw"}';
const PROPAGATE_UNAVAILABLE_REPLY =
	'This conversation is a root chat, so it cannot back-propagate; use the manual back-propagate control in the message menu instead.';
// Offer-once dispatch (027 US2): a completion signal without an explicit
// request gets one plain-text offer (manual-control fallback + an explicit
// ask) and never a tool call — propagation requires the learner's agreement.
const OFFER_TRIGGER = 'this branch feels done';
const OFFER_REPLY =
	'This branch looks wrapped up. I can send its outcome to the parent chat — the manual back-propagate control in the message menu does the same thing. Want me to back-propagate it?';

// Interleaved reasoning script (feature 029): marker-triggered plain chat
// stream exercising reasoning/text interleaving on the openai-compatible wire
// (delta.reasoning_content). Frame order: reasoning burst, content, reasoning
// burst AGAIN after text (forces a segment re-open), content, then a final
// reasoning delta with no trailing content. Spec: specs/029-micro-thoughts/
// contracts/mock-llm-reasoning.md. Fixture-only trigger (no product-constant
// pin, so not in markers.mjs). Case-sensitive, exact token.
const INTERLEAVED_MARKER = '[[interleaved-thoughts]]';

// How many leading characters of the classification inputs the unknown-kind
// 400 body and server log expose as hints.
const HINT_PREFIX_LENGTH = 80;

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kitchen-sink.md');
const doc = readFileSync(fixturePath, 'utf8');

const blocks = doc
	.split(/\n\n+/)
	.map((block) => block.trim())
	.filter(Boolean);
const chunks = [];
for (let i = 0; i < blocks.length; i += BLOCKS_PER_CHUNK) {
	const group = blocks.slice(i, i + BLOCKS_PER_CHUNK).join('\n\n');
	// Preserve the document's block separator across chunk boundaries — the
	// consumer concatenates deltas verbatim, so a dropped separator here would
	// silently corrupt the reply (blocks would run together).
	chunks.push(i + BLOCKS_PER_CHUNK < blocks.length ? group + '\n\n' : group);
}
const plainProse = blocks.find((block) => !block.startsWith('#')) ?? doc;

let counter = 0;
const nextId = () => `mock-${++counter}`;

function sendJson(res, status, body) {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (chunk) => {
			data += chunk;
		});
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
}

function sseFrame(payload) {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

function streamFrames(res, frames, terminal) {
	res.writeHead(200, {
		'content-type': 'text/event-stream',
		'cache-control': 'no-cache',
		connection: 'keep-alive'
	});
	res.on('error', () => {});
	let index = 0;
	const writeNext = () => {
		if (res.destroyed) {
			res.end();
			return;
		}
		if (index < frames.length) {
			res.write(frames[index++]);
			setTimeout(writeNext, CHUNK_INTERVAL_MS);
			return;
		}
		res.write(terminal);
		res.write('data: [DONE]\n\n');
		res.end();
	};
	writeNext();
}

const stopTerminal = (id, model, reason) =>
	sseFrame({
		id,
		model,
		choices: [{ delta: {}, finish_reason: reason }],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
	});

function streamReply(res, id, model) {
	const frames = [
		sseFrame({ id, model, choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }),
		...chunks.map(
			(content) => sseFrame({ id, model, choices: [{ delta: { content }, finish_reason: null }] })
		)
	];
	streamFrames(res, frames, stopTerminal(id, model, 'stop'));
}

// Streamed plain-text reply (two frames, stop terminal) for the 027 text kinds.
function streamTextReply(res, id, model, text) {
	const frames = [
		sseFrame({ id, model, choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }),
		sseFrame({ id, model, choices: [{ delta: { content: text }, finish_reason: null }] })
	];
	streamFrames(res, frames, stopTerminal(id, model, 'stop'));
}

// Streamed interleaved reply (feature 029): reasoning_content deltas sharing
// the normal SSE envelope, ordered so reasoning both precedes AND follows
// content — the post-text re-open is the segmentation defect case — ending on
// a trailing reasoning delta with no content after it. Stop terminal + [DONE]
// unchanged.
function streamInterleavedReply(res, id, model) {
	const reasoning = (text) =>
		sseFrame({ id, model, choices: [{ delta: { reasoning_content: text }, finish_reason: null }] });
	const content = (text) =>
		sseFrame({ id, model, choices: [{ delta: { content: text }, finish_reason: null }] });
	const frames = [
		sseFrame({ id, model, choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }),
		reasoning(' considering the question…'),
		reasoning(' it is a simple arithmetic sum…'),
		content('Sure — '),
		content('2 + 2 = 4.'),
		reasoning(' double-checking after answering…'),
		reasoning(' the sum holds under recheck…'),
		content(' That stays '),
		content('4.'),
		reasoning(' done thinking.')
	];
	streamFrames(res, frames, stopTerminal(id, model, 'stop'));
}

// Streamed tool-call reply for propagate_tool_call (feature 027): OpenAI-style
// streamed tool_call deltas that the SDK's OpenAI-compatible provider
// accumulates into one tool call; finish_reason 'tool_calls' (the SDK maps it
// to 'tool-calls') routes the agent loop into the tool path. Raw mode keeps
// the e2e single-process: the tool's deterministic delta needs no LLM sub-call.
function streamToolCallReply(res, id, model, toolName, argsJson) {
	const frames = [
		sseFrame({ id, model, choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }),
		sseFrame({
			id,
			model,
			choices: [
				{
					delta: {
						tool_calls: [
							{
								index: 0,
								id: 'call-prop',
								type: 'function',
								function: { name: toolName, arguments: argsJson }
							}
						]
					},
					finish_reason: null
				}
			]
		})
	];
	streamFrames(res, frames, stopTerminal(id, model, 'tool_calls'));
}

// ---------------------------------------------------------------------------
// Request-kind classification (stateless — a pure function of the request
// body, safe under concurrency; no shared mutable state beyond the static
// fixture library). Ordered, first match wins:
//
//   1. no tools  + stream === true  → chat (SSE kitchen-sink stream), or
//      chat_interleaved (029) when the LAST user message carries the exact
//      marker [[interleaved-thoughts]]
//   2. no tools  + stream !== true  → chat (single non-streamed completion)
//   3. tools + stream === true + trigger in LAST user message:
//      - offer trigger → propagate_offer (plain-text single offer; 027 US2)
//      - propagate trigger + tools contain propagate_to_parent →
//        propagate_tool_call (streamed tool call; 027)
//      - propagate trigger otherwise → propagate_unavailable
//        (manual-control sentence; 027)
//   4. tools + `json` tool description contains GRADING_MARKER → short_grading
//   5. tools + first system message STARTS WITH the quiz contract opening → quiz_generation
//   6. tools + first system message STARTS WITH the lab contract opening  → lab_generation
//   7. tools + first system message contains BRIEF_MARKER (fallback, last) → brief_generation
//   8. anything else → unknown (HTTP 400, never a wrong-fixture reply)
//
// Rule 3 anchors on the LAST message being role 'user': after the tool
// executes and approves, the loop's NEXT iteration re-requests with the tool
// result as the last message (role 'tool'), so neither trigger rule matches
// and the continuation falls through to the plain kitchen-sink chat stream.
//
// Rules 4 and 5 anchor on startsWith because quiz and lab generation lead the
// system message with their code-owned contract (includeSystemNotes: false) —
// user custom instructions are appended after it and can never flip the
// match. Rule 6 is an includes-fallback: brief generation (learning-brief
// dialog) uses the GENERIC `json` tool and prepends context system notes to
// DEFAULT_BRIEF_PROMPT, so its marker cannot be anchored — it is checked LAST
// and after the anchored kinds, which keeps user text from shadowing lab/quiz.
// All markers are verified unique across the code-owned constants (the
// drift-guard unit test pins every byte).
// ---------------------------------------------------------------------------

/** Flatten message content (string or OpenAI-style text parts) to plain text. */
function messageText(content) {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.map((part) =>
				part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''
			)
			.join('\n');
	}
	return '';
}

function hasTools(body) {
	return Array.isArray(body?.tools) && body.tools.length > 0;
}

/** Description of the `json` result tool, or null when the request has none. */
function jsonToolDescription(body) {
	const tools = Array.isArray(body?.tools) ? body.tools : [];
	const json = tools.find((t) => t && typeof t === 'object' && t.function?.name === 'json');
	const description = json?.function?.description;
	return typeof description === 'string' ? description : null;
}

/** Whether the request's tools array declares a function with the given name. */
function hasToolNamed(body, name) {
	const tools = Array.isArray(body?.tools) ? body.tools : [];
	return tools.some((t) => t && typeof t === 'object' && t.function?.name === name);
}

/** Text of the LAST user message ('' when the request has none). */
function lastUserText(body) {
	const messages = Array.isArray(body?.messages) ? body.messages : [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m && typeof m === 'object' && m.role === 'user') return messageText(m.content);
	}
	return '';
}

/** Text of the FIRST system message ('' when the request has none). */
function firstSystemText(body) {
	const messages = Array.isArray(body?.messages) ? body.messages : [];
	const system = messages.find((m) => m && typeof m === 'object' && m.role === 'system');
	return system ? messageText(system.content) : '';
}

	function classifyRequest(body) {
		if (!hasTools(body)) {
			// 029 interleaved script: marker in the LAST user message flips the
			// streamed plain chat into the reasoning-interleaved reply. Exact,
			// case-sensitive token; only on the stream path (non-streamed
			// requests keep chat_plain unchanged).
			if (body?.stream === true && lastUserText(body).includes(INTERLEAVED_MARKER)) {
				return 'chat_interleaved';
			}
			return body?.stream === true ? 'chat_stream' : 'chat_plain';
		}
		// Chat turns from the second one on carry the standard tool set (the
		// agent loop enables tools after the first turn). A tools-bearing
		// STREAM request is still a chat: answer with the text-only SSE stream
		// and never call tools — except the 027 propagate dispatch below,
		// which must win over this catch-all. Non-streamed tools requests
		// keep the fail-loudly contract kinds below (research.md D7).
		if (body?.stream === true) {
			// Propagate dispatch (027): the LAST message must be role 'user' and
			// carry a trigger; the branch-gated tool list (present only when
			// the chat is a branch with own messages — FR-001/V4) picks
			// tool-call vs manual-control sentence. Anchoring on the last
			// MESSAGE (not the last user message) is what makes the ordering
			// safe: after the tool executes, the continuation request ends on
			// the role-'tool' result, so this rule cannot re-fire and the turn
			// falls through to the kitchen-sink chat stream below.
			// Case-insensitive to match the grading lever's scan.
			const messages = Array.isArray(body?.messages) ? body.messages : [];
			const last = messages[messages.length - 1];
			const lastText =
				last && typeof last === 'object' && last.role === 'user'
					? messageText(last.content).toLowerCase()
					: null;
			if (lastText !== null) {
				// Offer-once rule first: a completion signal is never an
				// agreement, so it must answer with the plain offer, never a
				// tool call (027 US2).
				if (lastText.includes(OFFER_TRIGGER)) return 'propagate_offer';
				if (lastText.includes(PROPAGATE_TRIGGER)) {
					return hasToolNamed(body, PROPAGATE_TOOL_NAME)
						? 'propagate_tool_call'
						: 'propagate_unavailable';
				}
			}
			return 'chat_stream';
		}
		const toolDescription = jsonToolDescription(body);
	if (toolDescription !== null && toolDescription.includes(GRADING_MARKER)) {
		return 'short_grading';
	}
	const systemText = firstSystemText(body);
	// startsWith anchoring: the contract byte-leads the system message for
	// quiz and lab (includeSystemNotes: false), so appended user instructions
	// can never influence these matches (FR-002).
	if (systemText.startsWith(QUIZ_CONTRACT_OPENING)) return 'quiz_generation';
	if (systemText.startsWith(LAB_CONTRACT_OPENING)) return 'lab_generation';
	// Brief fallback last: its system message prepends context notes before
	// DEFAULT_BRIEF_PROMPT, so the marker cannot be anchored; after rules 4-5
	// the only requests reaching here with the brief opening ARE briefs.
	if (systemText.includes(BRIEF_MARKER)) return 'brief_generation';
	return 'unknown';
}

/**
 * Grading lever: scan the LAST user message's content case-insensitively for
 * the trigger phrases. The grading user block (gradeUserBlock in
 * src/lib/ai/generate/generate-quiz.ts) ends with the learner's verbatim
 * answer text, so the answer wording selects the branch. Applies only to
 * short_grading requests — answer text never influences other kinds.
 */
function gradeAnswer(body) {
	const text = lastUserText(body).toLowerCase();
	// Precedence: 'should be wrong' is tested FIRST so it wins when both
	// triggers are present (fail-unsafe; see the constants block above).
	if (text.includes(LEVER_TRIGGER_WRONG)) {
		return { isCorrect: false, feedback: LEVER_FEEDBACK_WRONG };
	}
	if (text.includes(LEVER_TRIGGER_CORRECT)) {
		return { isCorrect: true, feedback: LEVER_FEEDBACK_CORRECT };
	}
	return { isCorrect: false, feedback: LEVER_FEEDBACK_DEFAULT };
}

/**
 * Tool-call reply for quiz_generation / lab_generation / short_grading
 * (research.md D2): a non-streamed OpenAI completion whose first choice calls
 * the `json` tool with the fixture payload stringified as the arguments.
 */
function sendToolCallReply(res, id, model, payload) {
	sendJson(res, 200, {
		id,
		model,
		choices: [
			{
				message: {
					role: 'assistant',
					content: null,
					tool_calls: [
						{
							id: `call-${id}`,
							type: 'function',
							function: { name: 'json', arguments: JSON.stringify(payload) }
						}
					]
				},
				finish_reason: 'tool_calls'
			}
		],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
	});
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
	if (req.method === 'GET' && url.pathname === '/v1/models') {
		sendJson(res, 200, { data: [{ id: MODEL_ID, object: 'model' }] });
		return;
	}
	if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
		let body;
		try {
			body = JSON.parse(await readBody(req));
		} catch {
			sendJson(res, 400, {
				error: { message: 'malformed JSON body', type: 'invalid_request_error' }
			});
			return;
		}
		const id = nextId();
		const kind = classifyRequest(body);
		console.log(`[mock-llm] ${req.method} ${url.pathname} -> ${kind}`);
		const model =
			typeof body.model === 'string' && body.model.length > 0 ? body.model : MODEL_ID;
		switch (classifyRequest(body)) {
			case 'chat_stream':
				streamReply(res, id, model);
				return;
			case 'chat_interleaved':
				streamInterleavedReply(res, id, model);
				return;
			case 'propagate_tool_call':
				streamToolCallReply(res, id, model, PROPAGATE_TOOL_NAME, PROPAGATE_TOOL_ARGS);
				return;
			case 'propagate_unavailable':
				streamTextReply(res, id, model, PROPAGATE_UNAVAILABLE_REPLY);
				return;
			case 'propagate_offer':
				streamTextReply(res, id, model, OFFER_REPLY);
				return;
			case 'chat_plain':
				sendJson(res, 200, {
					id,
					model,
					choices: [
						{ message: { role: 'assistant', content: plainProse }, finish_reason: 'stop' }
					],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
				});
				return;
			case 'quiz_generation':
				sendToolCallReply(res, id, model, QUIZ_FIXTURE);
				return;
			case 'lab_generation':
				sendToolCallReply(res, id, model, LAB_FIXTURE);
				return;
			case 'brief_generation':
				sendToolCallReply(res, id, model, BRIEF_FIXTURE);
				return;
			case 'short_grading':
				sendToolCallReply(res, id, model, gradeAnswer(body));
				return;
			default: {
				// Unknown kind: fail loudly (research.md D7) — never fall back to a
				// chat fixture for a tools-bearing request, or a future fourth kind
				// would silently receive the wrong fixture (false-green).
				const toolDescriptionPrefix = (jsonToolDescription(body) ?? '').slice(
					0,
					HINT_PREFIX_LENGTH
				);
				const systemPrefix = firstSystemText(body).slice(0, HINT_PREFIX_LENGTH);
				const hints = [hasTools(body), toolDescriptionPrefix, systemPrefix];
				console.error(
					`[mock-llm] unrecognized request kind: ${JSON.stringify({ hints })}`
				);
				sendJson(res, 400, { error: 'unrecognized request kind', hints });
				return;
			}
		}
	}
	sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
	console.log(`mock-llm listening on port ${PORT}`);
});
