export const DWELL_MS = 400;

export interface DwellState {
	hoveredIndex: number | null;
	previewIndex: number | null;
}

export type DwellInput =
	| { kind: 'enter-bar'; index: number; now: number }
	| { kind: 'leave-bar'; now: number }
	| { kind: 'enter-other-bar'; index: number; now: number }
	| { kind: 'leave-strip'; now: number }
	| { kind: 'dwell-fire'; index: number; now: number };

export interface DwellResult {
	state: DwellState;
	armTimerMs: number | null;
	openPreview: number | null;
	closePreview: boolean;
}

export function initialDwellState(): DwellState {
	return { hoveredIndex: null, previewIndex: null };
}

// 'dwell-fire' models the armed timer expiring: the component schedules it via
// setTimeout with the armed index; the transition ignores stale fires.
export function dwellTransition(state: DwellState, input: DwellInput): DwellResult {
	switch (input.kind) {
		case 'enter-bar':
		case 'enter-other-bar': {
			const { index } = input;
			if (state.hoveredIndex === index && state.previewIndex === index) {
				return { state, armTimerMs: null, openPreview: null, closePreview: false };
			}
			return {
				state: { hoveredIndex: index, previewIndex: null },
				armTimerMs: DWELL_MS,
				openPreview: null,
				closePreview: state.previewIndex !== null
			};
		}
		case 'leave-bar':
		case 'leave-strip':
			return {
				state: initialDwellState(),
				armTimerMs: null,
				openPreview: null,
				closePreview: state.previewIndex !== null
			};
		case 'dwell-fire': {
			if (state.hoveredIndex !== input.index || state.previewIndex === input.index) {
				return { state, armTimerMs: null, openPreview: null, closePreview: false };
			}
			return {
				state: { ...state, previewIndex: input.index },
				armTimerMs: null,
				openPreview: input.index,
				closePreview: false
			};
		}
	}
}
