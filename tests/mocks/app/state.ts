// Minimal `$app/state` double for route-level browser tests.
// See specs/032-test-suite-tiering/research.md R4.

export interface PageState {
	url: URL;
	params: Record<string, string>;
	route: { id: string | null };
	status: number;
	error: null;
	data: Record<string, unknown>;
	state: Record<string, unknown>;
	form: null;
}

export const page: PageState = {
	url: new URL('http://localhost/'),
	params: {},
	route: { id: null },
	status: 200,
	error: null,
	data: {},
	state: {},
	form: null
};
