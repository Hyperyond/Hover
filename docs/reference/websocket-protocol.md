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
{ type: 'spec-saved',      payload: { name, path } }
{ type: 'spec-exists',     payload: { slug, existingPath } }
{ type: 'case-csv-saved',  payload: { name, path } }
{ type: 'case-csv-exists', payload: { slug, existingPath } }
{ type: 'agents',          payload: { current: string, available: AgentAvailability[] } }
{ type: 'error',           payload: { message } }
```

## Client → server

```
{ type: 'command',       payload: { text, sessionId? } }
{ type: 'cancel' }
{ type: 'check-cdp',     payload: { pageUrl } }                 // "is this widget in the debug Chrome?"
{ type: 'launch-chrome', payload: { pageUrl } }                 // start debug Chrome, navigate to pageUrl
{ type: 'focus-debug',   payload: { pageUrl } }                 // bringToFront the matching tab in debug Chrome
{ type: 'save-skill',    payload: { name, description, steps, overwrite? } }
{ type: 'save-spec',     payload: { name, description, steps, assertions?, overwrite? } }
{ type: 'save-case-csv', payload: { name, description, steps, assertions?, jiraProjectKey?, labels?, overwrite? } }
{ type: 'list-skills' }
{ type: 'list-agents' }
{ type: 'switch-agent',  payload: { agentId } }
```

::: info This page is a placeholder
Full content coming soon — the `InvokeEvent` shape (`session_start` / `tool_use` / `tool_result` / `text` / `usage` / `session_end` / `raw`), CDP state machine, and the design rationale for binding the service to 127.0.0.1 only.

The protocol source of truth: header comment at the top of [`packages/core/src/service.ts`](https://github.com/Hyperyond/Hover/blob/main/packages/core/src/service.ts).
:::
