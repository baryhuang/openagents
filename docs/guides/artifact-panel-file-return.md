# Feature: Artifact Panel & Agent File Return

## Problem Statement

The workspace thread UI currently has two gaps in file handling:

1. **Agents don't return files in thread messages.** When an agent generates content (markdown documents, code files, HTML), it dumps everything into `payload.content` as inline text. The plumbing for file attachments exists end-to-end (SDK → backend → frontend), but nothing in the agent orchestration layer creates files and attaches them to responses.

2. **No artifact/canvas side panel.** When a file attachment does exist on a message, clicking it navigates away from the chat (`setViewMode('files')`). There is no way to view a file alongside the conversation, unlike Claude Desktop's artifact panel.

## Current Architecture

### How thread messages work (end-to-end)

```
User sends message
  → ChatInput → workspaceApi.sendMessage()
  → POST /v1/events { type: "workspace.message.posted", source: "human:user" }
  → Backend Pipeline:
      1. AuthMod (verify token)
      2. WorkspaceMod (route: parse @mentions, LLM router picks target agent)
      3. PersistenceMod (save EventRecord to DB)
  → Agent polls GET /v1/events (every ~1s via AgentRunner._async_loop)
  → react() → orchestrate_agent() → LLM + tools
  → Agent posts response: WorkspaceClient.send_message()
  → POST /v1/events { type: "workspace.message.posted", source: "openagents:agent-name" }
  → Same pipeline → persisted to DB
  → Frontend polls GET /v1/events?after={cursor} (every 2s)
  → eventToMessage() → renders in chat via ChatMessage component
```

### How file uploads work

**User upload (works today):**
1. Upload file → `POST /v1/files` (multipart) → returns `{ id, filename, contentType, size }`
2. Message event includes `payload.attachments: [{ fileId, filename, contentType, url }]`
3. Frontend `Attachments` component renders attachment in thread
4. URL regenerated from `fileId` at render time via `workspaceApi.getFileUrl(fileId)`

**Agent upload (plumbing exists, unused):**
1. `POST /v1/files/base64` — JSON endpoint designed for agents (base64-encoded content)
2. Returns same `{ id, filename, contentType, size }`
3. `WorkspaceClient.send_message()` accepts `attachments` parameter — never called with it
4. Agent orchestrator puts all output in `payload.content` as plain text

### Message attachment structure

```typescript
// In event payload
payload: {
  content: "Here's the report",
  attachments: [
    { fileId: "uuid", filename: "report.md", contentType: "text/markdown", url: "..." }
  ]
}

// Extracted into message
message.metadata.attachments = [{ fileId, filename, contentType, url }]
```

### Thread UI attachment rendering (chat-message.tsx)

- **Images**: inline thumbnail, click → navigates to files view
- **HTML files**: eye icon button, click → navigates to files view
- **Other files**: download link (`<a href={url}>`)
- **Markdown**: not treated as previewable (only images and HTML pass `isPreviewable()`)

### Files view (file-preview.tsx)

Full-page preview supporting HTML (iframe), images, markdown (MarkdownContent), text/code (pre block). Replaces the chat view entirely when `viewMode` switches to `'files'`.

### Existing split panel precedent

The browser view already supports a split mode: chat on left + browser on right (50/50). This is toggled via `splitBrowser` state in `LayoutContext` and persisted to localStorage.

## Identified Gaps

| Gap | Current State | What's Needed |
|-----|--------------|---------------|
| Agent file creation | Agent can upload via `/v1/files/base64` but never does | Agent orchestrator should upload generated files and attach metadata to response events |
| Markdown not previewable in threads | `isPreviewable()` only returns true for images and HTML | Add markdown, code, SVG to previewable types |
| No side panel for artifacts | Clicking attachment navigates away from chat to files view | Add split artifact panel alongside chat (reuse browser split pattern) |
| No inline artifact detection | Long code/markdown blocks live inside message content | Detect fenced code blocks and offer "Open in panel" action |
| File preview is full-page only | `file-preview.tsx` replaces chat entirely | Need a panel-mode variant that coexists with chat |

## Implementation Plan

### Phase 1: Agent File Return (Backend/SDK)

**Goal:** When an agent generates substantial content, upload it as a file and attach to the response message.

Key files:
- `sdk/src/openagents/agents/runner.py` — agent orchestration loop
- `sdk/src/openagents/client/workspace_client.py` — `send_message()` and file upload methods

Changes:
- In the agent orchestration layer, after LLM generates a response, detect substantial content blocks (markdown docs, code files, HTML)
- Upload via `POST /v1/files/base64` with `source: "openagents:{agent-name}"`
- Include attachment metadata in the `send_message()` call
- Keep the inline `content` as a summary/reference, not the full file

### Phase 2: Artifact Side Panel (Frontend)

**Goal:** View files alongside the conversation, like Claude Desktop's artifact panel.

Key files:
- `workspace/frontend/components/layout/layout-context.tsx` — add `splitArtifact` state
- `workspace/frontend/components/layout/wrapper.tsx` — add split layout variant
- `workspace/frontend/components/chat/chat-message.tsx` — open attachments in panel instead of navigating away
- New: `workspace/frontend/components/artifacts/artifact-panel.tsx` — panel component

Changes:
- Add `artifactPanel: { fileId: string } | null` state to LayoutContext
- Reuse the existing 50/50 split pattern from `splitBrowser`
- When clicking an attachment in a thread message, set `artifactPanel` instead of `setViewMode('files')`
- Panel renders file content (reuse rendering logic from `file-preview.tsx`)

### Phase 3: Inline Artifact Detection

**Goal:** Detect code fences in agent messages and offer "Open in panel" button.

Key files:
- `workspace/frontend/components/chat/markdown-content.tsx` — add action buttons to code blocks
- `workspace/frontend/components/chat/chat-message.tsx` — coordinate with artifact panel

Changes:
- In MarkdownContent, add an "Open in panel" button on large fenced code blocks
- Clicking creates a transient artifact (not persisted to files) and opens in side panel
- Optionally: "Save as file" action to persist to `/v1/files`

### Phase 4: Rich Artifact Features (Future)

- Edit-in-panel for markdown/code
- Version history (multiple iterations of same artifact)
- Mermaid diagram rendering
- Live-updating artifacts (agent streams, panel updates)

## Key Files Reference

| File | Role |
|------|------|
| `workspace/frontend/components/chat/chat-message.tsx` | Thread message + attachment rendering |
| `workspace/frontend/components/chat/chat-input.tsx` | Message composition + file upload |
| `workspace/frontend/components/chat/chat-view.tsx` | Main chat view, handles send flow |
| `workspace/frontend/components/chat/markdown-content.tsx` | Markdown rendering in messages |
| `workspace/frontend/components/files/file-preview.tsx` | Full-page file preview |
| `workspace/frontend/components/layout/layout-context.tsx` | UI state (viewMode, splitBrowser) |
| `workspace/frontend/components/layout/wrapper.tsx` | Layout orchestrator |
| `workspace/frontend/hooks/use-polling.ts` | Message polling |
| `workspace/frontend/lib/api.ts` | API client (sendMessage, uploadFile, getFileUrl) |
| `workspace/frontend/lib/types.ts` | Types + eventToMessage conversion |
| `workspace/backend/app/routers/files.py` | File upload/download/list endpoints |
| `workspace/backend/app/routers/events.py` | Event posting + polling endpoints |
| `workspace/backend/app/mods/workspace_mod.py` | Message routing (LLM router) |
| `sdk/src/openagents/agents/runner.py` | Agent loop + orchestration |
| `sdk/src/openagents/client/workspace_client.py` | Agent-side API client |
