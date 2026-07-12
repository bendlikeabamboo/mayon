export class ServerClient {
	http(path: string, init?: RequestInit) {
		return fetch(path, init);
	}

	ws(): WebSocket {
		return new WebSocket('/ws/mcp');
	}
}

export const serverClient = new ServerClient();
