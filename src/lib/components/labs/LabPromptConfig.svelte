<script lang="ts">
	import GenerationPromptConfig from '$lib/components/generation/GenerationPromptConfig.svelte';
	import { LAB_CONTRACT } from '$lib/ai/generate/generate';

	/**
	 * Lab surface of the shared generation-prompt settings panel. All behavior
	 * lives in GenerationPromptConfig — do not add lab-specific behavior here.
	 */
</script>

<GenerationPromptConfig
	contract={LAB_CONTRACT}
	settingsKey="labInstructions"
	title="Lab generation prompt"
	noun="lab"
/>
