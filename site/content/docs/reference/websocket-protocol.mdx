# WebSocket protocol

The widget and the Node service communicate over a single WebSocket bound to `127.0.0.1`. Every message is `{ type, payload }`.

## Server → client

```
{ type: 'hello',           payload: { agentId, model, version } }
{ type: 'event',           payload: InvokeEvent }              // see agents/types.ts
{ type: 'cdp-status',      payload: { state, reason?, matchingTabUrl?, browser?, launching? } }
{ type: 'skill-saved',     payload: { name, path } }
{ type: 'skill-exists',    payload: { slug, existingPath } }
{ type: 'skills-list',     payload: { skills: SkillSummary[] } }
{ type: 'specs-list',      payload: { specs: SpecSummary[] } }
{ type: 'modes',           payload: { current: string|null, available: ModeEntry[] } }
{ type: '<plugin-namespaced>', payload: <plugin-specific> }   // plugin-broadcast events (e.g. security:flow:*)
{ type: 'spec-saved',      payload: { name, path } }
{ type: 'spec-exists',     payload: { slug, existingPath } }
{ type: 'case-csv-saved',  payload: { name, path } }
{ type: 'case-csv-exists', payload: { slug, existingPath } }
{ type: 'agents',          payload: { current: string, available: AgentAvailability[] } }
{ type: 'error',           payload: { message } }
```

## Client → server

```
{ type: 'command',       payload: { text, sessionId?, reRecord?: { slug } } }   // when reRecord.slug is set, the service collects tool_use events server-side and on a clean session_end overwrites __vibe_tests__/<slug>.spec.ts (v0.11 ⟳ Re-record)
{ type: 'cancel' }
{ type: 'check-cdp',     payload: { pageUrl } }                 // "is this widget in the debug Chrome?"
{ type: 'launch-chrome', payload: { pageUrl } }                 // start debug Chrome, navigate to pageUrl
{ type: 'focus-debug',   payload: { pageUrl } }                 // bringToFront the matching tab in debug Chrome
{ type: 'save-skill',    payload: { name, description, steps, overwrite? } }
{ type: 'save-spec',     payload: { name, description, steps, assertions?, overwrite? } }
{ type: 'save-case-csv', payload: { name, description, steps, assertions?, jiraProjectKey?, labels?, overwrite? } }
{ type: 'list-skills' }
{ type: 'list-specs' }                                            // ask for every spec under __vibe_tests__/, with parsed JSDoc headers
{ type: 'list-agents' }
{ type: 'switch-agent',  payload: { agentId } }
{ type: 'set-mode',      payload: { modeId: string|null } }   // null = exit moded operation
{ type: 'list-modes' }
```

For the authoritative list see [`packages/core/src/service.ts`](https://github.com/Hyperyond/Hover/blob/main/packages/core/src/service.ts) and the `InvokeEvent` union in [`packages/core/src/agents/types.ts`](https://github.com/Hyperyond/Hover/blob/main/packages/core/src/agents/types.ts).
