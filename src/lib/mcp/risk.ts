import type { ToolRisk } from '$lib/agent/registry';
import type { McpToolAnnotations } from './types';

export function annotationsToRisk(annotations?: McpToolAnnotations): ToolRisk {
	if (!annotations) return 'high';
	if (annotations.destructiveHint === true || annotations.openWorldHint === true) return 'high';
	if (annotations.readOnlyHint === true) return 'readonly';
	return 'high';
}
