# Feature Specification: Customizable Expound Instructions

**Feature Branch**: `010-custom-expound-instructions`

**Created**: 2026-08-23

**Status**: Draft

**Input**: User description: "I'm a user. When I highlight a text in a chat with an intent to expound, I see added instructions like Comparison Tables, Code Blocks, etc. I think there's only 3. I want to have an area in the settings where I can have an editable list which I can add other commands or instructions I want with an optional description. (like a matching pair of name and description?) and also in the default, starting, already available, built-in list, I want there to include 'Mermaid Diagram' and 'Focus Callouts'"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Manage Expound Instructions in Settings (Priority: P1)

As a user, I want a dedicated area in Settings where the list of "added instruction" options offered when I expound on a highlighted text is fully editable: I can add new entries (a required name plus an optional description), edit existing entries, and remove entries I do not want. My changes persist across sessions and reloads.

**Why this priority**: This is the core request. Today the list is fixed at three options; giving users control over it is the primary value of the feature and is independently useful even before the default-list expansion.

**Independent Test**: Can be fully tested by opening Settings, adding an entry named "Real-world Analogies" with no description, reloading the app, and confirming the entry is still present in the list.

**Acceptance Scenarios**:

1. **Given** I am in Settings, **When** I open the expound instructions area, **Then** I see the current list of selectable instructions, each showing its name and, when provided, its description.
2. **Given** the expound instructions area, **When** I add a new entry providing only a name and leave the description empty, **Then** the entry is saved and appears in the list without a description.
3. **Given** an existing entry, **When** I change its name or description and save, **Then** the list immediately reflects the updated values.
4. **Given** an existing entry, **When** I choose to remove it, **Then** it no longer appears in the list.
5. **Given** I try to save an entry with a blank name or a name that duplicates an existing entry, **When** I submit, **Then** I see a clear validation message and the invalid entry is not saved.

---

### User Story 2 - Use Custom Instructions in the Expound Flow (Priority: P2)

As a user, when I highlight text in a chat and choose to expound, I want the instruction picker to offer my full customized list — including entries I added myself — with descriptions shown as helper text, and I want the instructions I select to be carried into the expound request and displayed on the resulting branch.

**Why this priority**: This connects the management area to the moment of use. Without it, customization has no effect on the actual expound experience.

**Independent Test**: Can be tested by adding a custom instruction in Settings, highlighting a text passage in a chat, opening the expound flow, and confirming the custom entry is selectable, its selection is reflected in the expound request, and the branch summary shows the selected instruction.

**Acceptance Scenarios**:

1. **Given** I have added a custom instruction in Settings, **When** I highlight text and open the expound flow, **Then** the picker shows the complete current list, including my custom entry and its description as helper text.
2. **Given** the expound flow with the picker open, **When** I select one or more instructions (built-in or custom) and confirm, **Then** the generated expound request references each selected instruction by its name.
3. **Given** a branch created from an expound, **When** I view the branch's summary card, **Then** the names of the selected instructions are displayed.
4. **Given** I remove an instruction in Settings while no expound flow is open, **When** I later open the expound flow, **Then** the removed instruction is no longer offered.

---

### User Story 3 - Expanded Built-in Defaults (Priority: P3)

As a user on a fresh installation, I want the starting, built-in list of expound instructions to include the existing defaults (Diagrams, Comparison Tables, Code Examples) plus two new built-ins: "Mermaid Diagram" and "Focus Callouts" — five options out of the box with no setup.

**Why this priority**: The expansion is explicitly requested but is a data change layered on the existing behavior; it delivers value on its own yet is less critical than giving users control over the list.

**Independent Test**: Can be tested by starting fresh and confirming the expound picker offers exactly the five default instructions, including "Mermaid Diagram" and "Focus Callouts".

**Acceptance Scenarios**:

1. **Given** a fresh installation with no prior customization, **When** I open the expound instructions area in Settings or the expound picker, **Then** the list contains Diagrams, Comparison Tables, Code Examples, Mermaid Diagram, and Focus Callouts.
2. **Given** an existing installation that used the previous three-option version, **When** the upgraded version first runs, **Then** the two new built-ins appear alongside the previous three without any user action, and no previously recorded expound data is lost or altered.

---

### User Story 4 - Restore Defaults and Continuity (Priority: P4)

As a user, I want a "restore defaults" action that resets my instruction list to the five built-ins, and I want previously created expound branches to keep displaying the instruction names that were recorded when they were created — even if those instructions were later edited or removed from the list.

**Why this priority**: Safety nets. They protect against accidental over-customization and against historical branches becoming unreadable as the list evolves; important but not required for the core workflow.

**Independent Test**: Can be tested by adding and then removing several custom entries, invoking restore defaults, and confirming the list returns to exactly the five built-ins; then opening an older expound branch whose recorded instruction no longer exists and confirming its label still renders.

**Acceptance Scenarios**:

1. **Given** a list containing custom entries and/or edits to built-ins, **When** I invoke restore defaults and confirm, **Then** the list becomes exactly the five default built-ins.
2. **Given** a branch created with an instruction that has since been renamed or removed, **When** I view that branch, **Then** the branch still displays the instruction name recorded at creation time.

---

### Edge Cases

- What happens when a user saves an entry with an empty or whitespace-only name? Submission is rejected with a validation message; a missing description is valid and simply omitted.
- What happens when a user adds an entry whose name duplicates an existing one? Rejected with a clear message, so instruction names remain unique identifiers.
- What happens when a name or description is unreasonably long? Input is bounded so the picker and settings list remain usable (length limit with feedback), and text renders gracefully.
- What happens when an instruction is removed after being selected in an in-progress expound flow? The picker stays consistent with the current list; the removed option is no longer selectable.
- What happens on upgrade from the fixed three-option version? Existing recorded expound selections continue to render their labels, and the two new built-ins appear without touching prior data.
- What happens when restore defaults is invoked while custom entries exist? Custom entries and edits are discarded after an explicit confirmation.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Settings MUST provide an expound instructions management area that lists all selectable instructions, each with its name and, when provided, its description.
- **FR-002**: Users MUST be able to add a new instruction consisting of a required name and an optional description.
- **FR-003**: Users MUST be able to edit the name and description of any existing instruction, built-in or custom.
- **FR-004**: Users MUST be able to remove any instruction, built-in or custom, from the list.
- **FR-005**: The instruction list MUST persist across sessions and app reloads.
- **FR-006**: The default list MUST contain five built-in instructions: Diagrams, Comparison Tables, Code Examples, Mermaid Diagram, and Focus Callouts.
- **FR-007**: Upgrading an existing installation MUST add the two new built-ins without user action and without altering previously recorded expound data.
- **FR-008**: The expound instruction picker MUST offer the complete current list, showing names and using descriptions as helper text.
- **FR-009**: Instructions selected in the expound flow MUST be conveyed in the expound request by their names.
- **FR-010**: The system MUST reject an instruction with a blank or duplicate name, with a clear validation message.
- **FR-011**: A restore-defaults action MUST reset the list to exactly the five built-ins, behind an explicit confirmation.
- **FR-012**: Branches created from expounds MUST continue to display their recorded instruction names even after those instructions are edited or removed from the current list.

### Key Entities _(include if feature involves data)_

- **Expound Instruction**: A selectable "added instruction" option offered during expound. Attributes: display name (required, unique across the list) and description (optional, shown as helper text). Has an origin of either built-in (one of the five defaults) or user-created. User-managed via Settings.
- **Expound Selection Record**: The set of instruction names chosen for one specific expound, recorded on the resulting branch at creation time. Immutable for display purposes; independent of later changes to the instruction list.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can add a new expound instruction from Settings in under 30 seconds.
- **SC-002**: 100% of list changes made in Settings are reflected in the expound picker without restarting the app.
- **SC-003**: Fresh installations present exactly the five default instructions, including Mermaid Diagram and Focus Callouts, with zero configuration.
- **SC-004**: For users upgrading from the three-option version, all previously recorded expound branches render their recorded instruction labels correctly (no data loss).
- **SC-005**: 100% of instruction list changes persist across app reloads.

## Assumptions

- The instruction list is a per-user preference stored and synced like other app settings; entries contain only non-secret, user-authored text (names and descriptions).
- The instruction **name** is the text carried into the expound request; the **description** is display-only helper text in Settings and the picker and is never sent as part of the expound request.
- Built-in instructions are editable and removable like custom ones; restore defaults is the way back to the canonical five.
- Scope is limited to the expound "added instructions" list; the free-text custom instructions box and all other expound behaviors (branching, overlap rules, offset handling) are unchanged.
- Per-chat or per-assistant overrides of the instruction list are out of scope; one list applies everywhere expound is offered.
- The two new built-ins behave exactly like the existing three — they are names carried into the expound request, not special-cased behaviors.
