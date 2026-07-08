import type { McpClient } from './client';
import type { McpServerConfig } from './types';

export interface ElicitationRequest {
	requestId: string;
	serverName: string;
	schema: Record<string, unknown>;
	message?: string;
}

export type ElicitationOutcome =
	| { accepted: true; data: Record<string, unknown> }
	| { accepted: false; declined: true };

export interface ElicitationCallbacks {
	requestElicitation: (req: ElicitationRequest) => Promise<ElicitationOutcome>;
}

export function registerElicitationHandler(
	client: McpClient,
	config: McpServerConfig,
	callbacks: ElicitationCallbacks
): void {
	client.registerRequestHandler('elicitation/create', async (_id, params) => {
		if (!config.allowElicitation) {
			return { error: { code: -32603, message: 'elicitation declined' } };
		}

		const p = params as
			| {
					message?: string;
					requestedSchema: Record<string, unknown>;
			  }
			| undefined;

		const schema = p?.requestedSchema ?? {};
		const message = p?.message ?? 'Server requests input';

		const outcome = await callbacks.requestElicitation({
			requestId: `mcp-elicitation-${config.id}`,
			serverName: config.name,
			schema,
			message
		});

		if (!outcome.accepted) {
			return {
				result: {
					action: 'declined'
				}
			};
		}

		return {
			result: {
				action: 'accept',
				content: {
					type: 'text',
					text: JSON.stringify(outcome.data)
				}
			}
		};
	});
}
