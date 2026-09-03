import { getContext, setContext } from 'svelte';
import type { Section } from '$lib/markdown/sections';

export interface StripAnchor {
	msgId: string;
	el: HTMLElement;
	sections: Section[];
}

export class StripRegistry {
	// Plain backing store, deliberately NOT $state: rows call
	// register/unregister/bump from $effect bodies and cleanups (a
	// read-modify-write of the array in one tick), and the gutter reads the
	// same array from template blocks. A reactive array made Svelte 5 throw
	// state_unsafe_mutation and re-run those effects against their own writes —
	// a flush storm that pinned the main thread for tens of seconds.
	private items: StripAnchor[] = [];

	/**
	 * Monotonic invalidation counter. Consumers (the page-level gutter) read
	 * this to re-derive from `entries`; writers never read it — the increment
	 * comes from a plain counter and lands as a pure assignment, so no effect
	 * ever tracks the signal it writes.
	 */
	version = $state(0);
	private counter = 0;

	get entries(): StripAnchor[] {
		return this.items;
	}

	register(anchor: StripAnchor): void {
		const index = this.items.findIndex((entry) => entry.msgId === anchor.msgId);
		if (index === -1) {
			this.items.push(anchor);
		} else {
			this.items[index] = anchor;
		}
		this.touch();
	}

	unregister(msgId: string): void {
		const index = this.items.findIndex((entry) => entry.msgId === msgId);
		if (index !== -1) {
			this.items.splice(index, 1);
			this.touch();
		}
	}

	// Membership is unchanged; swapping the entry reference plus the version
	// bump invalidates derived consumers so a resized reply re-measures without
	// re-registering.
	bump(msgId: string): void {
		const index = this.items.findIndex((entry) => entry.msgId === msgId);
		if (index === -1) return;
		this.items[index] = { ...this.items[index] };
		this.touch();
	}

	private touch(): void {
		this.counter++;
		this.version = this.counter;
	}
}

export interface StripContextValue {
	registry: StripRegistry;
	stripEnabled: boolean;
}

const STRIP_REGISTRY_KEY = Symbol('strip-registry');

export function setStripContext(value: StripContextValue): void {
	setContext(STRIP_REGISTRY_KEY, value);
}

export function getStripRegistry(): StripRegistry | null {
	const context = getContext<StripContextValue | undefined>(STRIP_REGISTRY_KEY);
	return context?.registry ?? null;
}

// Context API reads are init-only in Svelte 5, so consumers capture the value
// object once and read its (getter-backed, reactive) flag inside $derived.
export function getStripContext(): StripContextValue | null {
	const context = getContext<StripContextValue | undefined>(STRIP_REGISTRY_KEY);
	return context ?? null;
}

export function getStripPrefFromContext(): boolean {
	const context = getContext<StripContextValue | undefined>(STRIP_REGISTRY_KEY);
	return context?.stripEnabled ?? false;
}
