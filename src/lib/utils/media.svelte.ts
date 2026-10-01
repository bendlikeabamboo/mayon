export function mediaQuery(query: string): { matches: boolean } {
	const state = $state({ matches: window.matchMedia(query).matches });

	$effect(() => {
		const mql = window.matchMedia(query);
		const onChange = (e: MediaQueryListEvent) => {
			state.matches = e.matches;
		};
		mql.addEventListener('change', onChange);
		return () => mql.removeEventListener('change', onChange);
	});

	return state;
}
