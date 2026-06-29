import katex from 'katex';

export interface CriticIssue {
	type: 'mermaid' | 'code' | 'katex' | 'admonition';
	message: string;
	locator?: string;
}

export async function validateTurn(markdown: string): Promise<CriticIssue[]> {
	const issues: CriticIssue[] = [];
	issues.push(...(await validateMermaid(markdown)));
	issues.push(...validateCode(markdown));
	issues.push(...validateKatex(markdown));
	issues.push(...validateAdmonitions(markdown));
	return issues;
}

async function validateMermaid(text: string): Promise<CriticIssue[]> {
	const issues: CriticIssue[] = [];
	const fenceRe = /```mermaid\n([\s\S]*?)```/g;
	let match: RegExpExecArray | null;
	while ((match = fenceRe.exec(text)) !== null) {
		const source = match[1];
		try {
			const mod = await import('mermaid');
			const api = mod.default;
			await api.parse(source);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			const start = match.index;
			const lineNum = text.slice(0, start).split('\n').length;
			issues.push({
				type: 'mermaid',
				message: msg,
				locator: `line ${lineNum}`
			});
		}
	}
	return issues;
}

function validateCode(text: string): CriticIssue[] {
	const count = (text.match(/```/g) ?? []).length;
	if (count % 2 !== 0) {
		return [
			{
				type: 'code',
				message: 'unterminated code fence (odd number of ``` markers)'
			}
		];
	}
	return [];
}

function validateKatex(text: string): CriticIssue[] {
	const issues: CriticIssue[] = [];

	const blockRe = /\$\$([\s\S]*?)\$\$/g;
	let match: RegExpExecArray | null;
	while ((match = blockRe.exec(text)) !== null) {
		try {
			katex.renderToString(match[1], { throwOnError: true, displayMode: true });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			const start = match.index;
			const lineNum = text.slice(0, start).split('\n').length;
			issues.push({ type: 'katex', message: msg, locator: `line ${lineNum}` });
		}
	}

	const inlineRe = /(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g;
	while ((match = inlineRe.exec(text)) !== null) {
		try {
			katex.renderToString(match[1], { throwOnError: true, displayMode: false });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			const start = match.index;
			const lineNum = text.slice(0, start).split('\n').length;
			issues.push({ type: 'katex', message: msg, locator: `line ${lineNum}` });
		}
	}

	return issues;
}

function validateAdmonitions(text: string): CriticIssue[] {
	const issues: CriticIssue[] = [];
	const re = /^>\s*\[(![^\]]*)\]/gm;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		const inner = match[1];
		const typeToken = inner.slice(1).trim();
		if (!typeToken) {
			const lineNum = text.slice(0, match.index).split('\n').length;
			issues.push({
				type: 'admonition',
				message: `malformed admonition: empty type token`,
				locator: `line ${lineNum}`
			});
		}
	}
	return issues;
}
