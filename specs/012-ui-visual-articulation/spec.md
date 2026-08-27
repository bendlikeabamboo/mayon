# Feature Specification: UI Visual Articulation Pass

**Feature ID**: 001-ui-visual-articulation **Created**: 2026-08-27 **Status**: Draft **Input**: User description: "Mayon UI Overhaul — Visual Articulation Pass: one accent system, three-level surface hierarchy, composer redesign with artifact launchers, confident home page, discoverable micro-interactions, compressed status chrome, warm charcoal dark theme, unified list cards, restrained motion — without raising text contrast or introducing serif fonts."

## Execution Flow (Main)

```         
1. Parsed feature description — visual articulation pass over the whole application shell
2. Extracted key concepts — accent color, surface hierarchy, composer, artifacts, home page,
   hover affordances, tree structure, status chrome, dark theme, cards, motion/loading
3. Ambiguities resolved with documented assumptions (Assumptions section)
4. User scenarios filled — nine stories mapped to the brief's P0/P1/P2 groups
5. Functional requirements generated (FR-1 … FR-21 + guiding principles GP-1 … GP-5)
6. Success criteria defined (SC-1 … SC-10)
7. Key entities identified (data touched by the pass)
8. Spec ready for planning
```

------------------------------------------------------------------------

## ⚖️ Simplicity & Progressiveness

This is a **restyling and affordance pass over existing screens**, not new product surface. Each user story below is independently shippable and independently visible; no story requires another to function. The highest-value first increment is Stories 1–3 (accent, surfaces, composer), which together resolve "nothing looks clickable / nothing has depth" on every screen at once.

------------------------------------------------------------------------

## User Scenarios & Testing *(mandatory)*

**Personas**: Mayon is self-hosted study software for a technical audience. The primary persona is the **owner-operator** (installs, maintains, and studies with it daily); a secondary persona is a **resident learner** using an instance they did not set up but who still expects every curriculum feature to be discoverable. All statements about "the user" below apply to both.

### User Story 1 - One accent teaches clickability (Priority: P1)

The owner opens any screen. Today every button, link, and label renders in the same muted ink-on-paper palette as static text; only tiny green dots break the monotone, so users cannot tell what is pressable without trial and error.

After this story, exactly **one** warm accent hue (amber/terracotta family, harmonizing with the paper palette) exists system-wide and marks only actionable emphasis: primary buttons ("All Chats", "continue"/"go deeper"), links, the active navigation item, keyboard focus rings, and the focused composer. Non-actionable content never borrows the accent, so the hue itself becomes the signal for "you can act here". Accent is defined once per theme so light and dark remain harmonious.

**Why this priority**: It is the single cheapest change that fixes the loudest complaint ("buttons are wallpaper") on every screen simultaneously — brand-defining and app-wide in one move.

**Independent Test**: Walk each screen in both themes; confirm every element intended to be clicked shows the accent in its interactive state, nothing inert carries the accent, and status greens remain reserved for status.

**Acceptance Scenarios**:

1.  **Given** the chats sidebar in light theme, **When** I view the primary navigation, **Then** the active item is visually marked by the accent while inactive items are not.
2.  **Given** any interactive control, **When** I move focus to it via keyboard, **Then** a clearly visible ring in the accent hue appears around it.
3.  **Given** a message containing links and plain text, **When** I read it, **Then** links alone are distinguished by the accent without any text becoming harder to read.
4.  **Given** both themes side by side, **When** I compare accent usage, **Then** the same semantic elements carry the same accent role with theme-appropriate tones (no pure reuse of one literal color that glares or vanishes).

------------------------------------------------------------------------

### User Story 2 - Surfaces form a three-step ladder instead of one flat plane (Priority: P1)

Every region of the app currently sits at identical visual volume. The user cannot perceive which areas contain, which support, and which float above — the page reads as engineering chrome wearing a paper costume.

After this story each theme defines exactly three surface levels — **canvas** (page background), **panel** (structural regions such as the sidebar and header), and **raised card** (interactive containers) — separated by thin hairline borders and subtle soft shadows, not by large brightness jumps. Cards visibly lift from their backdrop; the sidebar reads as the quietest region in light theme and the darkest in dark theme.

**Why this priority**: Depth via edges is the foundation every later story rests on (composer card, home resume card, shared row cards); doing it early makes everything after coherent.

**Independent Test**: Screenshot representative screens in both themes; a viewer can rank canvas/panel/card for any sampled region correctly, adjacent levels differ perceptibly yet softly, and no raised element lacks its border/shadow treatment.

**Acceptance Scenarios**:

1.  **Given** the chat screen, **When** I look at background, sidebar, and any floating container, **Then** I can point to three distinct depth levels ordered by emphasis.
2.  **Given** a raised card, **When** I compare it to its surrounding panel, **Then** separation comes from a crisp hairline edge plus gentle shadow rather than a jarring jump in lightness.
3.  **Given** the light theme, **When** I view the sidebar, **Then** it presents as less emphasized than the main content area.
4.  **Given** the dark theme, **When** I view the sidebar, **Then** it is the darkest region on screen and recedes behind the content panel.

------------------------------------------------------------------------

### User Story 3 - The composer becomes a docked instrument that mints artifacts (Priority: P1)

Today the message input reads as a full-width flat strip with sharp corners, controls floating detached around it. The user gets no hint that Mayon can branch conversations into trees, mint quizzes, or open labs.

After this story the composer is a centered, rounded, bordered card of comfortable capped width (matching the reading column's comfortable line length, roughly the current wide-message width), with send, model selection, and settings controls tucked inside its footprint. Focusing it raises the card with an accent ring per Story 1 and elevation per Story 2. Inside sit small launcher affordances — at minimum "branch here → tree node", "quiz me → quiz artifact", and "open lab" — each of which **immediately creates a persisted artifact** anchored to the active conversation (creating the conversation first if none exists). Nothing launched evaporates: no transient popovers, no modal-only flows. This strengthens the standing rule that all user interactions live on the main screen and persist.

**Why this priority**: The composer is used on nearly every screen visit; restyling it delivers the visual centerpiece of the pass, and the launchers turn it from a text box into a study-companion control desk without losing persistence guarantees.

**Independent Test**: On a fresh conversation and on an existing one, use each launcher; after each action (and a full reload) the produced tree node / quiz / lab artifact is present, persistent, and associated with the right conversation; the restyled composer keeps controls reachable at the capped width in both themes.

**Acceptance Scenarios**:

1.  **Given** an open conversation, **When** I activate "quiz me", **Then** a quiz artifact bound to that conversation is created immediately and remains after reload.
2.  **Given** no conversation is open, **When** I activate "branch here", **Then** a conversation is established and the tree node artifact lands inside it.
3.  **Given** the composer unfocused versus focused, **When** I click into it, **Then** it gains visible focus emphasis (accent ring, elevated border/shadow) distinguishing state at a glance.
4.  **Given** narrow window widths, **When** the composer reaches its capped comfortable width, **Then** all docked controls stay inside its footprint and usable.

------------------------------------------------------------------------

### User Story 4 - Home invites instead of shrugging (Priority: P2)

The landing screen spends most of its area on dead whitespace holding two small recents stacks — nothing says "begin". After this story home centers a greeting with a hero composer (or, when a chat is mid-flight, a prominent "continue learning" resume card), backed by suggested starter chips beneath. Recent Chats/Quizzes demote to the lower half. A returning owner is pulled back into in-progress work; a fresh visitor sees where to start within seconds.

**Why this priority**: High emotional payoff and daily touchpoint, but depends visually on Stories 1–2 tokens being available; sequenced directly behind them.

**Independent Test**: Load home with zero chats (starter chips present), with completed chats (recents visible below), and with an in-progress chat (resume card featured); measure interactions-to-start ≤ 2 in each case.

**Acceptance Scenarios**:

1.  **Given** a brand-new instance with no history, **When** I land on home, **Then** greeting, starting affordance, and starter chips are presented with no broken or empty recents prominence.
2.  **Given** a conversation I left unfinished, **When** I load home, **Then** a distinct "continue learning" card offers resumption and activating it reopens that chat.
3.  **Given** any home state, **When** I want to browse past material, **Then** recent chats and quizzes remain one glance lower on the same screen without scrolling away from the invitation zone.

------------------------------------------------------------------------

### User Story 5 - Hidden powers become discoverable (Priority: P2)

Copy, branching, regeneration exist today but give no visual cue; the Tree page encodes parent/child relationships through indentation alone. After this story: hovering a message reveals inline actions (copy, branch, regenerate); list rows across the app respond to pointer hover with a gentle tint; and Tree nodes show rotating carets plus connector lines between parent and child, so expansion state and ancestry read spatially. This converts invisible features from tribal knowledge into walk-up-discoverable ones — while keeping every resulting artifact on-screen and persistent.

**Why this priority**: Discoverability multiplies perceived capability but refines screens already structured; second-tier because core legibility (Stories 1–4) must land first.

**Independent Test**: In usability checks, a first-time viewer finds copy within 30 seconds of instruction-free exploration; branch/regenerate located by hover within one minute; tree parent-child pairs identified correctly from lines/carets alone ≥ 90% of the time.

**Acceptance Scenarios**:

1.  **Given** any delivered message, **When** I hover it, **Then** copy, branch, and regenerate actions appear near it without layout shift of the message itself.
2.  **Given** the tree page, **When** I expand/collapse a node, **Then** its caret rotates correspondingly and connector lines make its children visibly subordinate.
3.  **Given** the chat or quiz list, **When** I sweep the pointer down rows, **Then** each hovered row tints distinctly enough to track position.
4.  **Given** a touch-only device, **When** hover is unavailable, **Then** equivalent access to message actions exists by tap (assumption A-5).

------------------------------------------------------------------------

### User Story 6 - Chrome quiets down without disappearing (Priority: P2)

Development/status information (database readiness, server version, connection health) occupies multiple sidebar rows; the header shows level/mode chips (e.g., PRACTITIONER, EXPLAINER) permanently. After this story the status rows consolidate into one compact indicator whose details open on demand as an anchored info popover (keyboard-accessible too) — compressed footprint, zero removed information. Once a chat title exists, the two header chips collapse into one summary chip ("practitioner · explainer") with a chevron; expanding remembers its state **per chat**, persisting across visits.

**Why this priority**: Reclaims visual budget spent everywhere else, but involves persistence behavior (per-chat preference) worth doing after the primary experience is reshaped.

**Independent Test**: Confirm all previously visible status facts remain reachable in ≤ 2 actions; toggle the summary chip's chevron in a titled chat, navigate away and back, and observe state restored; untitled chats keep chips expanded.

**Acceptance Scenarios**:

1.  **Given** normal operation, **When** I glance at the sidebar bottom, **Then** status occupies a single compact indicator row rather than several.
2.  **Given** I need server details, **When** I activate the indicator (pointer or keyboard), **Then** full current values (DB readiness, version, etc.) appear anchored to it.
3.  **Given** a chat whose title was just generated, **When** I open it, **Then** level/mode display collapses into one combined chip with an expand chevron.
4.  **Given** I expanded that chat's chip earlier, **When** I close and reopen the same chat later, **Then** it appears expanded again — while other chats retain their own remembered states.

------------------------------------------------------------------------

### User Story 7 - Night mode warms up (Priority: P3)

Dark theme is currently neutral gray and cold next to the brand's paper warmth. It becomes a *warm charcoal* variant — grays leaned toward brown/amber undertones, consistent with the same surface ladder, hairline edges, single accent, and deliberately low text contrast preserved (see GP-1/GP-2). No element relies on raised text brightness to find hierarchy.

**Why this priority**: Cohesion win layered on top of tokens from Stories 1–2; safe to land last among theming work.

**Independent Test**: View every screen dark-side; sample key backgrounds and confirm warm undertone with hierarchy intact and no screen regaining glare.

**Acceptance Scenarios**:

1.  **Given** dark theme, **When** I compare panels against pure neutral gray references, **Then** backgrounds carry a discernibly warm charcoal character.
2.  **Given** long reading in dark mode, **When** I study a document-style chat, **Then** text remains comfortably soft as before — no brightening introduced by the repalette.

------------------------------------------------------------------------

### User Story 8 - One grammar for every list row (Priority: P3)

Chat lists and quiz lists render similar data differently today. Both adopt one shared row-card presentation: title · timestamp · progress-meta row, with hover response (Story 5 tint) and the raised-card edge treatment (Story 2). Consistency reduces scanning cost and makes quizzes feel like first-class citizens of the study library.

**Why this priority**: Pure consolidation polish; requires Stories 2 and 5 vocabulary to exist.

**Independent Test**: Place a chat list beside a quiz list; both exhibit identical row anatomy (title/timestamp/meta order, spacing rhythm, hover behavior, edge treatment).

**Acceptance Scenarios**:

1.  **Given** both lists side by side, **When** I scan rows, **Then** the structural pattern is indistinguishable apart from the meta values themselves.
2.  **Given** quiz rows showing progress (e.g., score/completion), **When** compared with chat timestamps, **Then** both occupy the same meta-slot with consistent type treatment.

------------------------------------------------------------------------

### User Story 9 - Motion reassures, loading tells the truth (Priority: P3)

Screen changes feel abrupt and there is no convention for waiting. Route content enters with a subtle stagger-fade that automatically yields to a reduced-motion preference. Loading placeholders appear **only** where loading measurably exceeds roughly 300 ms — speculative skeleton screens are explicitly out of favor; fast loads stay clean with no flicker.

**Why this priority**: Refinement flavor: pleasant, non-blocking, last.

**Independent Test**: Navigate between routes recording entry animation subtlety and duration norms; simulate fast (\<300 ms) and slow (\>300 ms) loads verifying absence/presence of placeholder respectively; toggle reduce-motion and observe animations suppressed.

**Acceptance Scenarios**:

1.  **Given** route navigation, **When** new content mounts, **Then** a gentle staggered fade-in plays noticeable but under \~½ second total.
2.  **Given** a data fetch completing in under \~300 ms, **When** I wait for it, **Then** no placeholder ever flashes.
3.  **Given** my OS-level reduce-motion setting enabled, **When** I traverse routes, **Then** entry motion plays harmlessly absent (instant or opacity-only minimal transition).

------------------------------------------------------------------------

### Edge Cases

- **Fresh install, empty state**: Home shows greeting + starter chips gracefully; resume-card logic silently absent; lists show empty-state guidance rather than blank voids.
- **Stale in-progress chat**: Resume card reflects genuinely latest activity; a chat completed moments ago stops offering itself as "continue".
- **Server unreachable**: Compact status indicator shifts to a degraded-but-visible presentation; the detail view explains what is unknown rather than appearing frozen.
- **Very long level/mode values or titles**: Summary chip truncates elegantly; expanded chip wraps without overlapping neighboring header controls.
- **Rapid repeated launcher activation**: Each deliberate activation creates its own distinct artifact; accidental double-fire does not duplicate semantically-identical items invisibly (visible feedback per creation).
- **Launcher at conversation genesis**: Artifacts created before any messages exist still anchor correctly and survive reload.
- **Theme switch mid-session**: Surface ladder, accent roles, and warm-charcoal values swap coherently without relaunch.
- **Keyboard-only traversal**: Every newly-visible affordance (message actions, status popover, chip chevron) reachable and operable without pointer.
- **Reduced-motion preference honored globally** including stagger-fade and caret rotation (rotation may snap states).
- **Hover ambiguity at boundaries**: Message-action reveal doesn't collide with text-selection affordances (selecting text shouldn't fight the revealed buttons).

## Requirements *(mandatory)*

### Guiding Principles (non-negotiable constraints)

- **GP-1 (Edges, not brightness)**: Visual articulation MUST be achieved through hairline borders (\~1 px), one-step surface elevation, and subtle shadows. Text contrast MUST NOT be increased anywhere in either theme as a fix for flatness; background luminance jumps between adjacent levels MUST stay gentle.
- **GP-2 (One voice, one family)**: Exactly one sans-serif type family throughout. No serif faces anywhere, ever. Hierarchy derives solely from size, weight, tone (within the low-contrast envelope), and spacing.
- **GP-3 (Everything persists)**: Any interaction the composer initiates — plain sends, branches, quizzes, labs — terminates in a persisted on-main-screen artifact. No floating panels that vanish, no modal-only outcomes, no discarding user intent into ephemeral chat state.
- **GP-4 (Compress, don't amputate)**: Development/status chrome may shrink dramatically but every previously displayed fact stays retrievable within two actions.
- **GP-5 (Single accent discipline)**: Exactly one accent hue system-wide for actionable emphasis; existing status greens stay status-only; decoration never appropriates the accent.

### Functional Requirements

*Accent (Story 1)* - **FR-1**: Primary buttons ("All Chats", "continue"/"go deeper" prompts, equivalents) render in the accent style, visibly distinct from secondary/tertiary controls. - **FR-2**: Hyperlinks and the active navigation item wear the accent consistently in both themes. - **FR-3**: Every focusable interactive element displays an accent-colored focus indicator meeting visibility expectations during keyboard traversal. - **FR-4**: The composer's idle vs. focused border states differ using the accent ring treatment. - **FR-5**: The accent is defined at the token/theme level with dedicated light and dark variants sharing one perceptual family.

*Surfaces (Story 2)* - **FR-6**: Every themed region maps to exactly one of three surface roles: canvas, panel, or raised card. - **FR-7**: Adjacent surface levels separate via hairline border + subtle shadow; cards always carry both treatments; contrast strategy honors GP-1. - **FR-8**: Sidebar manifests as least-emphasized surface in light theme and darkest surface in dark theme.

*Composer (Story 3)* - **FR-9**: Composer presents as centered rounded bordered card capped near the comfortable reading-column width, containing send/model/settings controls within its own footprint. - **FR-10**: Launcher affordances (minimum: branch → tree node, quiz me → quiz artifact, open lab) live inside the composer and execute creation immediately upon activation. - **FR-11**: Each launcher-created artifact persists, associates with the active conversation (establishing one if necessary), and is visible on the main interface post-reload.

*Home (Story 4)* - **FR-12**: Home leads with centered greeting + either hero composer or prominent continue-learning resume card (when an in-progress chat exists), followed by starter chips; recents occupy demoted positions below. - **FR-13**: Starter chips initiate a conversation seed without requiring the user to leave home. - **FR-14**: Resume card resumes exactly the referenced conversation upon activation.

*Micro-interactions (Story 5)* - **FR-15**: Delivered messages expose copy, branch, regenerate through hover-revealed (or tap-equivalent) inline actions; branch produces the same persisted tree-node outcome as the composer launcher (GP-3). - **FR-16**: Interactive list rows display a perceivable hover tint distinguishable from resting state. - **FR-17**: Tree page conveys structure via rotating expansion carets AND visual connectors between parent/child nodes, replacing indentation-only encoding.

*Chrome compression (Story 6)* - **FR-18**: Multiple sidebar status rows collapse to one compact indicator; activating it reveals anchored detail popover including database readiness and server version facts, operable via keyboard. - **FR-19**: Once a title generates for a chat, header level/mode chips collapse into a single combined summary chip with a chevron toggling expansion; expansion state persists per chat across sessions.

*Warm charcoal dark theme (Story 7)* - **FR-20**: Dark theme adopts warm-toned charcoal surfaces consistent across the full ladder without altering GP-1 text-softness.

*Unified cards (Story 8)* - **FR-21**: Chat and quiz lists share one row-card component pattern: title · timestamp · progress meta ordering, common spacing/hover/edge treatment per FR-6/7/16 vocabulary.

*Motion & loading honesty (Story 9)* - **FR-22**: Route transitions play a restrained stagger-fade honoring reduce-motion; total under \~½ second. - **FR-23**: Loading placeholders render exclusively for loads exceeding ≈300 ms measured threshold; sub-threshold loads show none.

### Key Entities

- **Conversation (chat)**: Title (may be unset until generated), activity recency, completion status (drives home resume logic), hosts messages.
- **Message**: Content unit inside a conversation; anchor for hover actions and branching origin.
- **Tree Node**: Branching artifact linking parent → children; the relationship the tree view must visualize.
- **Quiz Artifact**: Quiz entity with progress metadata feeding the unified row card.
- **Lab Artifact**: Laboratory exercise spawned by the "open lab" launcher.
- **Per-chat Display Preference**: Remembers level/mode summary-chip expanded/collapsed state keyed by chat.
- **Status Readout**: Database readiness and server version/connection facts powering the compact indicator (source data unchanged; presentation only).
- **Starter Suggestion**: Seed prompt candidates surfaced as home chips.
- **Theme Token Set**: Per-theme definitions for accent variants, three surface levels, edge/shadow treatments (existence implied as configuration data, semantics only here).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-1**: Across all screens in both themes, ≥ 90% of sampled actionable controls are identifiable as clickable through accent/hover cues alone, verified in a walkthrough review.
- **SC-2**: An independent reviewer ranks any sampled region's surface role (canvas/panel/card) correctly ≥ 8 of 10 times in both themes.
- **SC-3**: Starting new learning or resuming from home takes ≤ 2 interactions and ≤ 5 seconds from page load.
- **SC-4**: 100% of composer launcher activations result in a retrievable persistent artifact surviving full reload (zero loss observed in test suite of flows).
- **SC-5**: An unfamiliar user locates the copy action unaided within 30 seconds; branch/regenerate within 60 seconds (informal usability check).
- **SC-6**: Every prior status fact remains accessible within ≤ 2 actions after compression; status occupies a single indicator row.
- **SC-7**: Owner validates subjective targets in side-by-side before/after review per theme: warmth of dark palette, presence-but-subtlety of depth, comfort unchanged for extended reading (explicit sign-off gate).
- **SC-8**: A first-pass inventory confirms zero serif glyphs introduced system-wide.
- **SC-9**: All added motion suppresses correctly under reduced-motion preference (verified in one traversal per major flow).
- **SC-10**: Information density preserved: no pre-existing screen loses displayed capability or forces more scrolling for equivalent content after restyle.

## Assumptions

- **A-1 (Accent finalization)**: Warm amber/terracotta direction is fixed; the exact hue/lightness pair per theme gets tuned during planning/design — not left ambiguous for implementation.
- **A-2 (Regenerate semantics)**: Regenerate follows existing product regeneration/conversation-tree behavior; the spec requires reachability and a visible fresh response, not new undo mechanics.
- **A-3 (Starter chips source)**: Suggestions derive from existing course/curriculum context where available, falling back to sensible generic seeds on fresh instances.
- **A-4 (Tree expansion memory)**: Caret/expanded state persists per session only unless the per-chat preference mechanism naturally extends to it.
- **A-5 (Touch parity)**: Hover-revealed actions gain a coarse-pointer-equivalent access path (tap/tap-and-hold) since keyboard/touch accessibility is expected of the codebase generally.
- **A-6 (Loading threshold precision)**: "\~300 ms" is a user-perceivable design guideline tuned empirically during implementation, not a hard-coded contract.
- **A-7 (Artifact naming)**: Launcher-created artifacts inherit conversational context/topic for their titles rather than demanding inline naming modals at creation time.

## Dependencies

- Dual-theme infrastructure exists and supports per-theme token redefinition (prerequisite for accent + ladder + charcoal variant).
- Existing artifact types (tree nodes, quizzes, labs) expose creation paths reachable from composer context.
- Per-chat settings storage capable of holding the new display preference field (summary-chip state).
- Status facts currently shown (DB readiness, versions) originate from live capability detection already present in the app.

## Out of Scope

- New artifact types beyond branch-node/quiz/lab.
- Any change to text contrast targets, typography families, or font faces (locked by GP-1/GP-2).
- Information architecture moves not listed here (navigation restructuring, screen additions/removals).
- Server/admin capabilities, authentication, sync, or backup changes.
- Mobile-specific responsive redesign (limited to whatever general responsiveness the listed items already demand).
- Telemetry/analytics of any kind.