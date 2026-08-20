import type { EntryKind, Lane } from './kinds';
import type { TimelineItem, DurableEntry } from './entries';

export interface Presentation {
	lane: Lane;
	collapsible: boolean;
	collapsedByDefault: boolean;
	renderer: string;
}

export type PresentationKey =
	| EntryKind
	| 'tool_group'
	| 'tool_group_unpaired'
	| 'live_text'
	| 'live_reasoning'
	| 'live_ask';

const registry = new Map<PresentationKey, Presentation>([
	[
		'user_message',
		{
			lane: 'user',
			collapsible: false,
			collapsedByDefault: false,
			renderer: 'UserMessage'
		}
	],
	[
		'assistant_message',
		{
			lane: 'external',
			collapsible: true,
			collapsedByDefault: true,
			renderer: 'AssistantMessage'
		}
	],
	[
		'reasoning',
		{
			lane: 'internal',
			collapsible: true,
			collapsedByDefault: true,
			renderer: 'ReasoningEntry'
		}
	],
	[
		'tool_group',
		{
			lane: 'internal',
			collapsible: true,
			collapsedByDefault: true,
			renderer: 'ToolActivity'
		}
	],
	[
		'tool_group_unpaired',
		{
			lane: 'internal',
			collapsible: true,
			collapsedByDefault: true,
			renderer: 'ToolActivity'
		}
	],
	[
		'approval',
		{
			lane: 'internal',
			collapsible: true,
			collapsedByDefault: true,
			renderer: 'AskEntry'
		}
	],
	[
		'sampling',
		{
			lane: 'internal',
			collapsible: true,
			collapsedByDefault: true,
			renderer: 'AskEntry'
		}
	],
	[
		'elicitation',
		{
			lane: 'internal',
			collapsible: true,
			collapsedByDefault: true,
			renderer: 'AskEntry'
		}
	],
	[
		'choices',
		{
			lane: 'internal',
			collapsible: false,
			collapsedByDefault: false,
			renderer: 'ChoicesOffer'
		}
	],
	[
		'self_corrected',
		{
			lane: 'internal',
			collapsible: true,
			collapsedByDefault: true,
			renderer: 'SelfCorrected'
		}
	],
	[
		'live_text',
		{
			lane: 'external',
			collapsible: false,
			collapsedByDefault: false,
			renderer: 'AssistantMessage'
		}
	],
	[
		'live_reasoning',
		{
			lane: 'internal',
			collapsible: true,
			collapsedByDefault: true,
			renderer: 'ReasoningEntry'
		}
	],
	[
		'live_ask',
		{
			lane: 'internal',
			collapsible: true,
			collapsedByDefault: false,
			renderer: 'AskEntry'
		}
	]
]);

export function getPresentation(key: PresentationKey): Presentation {
	const p = registry.get(key);
	if (!p) throw new Error(`No presentation for key: ${key}`);
	return p;
}

export function presentationKeyFor(item: TimelineItem): PresentationKey {
	if (item.source === 'live') {
		return item.live;
	}
	if ('group' in item && item.group) {
		return item.result ? 'tool_group' : 'tool_group_unpaired';
	}
	return (item as DurableEntry).kind;
}
