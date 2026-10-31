// Sanctioned: app code touches the data tier only through the repository façade
// ('$lib/db' pre-kit-3, '#lib/db/index.js' since the SvelteKit 3 migration).
import { repos } from '$lib/db';
import { repos as reposViaLibSubpath } from '#lib/db/index.js';
