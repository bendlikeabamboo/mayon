import { authState } from '$lib/auth/state.svelte';

export class ServerClient {
	async http(path: string, init?: RequestInit): Promise<Response> {
		const res = await fetch(path, init);
		if (res.status === 401 && !path.startsWith('/api/auth/')) {
			authState.resetSession();
		}
		return res;
	}

	ws(): WebSocket {
		return new WebSocket('/ws/mcp');
	}
}

export const serverClient = new ServerClient();
