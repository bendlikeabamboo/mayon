import { describe, it, expect } from 'vitest';
import { createApprovalStateMachine, type ApprovalState } from './confirmation-context.svelte';

describe('ApprovalStateMachine', () => {
	function make() {
		const sm = createApprovalStateMachine();
		return sm;
	}

	it('starts in pending', () => {
		const sm = make();
		expect(sm.state).toBe<ApprovalState>('pending');
	});

	it('pending → succeeded', () => {
		const sm = make();
		let dispatched = false;
		sm.onAction = () => {
			dispatched = true;
		};
		sm.succeed();
		expect(sm.state).toBe('succeeded');
		expect(dispatched).toBe(true);
	});

	it('pending → rejected', () => {
		const sm = make();
		let dispatched = false;
		sm.onAction = () => {
			dispatched = true;
		};
		sm.reject();
		expect(sm.state).toBe('rejected');
		expect(dispatched).toBe(true);
	});

	it('pending → failed', () => {
		const sm = make();
		let dispatched = false;
		sm.onAction = () => {
			dispatched = true;
		};
		sm.fail();
		expect(sm.state).toBe('failed');
		expect(dispatched).toBe(true);
	});

	it('succeeded is terminal — re-acting is no-op', () => {
		const sm = make();
		sm.succeed();
		let dispatched = false;
		sm.onAction = () => {
			dispatched = true;
		};
		sm.succeed();
		sm.reject();
		sm.fail();
		expect(sm.state).toBe('succeeded');
		expect(dispatched).toBe(false);
	});

	it('rejected is terminal — re-acting is no-op', () => {
		const sm = make();
		sm.reject();
		let dispatched = false;
		sm.onAction = () => {
			dispatched = true;
		};
		sm.succeed();
		sm.reject();
		sm.fail();
		expect(sm.state).toBe('rejected');
		expect(dispatched).toBe(false);
	});

	it('failed is terminal — re-acting is no-op', () => {
		const sm = make();
		sm.fail();
		let dispatched = false;
		sm.onAction = () => {
			dispatched = true;
		};
		sm.succeed();
		sm.reject();
		sm.fail();
		expect(sm.state).toBe('failed');
		expect(dispatched).toBe(false);
	});

	it('failed settles (never perpetual pending)', () => {
		const sm = make();
		sm.fail();
		expect(['succeeded', 'rejected', 'failed'] as const).toContain(sm.state);
		expect(sm.state).not.toBe('pending');
	});

	it('onAction is not called when transitioning from one settled state to another', () => {
		const sm = make();
		sm.succeed();
		sm.onAction = () => {
			throw new Error('should not dispatch');
		};
		sm.reject();
		expect(sm.state).toBe('succeeded');
	});

	it('failed is dismissible — renders via ConfirmationFailed', () => {
		const sm = make();
		sm.fail();
		expect(sm.state).toBe('failed');
		expect(() => sm.succeed()).not.toThrow();
		expect(() => sm.reject()).not.toThrow();
		expect(() => sm.fail()).not.toThrow();
		expect(sm.state).toBe('failed');
	});

	it('fail() settles — never perpetual pending (AP-5)', () => {
		const sm = make();
		expect(sm.state).toBe('pending');
		sm.fail();
		expect(sm.state).not.toBe('pending');
		expect(['succeeded', 'rejected', 'failed'] as const).toContain(sm.state);
	});

	it('fail dispatches onAction exactly once', () => {
		const sm = make();
		let count = 0;
		sm.onAction = () => {
			count++;
		};
		sm.fail();
		expect(count).toBe(1);
		sm.fail();
		sm.succeed();
		expect(count).toBe(1);
	});
});
