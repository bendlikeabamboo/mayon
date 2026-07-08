import type { McpServerTemplate } from './types';

export const MCP_SERVER_TEMPLATES: McpServerTemplate[] = [
	{
		label: 'Brave Search',
		description:
			'Web search via the Brave Search MCP server (stdio). Exposes brave_web_search and brave_local_search.',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-brave-search'],
		env: { BRAVE_API_KEY: { secretRef: '' } },
		requiresTrust: true,
		discoverableTools: 'web search, local search'
	},
	{
		label: 'Filesystem',
		description: 'Local filesystem access via the MCP filesystem server (stdio).',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
		env: {},
		requiresTrust: true
	},
	{
		label: 'Fetch',
		description: 'HTTP fetch via the MCP fetch server (stdio).',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-fetch'],
		env: {},
		requiresTrust: true
	},
	{
		label: 'GitHub',
		description:
			'GitHub API access via the MCP GitHub server (stdio). Requires GITHUB_PERSONAL_ACCESS_TOKEN.',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-github'],
		env: { GITHUB_PERSONAL_ACCESS_TOKEN: { secretRef: '' } },
		requiresTrust: true
	},
	{
		label: 'Custom stdio',
		description: 'Add a custom stdio MCP server by specifying the command and arguments.',
		transport: 'stdio',
		command: '',
		args: [],
		env: {},
		requiresTrust: true
	},
	{
		label: 'Custom HTTP',
		description:
			'Add a custom HTTP MCP server (streamable-HTTP, 2025-06-18) by specifying the URL and any headers.',
		transport: 'http',
		url: '',
		headers: {},
		requiresTrust: true
	}
];

export function findMcpTemplate(label: string): McpServerTemplate | undefined {
	return MCP_SERVER_TEMPLATES.find((t) => t.label === label);
}
