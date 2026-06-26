<script lang="ts">
	import ProviderConfig from '$lib/components/ai/ProviderConfig.svelte';
	import LabPromptConfig from '$lib/components/labs/LabPromptConfig.svelte';
	import QuizPromptConfig from '$lib/components/quizzes/QuizPromptConfig.svelte';
	import LearnerProfileConfig from '$lib/components/chat/LearnerProfileConfig.svelte';
</script>

<ProviderConfig>
	<LearnerProfileConfig />
	<LabPromptConfig />
	<QuizPromptConfig />
</ProviderConfig>
