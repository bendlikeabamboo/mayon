<script lang="ts">
	import { toastState } from '$lib/stores/toasts.svelte';

	function dismiss(id: string) {
		toastState.dismiss(id);
	}
</script>

<div class="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col-reverse gap-2">
	{#each toastState.toasts as toast (toast.id)}
		<div
			class="pointer-events-auto flex w-80 items-start gap-3 rounded-lg border border-border bg-background p-4 shadow-lg"
		>
			<div class="min-w-0 flex-1">
				<p class="text-sm font-medium">{toast.title}</p>
				{#if toast.description}
					<p class="mt-1 text-sm text-muted-foreground">{toast.description}</p>
				{/if}
				{#if toast.action}
					<a
						href={toast.action.href}
						class="mt-2 inline-block text-sm text-primary underline hover:no-underline"
					>
						{toast.action.label}
					</a>
				{/if}
			</div>
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground"
				aria-label="Dismiss"
				onclick={() => dismiss(toast.id)}
			>
				×
			</button>
		</div>
	{/each}
</div>
