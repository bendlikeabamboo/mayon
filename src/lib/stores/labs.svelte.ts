/**
 * Labs store (architecture.md §7, P3).
 *
 * A runes-class singleton mirroring `chat.svelte.ts`. Owns the lab-list view
 * state (`list`), the lab-runner view state (`current`), the generation flow
 * (`generate`), and the interactive checklist (`toggleItem`).
 *
 * Generation flow:
 *   `generate(chatId)` → assemble context → active provider.generateLab →
 *   persist via `labsRepo.create` → return id for navigation. On
 *   `LabGenerationError` (model output never parsed after retries), sets
 *   `rawOffer` so the route can offer "save raw anyway" (nothing is lost).
 *
 * Abort + error handling mirror `chatStore.send`: `AbortError` is swallowed;
 * transport errors go through `formatProviderError` into `error`.
 */
import { browser } from '$app/environment';
import { repos } from '$lib/db';
import type { Lab } from '$lib/db/schema';
import { assembleContext } from '$lib/chat/context';
import { getActiveSdkProvider } from '$lib/ai/client';
import { formatProviderError, type FormattedProviderError } from '$lib/ai/errors';
import { generateLab, LabGenerationError } from '$lib/ai/generate/generate';
import { toLabContent } from '$lib/ai/generate/lab';
import { buildObjectTrace, type ObjectTraceInput } from '$lib/agent/trace';

function isAbortError(err: unknown): boolean {
	return err instanceof DOMException && err.name === 'AbortError';
}

class LabsState {
	list = $state<Lab[]>([]);
	current = $state<Lab | null>(null);
	generating = $state(false);
	loading = $state(false);
	error = $state<FormattedProviderError | null>(null);
	/** Set when generation produced unparseable raw text; the route offers to
	 *  save it as a lab with an empty checklist. Cleared on next generate/save. */
	rawOffer = $state<{ chatId: string; raw: string } | null>(null);

	private controller: AbortController | null = null;

	/** Load all labs (newest first) for the `/lab` index page. */
	async loadList(): Promise<void> {
		if (!browser) return;
		this.loading = true;
		try {
			this.list = await repos.labs.listAll();
		} finally {
			this.loading = false;
		}
	}

	/** Load a single lab into `current` for the `/lab/[id]` runner. */
	async loadLab(id: string): Promise<void> {
		if (!browser) return;
		this.loading = true;
		this.error = null;
		try {
			this.current = await repos.labs.getById(id);
		} catch (err) {
			this.current = null;
			this.error = {
				title: 'Could not load lab',
				message: err instanceof Error ? err.message : String(err)
			};
		} finally {
			this.loading = false;
		}
	}

	/**
	 * Generate a lab from `chatId`'s context and persist it. Returns the new
	 * lab id (caller navigates to `/lab/<id>`), or null if it failed without
	 * producing a lab (in which case `error` or `rawOffer` is set).
	 *
	 * On `LabGenerationError`, sets `rawOffer` (caller decides whether to save
	 * raw). On other errors, sets `error` via `formatProviderError`. Aborts are
	 * swallowed silently (matching `chatStore.send`).
	 */
	async generate(chatId: string): Promise<string | null> {
		if (this.generating) return null;
		this.generating = true;
		this.error = null;
		this.rawOffer = null;
		this.controller = new AbortController();

		let traceInput: ObjectTraceInput | null = null;
		let createdLabId: string | undefined;
		const startTime = Date.now();

		try {
			const [ctx, { model, config }] = await Promise.all([
				assembleContext(chatId),
				getActiveSdkProvider()
			]);
			const generated = await generateLab(model, ctx, {
				signal: this.controller.signal,
				onTrace: (t) => {
					traceInput = {
						kind: 'lab',
						request: t.request,
						result: t.result,
						error: t.error,
						raw: t.raw
					};
				}
			});
			const { title, content, checklist } = toLabContent(generated);
			const lab = await repos.labs.create({
				chatId,
				title,
				content,
				checklist,
				model: config.defaultModel
			});
			createdLabId = lab.id;
			this.list = [lab, ...this.list];
			return lab.id;
		} catch (err) {
			if (isAbortError(err)) return null;
			if (err instanceof LabGenerationError) {
				this.rawOffer = { chatId, raw: err.raw };
				return null;
			}
			this.error = formatProviderError(err);
			return null;
		} finally {
			this.generating = false;
			this.controller = null;
			if (traceInput) {
				try {
					const { config } = await getActiveSdkProvider();
					await repos.agentTraces.create({
						id: '',
						createdAt: startTime,
						chatId,
						kind: 'lab',
						labId: createdLabId,
						model: '',
						configKind: config.kind,
						reasoning: '',
						durationMs: Date.now() - startTime,
						trace: buildObjectTrace(traceInput)
					});
				} catch {
					/* best-effort; never surfaces */
				}
			}
		}
	}

	/** Save unparseable raw model text as a lab with an empty checklist. */
	async saveRaw(chatId: string, raw: string): Promise<string | null> {
		try {
			const lab = await repos.labs.create({
				chatId,
				title: deriveRawTitle(raw),
				content: raw,
				checklist: []
			});
			this.list = [lab, ...this.list];
			this.rawOffer = null;
			return lab.id;
		} catch (err) {
			this.error = {
				title: 'Could not save lab',
				message: err instanceof Error ? err.message : String(err)
			};
			return null;
		}
	}

	/**
	 * Optimistically flip a checklist item in `current`, then persist. If the
	 * persist fails, the optimistic flip is reverted so the UI never lies.
	 */
	async toggleItem(labId: string, itemId: string): Promise<void> {
		const lab = this.current;
		if (!lab || lab.id !== labId) return;
		const items = repos.labs.parseChecklist(lab.checklist);
		const next = items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i));
		// Optimistic update: reflect immediately, keep the previous list for revert.
		const prevChecklist = lab.checklist;
		this.current = { ...lab, checklist: JSON.stringify(next) };
		try {
			const persisted = await repos.labs.toggleChecklistItem(labId, itemId);
			if (persisted) {
				this.current = { ...this.current, checklist: JSON.stringify(persisted) };
			}
		} catch (err) {
			// Revert on failure.
			this.current = { ...this.current, checklist: prevChecklist };
			this.error = {
				title: 'Could not update checklist',
				message: err instanceof Error ? err.message : String(err)
			};
		}
	}

	/** Stop an in-flight generation (AbortError is swallowed in `generate`). */
	stop(): void {
		this.controller?.abort();
	}

	/** Clear `rawOffer` without saving (route "dismiss"). */
	dismissRawOffer(): void {
		this.rawOffer = null;
	}
}

/** Best-effort title for a raw lab: first non-empty, non-fence line, truncated. */
function deriveRawTitle(raw: string): string {
	const firstLine = raw
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l.length > 0 && !l.startsWith('```'));
	if (!firstLine) return 'Untitled lab';
	const cleaned = firstLine.replace(/^#+\s*/, '').replace(/[*_`]/g, '');
	return cleaned.length > 80 ? cleaned.slice(0, 77) + '…' : cleaned;
}

/** Singleton — the single labs view across the app. */
export const labsStore = new LabsState();
