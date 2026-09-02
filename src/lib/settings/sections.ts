import type { ServerCap } from '@mayon/shared';

export interface SectionEntry {
	id: string;
	label: string;
	aliases: string[];
	cap: ServerCap | null;
}

export const SETTINGS_SECTIONS: readonly SectionEntry[] = [
	{ id: 'providers', label: 'Providers', aliases: [], cap: null },
	{ id: 'mcp', label: 'MCP Servers', aliases: [], cap: null },
	{ id: 'chat', label: 'Chat', aliases: ['strip', 'outline', 'display'], cap: null },
	{ id: 'learner-profile', label: 'Learner profile', aliases: [], cap: null },
	{ id: 'expound-instructions', label: 'Expound Instructions', aliases: [], cap: null },
	{ id: 'lab-prompt', label: 'Lab generation prompt', aliases: [], cap: null },
	{ id: 'quiz-prompt', label: 'Quiz generation prompt', aliases: [], cap: null },
	{
		id: 'security',
		label: 'Security',
		aliases: ['lock', 'login', 'password', 'auth', 'mfa', 'totp'],
		cap: null
	},
	{ id: 'data', label: 'Data', aliases: ['backup', 'restore', 'export', 'import'], cap: null },
	{ id: 'sandbox-db', label: 'Sandbox DB', aliases: ['sandbox', 'sqlite'], cap: 'sandbox-db' }
];

export function visibleSections(
	sections: readonly SectionEntry[],
	caps: readonly ServerCap[]
): SectionEntry[] {
	return sections.filter((section) => section.cap === null || caps.includes(section.cap));
}

export function matchSections(query: string, sections: readonly SectionEntry[]): SectionEntry[] {
	const tokens = query
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter((token) => token.length > 0);
	if (tokens.length === 0) return [...sections];
	return sections.filter((section) => {
		const haystack = `${section.label} ${section.aliases.join(' ')}`.toLowerCase();
		return tokens.every((token) => haystack.includes(token));
	});
}
