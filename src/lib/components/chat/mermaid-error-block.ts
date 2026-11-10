import { buildMermaidFixPrompt } from '#lib/markdown/mermaid-repair.js';

/**
 * Contained fallback block for a failed mermaid render (spec 028 US1,
 * rebuilt by feature 036): plain-language notice, the FULL failure text
 * (`name: message`) always visible in a `pre.mermaid-error-reason`
 * (pre-wrap class hook — CSS lives in Markdown.svelte), and the diagram
 * source collapsed behind a `<details>`. The fix affordance renders only
 * when a handler was passed (spec 028 US3) — no handler (labs, quizzes,
 * user messages, tool results, live) ⇒ no button at all. Everything stays
 * inside this block — no page-level side effects, no inline parser dump.
 */
export function buildMermaidErrorBlock(
	source: string,
	err: unknown,
	onFix?: (prompt: string) => void
): HTMLElement {
	const reasonText = err instanceof Error ? [err.name, err.message].join(': ') : String(err);

	const block = document.createElement('div');
	block.className = 'mermaid-error';

	const notice = document.createElement('p');
	notice.className = 'mermaid-error-notice';
	notice.textContent = "This diagram couldn't be rendered";
	block.appendChild(notice);

	const reason = document.createElement('pre');
	reason.className = 'mermaid-error-reason';
	const reasonCode = document.createElement('code');
	reasonCode.textContent = reasonText;
	reason.appendChild(reasonCode);
	block.appendChild(reason);

	const sourceDetails = document.createElement('details');
	const summary = document.createElement('summary');
	summary.textContent = 'Diagram source';
	const sourcePre = document.createElement('pre');
	const sourceCode = document.createElement('code');
	sourceCode.textContent = source;
	sourcePre.appendChild(sourceCode);
	sourceDetails.appendChild(summary);
	sourceDetails.appendChild(sourcePre);
	block.appendChild(sourceDetails);

	if (onFix) {
		const fixBtn = document.createElement('button');
		fixBtn.className = 'mermaid-fix-btn';
		fixBtn.type = 'button';
		fixBtn.textContent = 'Fix this diagram';
		fixBtn.addEventListener('click', () => {
			onFix(buildMermaidFixPrompt(source, reasonText));
		});
		block.appendChild(fixBtn);
	}

	return block;
}
