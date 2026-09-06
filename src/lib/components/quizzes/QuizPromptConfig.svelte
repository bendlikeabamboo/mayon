<script lang="ts">
	import GenerationPromptConfig from '$lib/components/generation/GenerationPromptConfig.svelte';
	import { QUIZ_CONTRACT } from '$lib/ai/generate/generate-quiz';

	/**
	 * Quiz surface of the shared generation-prompt settings panel. All behavior
	 * lives in GenerationPromptConfig — do not add quiz-specific behavior here.
	 */
</script>

<GenerationPromptConfig
	contract={QUIZ_CONTRACT}
	settingsKey="quizInstructions"
	title="Quiz generation prompt"
	noun="quiz"
/>
