import { describe, expect, it } from 'vitest';
import { lintTurn } from './strategy-lint';
import type { ScopeStrategyId } from '$lib/chat/strategies';

const GOOD_CURRICULUM_TURN = `The goal is to understand Makefiles. Makefiles are the backbone of many C and C++ projects, providing a declarative way to specify build rules and dependencies between source files. Understanding Make is essential for any systems programmer.

## Table of Contents
- Unit 1: Makefile basics — targets, prerequisites, and recipes
- Unit 2: Variables and pattern rules
- Unit 3: Advanced targets and phony targets

### Concept

A Makefile is a build automation tool that uses targets and recipes. The key idea is that Make checks file timestamps to decide what needs rebuilding. In your own words, a Makefile declares relationships between files and the commands needed to produce them. Each rule has a target (the file to produce), prerequisites (the files the target depends on), and a recipe (the shell commands to run). When you invoke Make, it walks the dependency graph from the requested target downward, rebuilding only what is out of date. This incremental rebuild model is what makes Make fast for large codebases.

### Example

Consider a simple project with two source files. The Makefile below defines three targets: the final executable, and two object files. When you run \`make main\`, Make sees that \`main.o\` and \`utils.o\` are prerequisites. If either is missing or older than its source, Make recompiles it first. Only then does it link the final binary.

The \`CC\` and \`CFLAGS\` variables make the Makefile configurable — change the compiler once at the top, and every recipe inherits the new value.

By Unit 1 you will be able to understand how Make resolves dependencies.

Ready for Unit 2: Variables and patterns?`;

const SHORT_TURN = 'This is too short.';

const OVER_CALLOUT_TURN = `Content here.

> [!NOTE] First callout

More content.

> [!WARNING] Second callout

> [!TIP] Third callout

> [!CONCEPT] Fourth callout

End.`;

describe('lintTurn', () => {
	it('a skeleton-complete, above-floor turn scores pass:true for guided-curriculum', () => {
		const result = lintTurn('guided-curriculum', GOOD_CURRICULUM_TURN);
		expect(result.pass).toBe(true);
		expect(result.words).toBeGreaterThanOrEqual(250);
	});

	it('a turn under the word floor scores pass:false', () => {
		const result = lintTurn('guided-curriculum', SHORT_TURN);
		expect(result.pass).toBe(false);
		const floorCheck = result.checks.find((c) => c.name.includes('word floor'));
		expect(floorCheck).toBeDefined();
		expect(floorCheck!.ok).toBe(false);
	});

	it('a turn over the callout budget scores pass:false', () => {
		const result = lintTurn('guided-curriculum', OVER_CALLOUT_TURN);
		expect(result.pass).toBe(false);
		const calloutCheck = result.checks.find((c) => c.name.includes('callout budget'));
		expect(calloutCheck).toBeDefined();
		expect(calloutCheck!.ok).toBe(false);
	});

	it('a turn missing a required skeleton part scores pass:false', () => {
		const noConcept =
			'Here is a table of contents:\n- Unit 1: Basics\n\nAnd some example code.\n\nTie back to the goal.';
		const result = lintTurn('guided-curriculum', noConcept);
		expect(result.pass).toBe(false);
		const conceptCheck = result.checks.find((c) => c.name === 'concept');
		expect(conceptCheck).toBeDefined();
		expect(conceptCheck!.ok).toBe(false);
	});

	it('unknown strategy id returns pass:true with empty checks', () => {
		const result = lintTurn('nonexistent' as ScopeStrategyId, 'anything');
		expect(result.pass).toBe(true);
		expect(result.checks).toEqual([]);
	});

	it('gate fence is excluded from word count', () => {
		const raw =
			GOOD_CURRICULUM_TURN +
			'\n\n```gate\n{"nextUnit":"Variables","options":["continue"],"progress":"Unit 2 / 5"}\n```';
		const withGate = lintTurn('guided-curriculum', raw);
		const withoutGate = lintTurn('guided-curriculum', GOOD_CURRICULUM_TURN);
		expect(withGate.words).toBe(withoutGate.words);
	});
});
