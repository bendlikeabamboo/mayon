// Pure SPA: render only in the browser (no SSR for a local-first app).
// adapter-static emits a single index.html fallback that handles client routing.
export const ssr = false;
export const prerender = false;
