export class SidecarClient {
	http(path: string, init?: RequestInit) {
		return fetch(path, init);
	}

	ws(): WebSocket {
		return new WebSocket('/ws/mcp');
	}
}

export const sidecarClient = new SidecarClient();
