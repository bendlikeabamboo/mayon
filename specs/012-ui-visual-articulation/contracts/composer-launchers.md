# Contract: Composer Artifact Launchers

**Scope**: Behavior contract for the launcher affordances embedded in the redesigned composer card. Defines outcomes users may rely on and what tasks.md must implement against. Storage routes ride existing repositories/stores exclusively (constitution I).

## Launchers

| Affordance | Effect chain (existing paths) | Persisted artifact (visible post-reload) |
|---|---|---|
| **branch here** | ensure chat exists → child conversation creation via `repos.chats.createChild({ parentId, branchPointMessageId: null, title })` composed with `chatStore.createAndNavigate()` fallback for no-chat contexts (identical rows to `chatStore.branchFromMessage` minus the fork point). NOTE (amended during GD implementation): **no `branchSourcesRepo.create` edge** — the `sourceMessageId` column is NOT NULL and root-level branching has no source message; writing one would dangle. Parent/child linkage is expressed by `parentId` alone. | new conversation present in lists + reachable tree node (FR-10/11) |
| **quiz me** | ensure chat exists → `quizzesStore.generate(chatId)` (`quizzesRepo.create`, upstream question pipeline unchanged) | quiz row bound to that conversation |
| **open lab** | ensure chat exists → `labsStore.generate(chatId)`; fallback raw-save path via `labsStore.saveRaw(...)` if generation service unavailable | lab row bound to that conversation (checklist enabled) |

## Rules

1. **Persistence guarantee (GP-3)**: each deliberate activation terminates in stored rows through repos — never ephemeral client-only state. SC-4 asserts full-reload survival for every launcher.
2. **Ensure-chat step**: when no conversation is open, the launcher establishes one first (creation itself is persisted), then binds the artifact to it (FR-11 acceptance scenario 2). Chat title conventions follow A-7 (inherit context/topic; no naming modal).
3. **Main-screen outcome (GP-3)**: feedback equals the app's ordinary artifact surfaces (navigation into the new conversation; quiz/lab appearing in their main-screen places). Floating panels whose disappearance orphans intent are prohibited; nothing may be modal-only.
4. **Capability awareness (constitution III)**: launchers follow whatever gating applies to normal send/generate flows (server-dependent generation degrades identically to existing generate buttons). When unusable, controls render disabled-with-explanation rather than disappearing facts.
5. **Debounce/feedback discipline**: each activation yields immediate visible response (artifact appears or an in-composer status message shows work in progress, consistent with existing generating states); accidental double-fire either creates a second distinct artifact visibly or no-ops during an already-running generation — silent invisible duplication prohibited.
6. **No schema changes**: all writes flow through the listed stores/repos as they exist plus tasks-level glue in the composer component. If implementation discovers a needed store signature change, it amends this contract + data-model note in the same change set.
7. **Keyboard & AT parity**: launcher chips are buttons inside the composer card's tab order; labels announce their artifact outcome ("branch here", "quiz me", "open lab").

## Acceptance hooks (mirror spec SC/AC)

- Reload-persistence check per launcher (SC-4)
- Genesis-conversation binding (AC 3.2)
- Narrow-width containment: chips + docked controls stay inside the card footprint at max-w cap (AC 3.4 / FR-9)
