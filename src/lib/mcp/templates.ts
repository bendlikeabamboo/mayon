import type { McpServerTemplate } from './types';

export const MCP_SERVER_TEMPLATES: McpServerTemplate[] = [
	{
		label: 'Brave Search',
		description:
			'Web search via the official Brave Search MCP server (stdio). Exposes brave_web_search, brave_local_search, brave_image_search, brave_video_search, brave_news_search, and more. Requires the Mayon sidecar.',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'],
		env: { BRAVE_API_KEY: { secretRef: '' } },
		requiresTrust: true,
		discoverableTools:
			'web search, local search, image search, video search, news search, summarizer, place search',
		platforms: ['desktop']
	},
	{
		label: 'Brave Search (HTTP)',
		description:
			'Web search via the Smithery-hosted Brave Search MCP server (HTTP). Works in the browser and desktop. Append your Brave API key as a query parameter: ?braveApiKey=YOUR_KEY',
		transport: 'http',
		url: 'https://server.smithery.ai/brave/mcp',
		headers: {},
		requiresTrust: true,
		discoverableTools:
			'web search, local search, image search, video search, news search, summarizer, place search',
		platforms: ['web', 'desktop']
	},
	{
		label: 'Filesystem',
		description:
			'Local filesystem access via the MCP filesystem server (stdio). Requires the Mayon sidecar.',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
		env: {},
		requiresTrust: true,
		platforms: ['desktop']
	},
	{
		label: 'Fetch',
		description: 'HTTP fetch via the MCP fetch server (stdio). Requires the Mayon sidecar.',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-fetch'],
		env: {},
		requiresTrust: true,
		platforms: ['desktop']
	},
	{
		label: 'GitHub',
		description:
			'GitHub API access via the MCP GitHub server (stdio). Requires GITHUB_PERSONAL_ACCESS_TOKEN. Requires the Mayon sidecar.',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-github'],
		env: { GITHUB_PERSONAL_ACCESS_TOKEN: { secretRef: '' } },
		requiresTrust: true,
		platforms: ['desktop']
	},
	{
		label: 'Custom stdio',
		description:
			'Add a custom stdio MCP server by specifying the command and arguments. Requires the Mayon sidecar.',
		transport: 'stdio',
		command: '',
		args: [],
		env: {},
		requiresTrust: true,
		platforms: ['desktop']
	},
	{
		label: 'Custom HTTP',
		description:
			'Add a custom HTTP MCP server (streamable-HTTP, 2025-06-18) by specifying the URL and any headers.',
		transport: 'http',
		url: '',
		headers: {},
		requiresTrust: true,
		platforms: ['web', 'desktop']
	}
];

export function findMcpTemplate(label: string): McpServerTemplate | undefined {
	return MCP_SERVER_TEMPLATES.find((t) => t.label === label);
}
