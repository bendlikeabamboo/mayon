export interface SseFrame {
	data?: string;
}

export function parseSseFrames(chunk: string): SseFrame[] {
	const frames: SseFrame[] = [];
	let current: SseFrame = {};
	let hasEvent = false;

	for (const line of chunk.split('\n')) {
		const trimmed = line.trim();
		if (trimmed === '') {
			if ('data' in current || hasEvent) {
				frames.push(current);
				current = {};
				hasEvent = false;
			}
			continue;
		}
		if (trimmed.startsWith('data:')) {
			const value = trimmed.slice(5).trimStart();
			if (current.data === undefined) {
				current.data = value;
			} else {
				current.data += '\n' + value;
			}
		}
		if (trimmed.startsWith('event:')) {
			hasEvent = true;
		}
	}

	if ('data' in current || hasEvent) {
		frames.push(current);
	}

	return frames;
}
