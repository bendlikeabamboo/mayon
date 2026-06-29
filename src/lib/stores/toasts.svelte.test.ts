import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toastState } from './toasts.svelte';

beforeEach(() => {
	vi.useFakeTimers();
	toastState.clear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('toastState', () => {
	it('push adds a toast and returns an id', () => {
		const id = toastState.push({ title: 'Test', description: 'hello' });
		expect(toastState.toasts).toHaveLength(1);
		expect(toastState.toasts[0].id).toBe(id);
		expect(toastState.toasts[0].title).toBe('Test');
		expect(toastState.toasts[0].description).toBe('hello');
	});

	it('auto-dismiss removes toast after 5000ms', () => {
		toastState.push({ title: 'Auto' });
		expect(toastState.toasts).toHaveLength(1);

		vi.advanceTimersByTime(4999);
		expect(toastState.toasts).toHaveLength(1);

		vi.advanceTimersByTime(1);
		expect(toastState.toasts).toHaveLength(0);
	});

	it('dismiss removes a specific toast and clears its timer', () => {
		const id1 = toastState.push({ title: 'First' });
		const id2 = toastState.push({ title: 'Second' });
		expect(toastState.toasts).toHaveLength(2);

		toastState.dismiss(id1);
		expect(toastState.toasts).toHaveLength(1);
		expect(toastState.toasts[0].id).toBe(id2);

		vi.advanceTimersByTime(5000);
		expect(toastState.toasts).toHaveLength(0);
	});

	it('dismiss of unknown id is a no-op', () => {
		toastState.push({ title: 'A' });
		toastState.dismiss('does-not-exist');
		expect(toastState.toasts).toHaveLength(1);
	});

	it('clear removes all toasts and cancels all timers', () => {
		toastState.push({ title: 'A' });
		toastState.push({ title: 'B' });
		expect(toastState.toasts).toHaveLength(2);

		toastState.clear();
		expect(toastState.toasts).toHaveLength(0);

		vi.advanceTimersByTime(10000);
		expect(toastState.toasts).toHaveLength(0);
	});
});
