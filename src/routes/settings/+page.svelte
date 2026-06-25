<script lang="ts">
	import ProviderConfig from '$lib/components/ai/ProviderConfig.svelte';
	import LabPromptConfig from '$lib/components/labs/LabPromptConfig.svelte';
	import QuizPromptConfig from '$lib/components/quizzes/QuizPromptConfig.svelte';
</script>

<ProviderConfig>
	<LabPromptConfig />
	<QuizPromptConfig />
</ProviderConfig>
