// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { enhanceFocusable } from './focusable';

describe('enhanceFocusable', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('wraps a table in a focusable div and adds a button', () => {
		const container = document.createElement('div');
		container.innerHTML = '<table><tr><th>A</th></tr><tr><td>1</td></tr></table>';
		document.body.appendChild(container);

		const onExpand = vi.fn();
		enhanceFocusable(container, 'table', onExpand);

		const wrapper = container.querySelector('[data-focusable]');
		expect(wrapper).not.toBeNull();
		expect(wrapper?.tagName).toBe('DIV');

		const btn = wrapper?.querySelector('button.md-focusable-btn') as HTMLButtonElement;
		expect(btn).not.toBeNull();
		expect(btn.getAttribute('aria-label')).toBe('Expand');
		expect(btn.querySelector('svg')).not.toBeNull();

		const table = wrapper?.querySelector('table');
		expect(table).not.toBeNull();
	});

	it('fires onExpand with the original table node on button click', () => {
		const container = document.createElement('div');
		container.innerHTML = '<table><tr><th>A</th></tr></table>';
		document.body.appendChild(container);

		const onExpand = vi.fn();
		enhanceFocusable(container, 'table', onExpand);

		const btn = container.querySelector<HTMLButtonElement>('button.md-focusable-btn')!;
		btn.click();

		expect(onExpand).toHaveBeenCalledOnce();
		expect(onExpand).toHaveBeenCalledWith(expect.any(HTMLElement), 'Expand');
		expect(onExpand.mock.calls[0][0].tagName).toBe('TABLE');
	});

	it('does not double-wrap on a second call', () => {
		const container = document.createElement('div');
		container.innerHTML = '<table><tr><th>A</th></tr></table>';
		document.body.appendChild(container);

		enhanceFocusable(container, 'table', vi.fn());
		enhanceFocusable(container, 'table', vi.fn());

		expect(container.querySelectorAll('[data-focusable]').length).toBe(1);
		expect(container.querySelectorAll('table').length).toBe(1);
	});

	it('handles multiple tables independently', () => {
		const container = document.createElement('div');
		container.innerHTML =
			'<table id="t1"><tr><td>1</td></tr></table><p>text</p><table id="t2"><tr><td>2</td></tr></table>';
		document.body.appendChild(container);

		const onExpand = vi.fn();
		enhanceFocusable(container, 'table', onExpand);

		expect(container.querySelectorAll('[data-focusable]').length).toBe(2);
		expect(container.querySelectorAll('button.md-focusable-btn').length).toBe(2);

		const btns = container.querySelectorAll<HTMLButtonElement>('button.md-focusable-btn');
		btns[0].click();
		expect(onExpand.mock.calls[0][0].id).toBe('t1');
		btns[1].click();
		expect(onExpand.mock.calls[1][0].id).toBe('t2');
	});

	it('respects custom options', () => {
		const container = document.createElement('div');
		container.innerHTML = '<table><tr><td>x</td></tr></table>';
		document.body.appendChild(container);

		const onExpand = vi.fn();
		enhanceFocusable(container, 'table', onExpand, {
			maxHeight: '30vh',
			buttonLabel: 'View table'
		});

		const wrapper = container.querySelector('[data-focusable]') as HTMLElement;
		expect(wrapper.style.maxHeight).toBe('30vh');

		const btn = container.querySelector<HTMLButtonElement>('button.md-focusable-btn')!;
		expect(btn.getAttribute('aria-label')).toBe('View table');
		btn.click();
		expect(onExpand).toHaveBeenCalledWith(expect.any(HTMLElement), 'View table');
	});

	it('no-ops when selector matches nothing', () => {
		const container = document.createElement('div');
		container.innerHTML = '<p>no tables here</p>';
		document.body.appendChild(container);

		enhanceFocusable(container, 'table', vi.fn());
		expect(container.querySelector('[data-focusable]')).toBeNull();
	});
});
