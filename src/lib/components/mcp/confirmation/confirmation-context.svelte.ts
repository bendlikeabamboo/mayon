import { getContext, setContext } from 'svelte';

export type ApprovalState = 'pending' | 'succeeded' | 'rejected' | 'failed';

const CONFIRMATION_CONTEXT_KEY = Symbol('confirmation-context');

export interface ApprovalStateMachine {
	state: ApprovalState;
	succeed(): void;
	reject(): void;
	fail(): void;
	onAction: (() => void) | null;
}

export function createApprovalStateMachine(): ApprovalStateMachine {
	let _state = $state<ApprovalState>('pending');
	return {
		get state() {
			return _state;
		},
		succeed() {
			if (_state !== 'pending') return;
			_state = 'succeeded';
			this.onAction?.();
		},
		reject() {
			if (_state !== 'pending') return;
			_state = 'rejected';
			this.onAction?.();
		},
		fail() {
			if (_state !== 'pending') return;
			_state = 'failed';
			this.onAction?.();
		},
		onAction: null
	};
}

export type ConfirmationContextValue = ApprovalStateMachine;

export function setConfirmationContext(value: ConfirmationContextValue) {
	setContext(CONFIRMATION_CONTEXT_KEY, value);
}

export function getConfirmationContext(): ConfirmationContextValue {
	const context = getContext<ConfirmationContextValue>(CONFIRMATION_CONTEXT_KEY);
	if (!context) {
		throw new Error('Confirmation components must be used within Confirmation');
	}
	return context;
}
