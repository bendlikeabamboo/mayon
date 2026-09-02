import { describe, expect, it } from 'vitest';
import { DWELL_MS, dwellTransition, initialDwellState, type DwellState } from './dwell';

const rest = initialDwellState();

const armedOn = (index: number): DwellState =>
	dwellTransition(rest, { kind: 'enter-bar', index }).state;

const openOn = (index: number): DwellState =>
	dwellTransition(armedOn(index), { kind: 'dwell-fire', index }).state;

describe('dwellTransition', () => {
	it('arms a 400 ms timer on enter-bar from rest without opening the preview', () => {
		const result = dwellTransition(rest, { kind: 'enter-bar', index: 2 });
		expect(DWELL_MS).toBe(400);
		expect(result.armTimerMs).toBe(DWELL_MS);
		expect(result.state).toEqual({ hoveredIndex: 2, previewIndex: null });
		expect(result.openPreview).toBeNull();
		expect(result.closePreview).toBe(false);
	});

	it('opens the preview on dwell-fire while the pointer is still on the hovered bar', () => {
		const result = dwellTransition(armedOn(1), { kind: 'dwell-fire', index: 1 });
		expect(result.openPreview).toBe(1);
		expect(result.state.previewIndex).toBe(1);
		expect(result.state.hoveredIndex).toBe(1);
		expect(result.armTimerMs).toBeNull();
	});

	it('ignores a stale dwell-fire for a bar other than the hovered one', () => {
		const result = dwellTransition(armedOn(1), { kind: 'dwell-fire', index: 4 });
		expect(result.openPreview).toBeNull();
		expect(result.state).toEqual({ hoveredIndex: 1, previewIndex: null });
	});

	it('leave-bar cancels the timer and closes any open preview (sweep immunity)', () => {
		const fromArmed = dwellTransition(armedOn(1), { kind: 'leave-bar' });
		expect(fromArmed.armTimerMs).toBeNull();
		expect(fromArmed.closePreview).toBe(false);
		expect(fromArmed.state).toEqual({ hoveredIndex: null, previewIndex: null });

		const fromOpen = dwellTransition(openOn(1), { kind: 'leave-bar' });
		expect(fromOpen.armTimerMs).toBeNull();
		expect(fromOpen.closePreview).toBe(true);
		expect(fromOpen.state.previewIndex).toBeNull();
		expect(fromOpen.state.hoveredIndex).toBeNull();
	});

	it('enter-other-bar cancels the previous timer, closes the previous preview, and arms anew', () => {
		const result = dwellTransition(openOn(1), { kind: 'enter-other-bar', index: 3 });
		expect(result.armTimerMs).toBe(DWELL_MS);
		expect(result.closePreview).toBe(true);
		expect(result.openPreview).toBeNull();
		expect(result.state).toEqual({ hoveredIndex: 3, previewIndex: null });
	});

	it('leave-strip cancels and closes immediately', () => {
		const result = dwellTransition(openOn(2), { kind: 'leave-strip' });
		expect(result.armTimerMs).toBeNull();
		expect(result.closePreview).toBe(true);
		expect(result.openPreview).toBeNull();
		expect(result.state).toEqual({ hoveredIndex: null, previewIndex: null });
	});

	it('re-entering after a leave re-arms from scratch', () => {
		const left = dwellTransition(openOn(2), { kind: 'leave-strip' }).state;
		const reentered = dwellTransition(left, { kind: 'enter-bar', index: 0 });
		expect(reentered.armTimerMs).toBe(DWELL_MS);
		expect(reentered.state.previewIndex).toBeNull();
		const fired = dwellTransition(reentered.state, { kind: 'dwell-fire', index: 0 });
		expect(fired.openPreview).toBe(0);
	});

	it('enter-bar on the bar whose preview is open stays open without re-arming', () => {
		const result = dwellTransition(openOn(1), { kind: 'enter-bar', index: 1 });
		expect(result.state.previewIndex).toBe(1);
		expect(result.armTimerMs).toBeNull();
		expect(result.closePreview).toBe(false);
		expect(result.openPreview).toBeNull();
	});

	it('never holds more than one open preview at a time', () => {
		const moved = dwellTransition(openOn(1), {
			kind: 'enter-other-bar',
			index: 3
		}).state;
		expect(moved.previewIndex).toBeNull();
		const reopened = dwellTransition(moved, { kind: 'dwell-fire', index: 3 });
		expect(reopened.openPreview).toBe(3);
		expect(reopened.state.previewIndex).toBe(3);
	});

	it('does not mutate the input state (pure transition)', () => {
		const state = openOn(1);
		const snapshot = { ...state };
		dwellTransition(state, { kind: 'leave-strip' });
		expect(state).toEqual(snapshot);
	});
});
