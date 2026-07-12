<script lang="ts">
	import ProviderConfig from '$lib/components/ai/ProviderConfig.svelte';
	import McpServers from '$lib/components/mcp/McpServers.svelte';
	import LabPromptConfig from '$lib/components/labs/LabPromptConfig.svelte';
	import QuizPromptConfig from '$lib/components/quizzes/QuizPromptConfig.svelte';
	import LearnerProfileConfig from '$lib/components/chat/LearnerProfileConfig.svelte';
	import DataSection from '$lib/components/settings/DataSection.svelte';
	import SandboxDbSection from '$lib/components/settings/SandboxDbSection.svelte';
	import { serverStatus } from '$lib/server/status.svelte';
</script>

<ProviderConfig>
	<McpServers />
	<LearnerProfileConfig />
	<LabPromptConfig />
	<QuizPromptConfig />
	<DataSection />
	{#if serverStatus.has('sandbox-db')}
		<SandboxDbSection />
	{/if}
</ProviderConfig>
