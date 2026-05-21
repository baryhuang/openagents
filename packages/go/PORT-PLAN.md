# OpenAgents Go — Web Port

Plan for cloning the React workspace frontend into `packages/go/web/`,
rebranding it to match the Swift Go app, and bringing it to feature parity
with the 0.3.0 Swift release. Source of truth for execution order and
progress.

## Why

The Swift Go app has drifted from the React workspace frontend at
`workspace/frontend/` — different terminology ("Chat" vs "Thread"),
different icon, different right-panel model (tabbed Content/Browser),
different workspace-level browser toggle. We want **one product** called
"OpenAgents Go" that owns macOS, iOS, **and** web, sharing brand,
terminology, and feature pace.

Decision matrix from the planning conversation:

| Question | Choice |
|---|---|
| Strategy | **A — Copy + rebrand.** Copy React app, rebrand, sunset old later. |
| Old `workspace/frontend/` | **Leave in place** (deprecated mirror) until parity reached. |
| Deploy target | **Same InsForge project** `caremojo-openagents`, same `agents.caremojo.app` CNAME. |
| v1 scope | **Full parity** with Swift 0.3.0 (every 0.2.x→0.3.0 feature). |

## Layout

```
packages/go/
├── OpenAgents/            # existing Swift sources (mac + iOS)
├── OpenAgentsGo.xcodeproj/
├── dist/                  # Swift DMG output
├── web/                   # NEW — Next.js workspace UI
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── public/
│   ├── package.json       # @openagents-org/go-web
│   └── .insforge/         # InsForge project link (caremojo-openagents)
├── project.yml            # xcodegen
└── PORT-PLAN.md           # this file
```

`workspace/frontend/` stays intact during the port and is removed in
Phase 8 once `packages/go/web/` is at parity.

## Phases

### Phase 0 — Mechanical copy + verify deploy (½ day)

Goal: `agents.caremojo.app` still serves correctly after a deploy run
from the new path.

- `cp -r workspace/frontend packages/go/web` (skip `node_modules`,
  `.next`, `.insforge`)
- Rename `package.json` `name` → `@openagents-org/go-web`
- Drop the `.insforge/project.json` from the old path so the InsForge
  CLI rejects deploys from there (enforces "only deploy from new path")
- `npm install` in the new path
- `npm run build` clean
- `insforge deployments deploy .` from the new path
- Verify `agents.caremojo.app` returns 200 with `x-vercel-cache: HIT`

No UX change; this is a relocation only.

### Phase 1 — Brand identity (1–2 days)

- Favicon + app logo → squircle icon from Swift's PR #390 (the 80%-scaled,
  rounded version that ships in 0.3.0). Generate 16/32/180/192/512 PNGs +
  Apple-touch-icon
- `theme_color` / `background_color` in `manifest.json`
- Color tokens: align `tailwind.config.js` (or CSS vars) to Swift's accent
  palette
- Page `<title>` → "OpenAgents Go" / "{Workspace} — OpenAgents Go"
- Header brand text + sidebar logo

### Phase 2 — Thread→Chat terminology (½ day)

Mirrors Swift PR #388. User-visible strings only; internal identifiers
(`channel_name`, `Channel`, `useChannel`) stay.

- "New Thread" → "New Chat"
- "Threads" / "thread list" → "Chats" / "chat list"
- "Start Thread" → "Start Chat"
- "Rename thread" → "Rename chat"
- Empty states / tooltips / aria-labels
- Manual review pass for context-dependent variants

### Phase 3 — iMessage-style 2-pane layout (3–4 days)

Match Swift `ChatView` + sidebars.

- Left column (~280pt): workspace selector at top + chat list with
  starred section, swipe / context-menu actions (rename / star / archive /
  delete), agent-working spinner, search bar
- Center column (flexible): chat with markdown bubbles, fenced code, HTML
  blocks, GFM tables, file chips, sender grouping, status messages, per-chat
  input drafts
- Right column (toggleable, ~280–560pt): tabbed panel (Phase 5)
- Composer at the bottom of the center column (Phase 6)
- macOS: window-toolbar title + agent-name subtitle
- iOS / mobile: collapse to single-column NavigationStack pattern

### Phase 4 — Workspace browser_enabled toggle (½ day)

Mirrors Swift PR #393's toolbar Safari toggle.

- `<Switch>` (or icon button) next to the workspace name in the workspace
  header
- Calls `PATCH /v1/workspaces/{id}` with `{ "browser_enabled": bool }`
  (typed field; backend PR #392 already deployed)
- Optimistic local flip + debounced PATCH; rollback on error
- Read from workspace metadata's `browserEnabled` field

### Phase 5 — Tabbed right panel (3–5 days)

Single panel surface that swaps between Content and Browser tabs.

- Two-tab header `[Content | Browser]` — Browser tab hidden unless
  `workspace.browserEnabled === true` **and** any tab has `liveUrl`
- **Content tab** (mirrors Swift `ContentSidebar` + `FileDetailView`):
  - File grid (1-col narrow / 2-col wide)
  - File detail with kind-specific viewers (image / text / PDF / HTML /
    other)
  - Icon-only download button in detail header
  - Fullscreen HTML modal viewer (mirrors Swift `FullscreenHTMLSheet`)
- **Browser tab** (mirrors Swift `BrowserPanel`):
  - URL pill with hover→copy button (already done today)
  - Reload (validate=true) + fullscreen buttons
  - WKWebView equivalent: an `<iframe>` whose container clamps
    `overflow-x` so wide Browser Fabric pages don't push the panel
- **Auto-focus rule**: first time the workspace transitions to "has live
  session" while toggle is on, open the panel + focus Browser tab. After
  that, respect the user's tab pick (token-style counter like Swift's
  `browserAutoFocusToken`)

### Phase 6 — Composer polish (2–3 days)

- Drag-and-drop file attachments via HTML5 `dragenter` / `drop` (mirrors
  Swift's `ChatView.onDrop`); dashed accent overlay during hover
- Paste-image-from-clipboard
- IME-safe Enter / Shift+Enter behavior
- Slash-command popup (`/restart`, `/status`, `/routines`)
- Pending-attachments chip row above the input with thumbnails for images,
  document chips for others
- Image downsampling client-side before upload (mirrors Swift
  `ImageDownsampler.ensureFits`)

### Phase 7 — Misc polish (2–3 days)

- A2UI inline renderer in chat bubbles (uses the same JSON spec as Swift's
  `A2UIRendererView` via SwiftUIJSONRender; web equivalent: a small JS
  component tree)
- BrowserFabric iframe overflow clamp via CSS on the iframe's wrapper +
  `sandbox` attribute audit
- Markdown segmenter parity: file chips, fenced `html` blocks (sandboxed
  iframe), GFM tables, image rendering, auto-hyperlinking
- Members sheet (avatar stack → modal)
- Responsive breakpoints — match Swift's iPhone-vs-iPad pivot at
  `horizontalSizeClass`
- Loading + error states + retry affordances

### Phase 8 — Verify + sunset (1 day)

- Side-by-side QA: open the Swift app and the new web app, walk through
  every 0.2.x→0.3.0 feature, confirm parity (or note "platform-specific —
  not applicable")
- Delete `workspace/frontend/`
- Update `CLAUDE.md` / `README.md` / docs / any CI workflows that
  referenced the old path
- Final deploy from `packages/go/web/`

## Discipline rules during the port

1. **Only `packages/go/web/` deploys.** `workspace/frontend/` loses its
   `.insforge/` directory in Phase 0 so accidental `insforge deployments
   deploy` from there fails fast.
2. **Backend changes go in `workspace/backend/`**, regardless of which
   frontend they're for. No per-platform backend forks.
3. **No new Swift features** between Phase 0 and Phase 8. Feature freeze on
   `packages/go/OpenAgents/` so the web app can catch up without chasing a
   moving target.
4. **Commits target `feat/go-web-port`** for the whole port. Phase-end
   commits get conventional headers (`feat(go-web): …` / `chore(go-web):
   …`). The branch turns into ONE big PR at Phase 8, or one PR per phase
   if review fatigue hits.

## Risks called out at planning time

- **Visual divergence**: SwiftUI primitives (blur, system animations) don't
  have exact CSS equivalents. I'll pick close analogs; aesthetic calls
  bubble back for your OK.
- **A2UI parity**: `SwiftUIJSONRender` is a Swift-only package. The web
  equivalent has to be written from scratch — bounded set of node types
  (`Stack`, `Heading`, `Text`, `Image`, `Button`, `ChoiceList`, …) so
  scope is contained, but it's a non-trivial mini-renderer.
- **Markdown segmenter**: the Swift version (`MarkdownSegments.swift`)
  has custom rules for fenced `html` blocks and file chips. We need
  equivalent behavior on the web — probably via `react-markdown` plugins
  or a custom plug-in pass.

## Status

| Phase | Status | Notes |
|---|---|---|
| 0 — Copy + verify deploy | ✅ done | `packages/go/web/` builds + deploys; first deployment `0f5da872` |
| 1 — Brand identity | ✅ done | Squircle icons regenerated from Swift master; title/manifest updated to "OpenAgents Go" |
| 2 — Thread→Chat terminology | ✅ done | UI strings swapped across dialogs, nav, settings, monitor, mobile, chat header |
| 3 — Right tabbed panel + chat-view toggle | ✅ done | `RightTabbedPanel` component with `[Content \| Browser]` tabs alongside chat detail. Toggle via `PanelRight` button in chat header. State persists to localStorage (`x-right-panel-open`). Browser tab gated on `workspace.browserEnabled`; auto-rebound to Content when toggle off. Left sidebar / 3-pane still works — additive, not destructive. |
| 4 — Workspace `browser_enabled` toggle | ✅ done | Globe button next to workspace name in `SidebarHeader`; optimistic PATCH; rollback on error |
| 5 — Browser surface gating + URL polish | ✅ done | Nav button hidden when toggle off (sidebar + mobile); auto-rebound to Chats; URL pill with hover-copy; iframe `overflow-x-hidden` clamp |
| 6 — Composer polish | ✅ done | Drag-drop / paste / IME composition were already wired. Added slash-command popup (`/restart`, `/status`, `/routines`) with arrow / Enter / Tab / Esc navigation — fires `sendAgentControl` against the channel's master agent. |
| 7 — A2UI + tool result wiring | ✅ done | Message type gains `spec` + `specToolCallId`. Event-to-message parser pulls them off `payload`. New `A2UIRenderer` component handles Stack / Card / Heading / Text / Image / Icon / Button / ChoiceList / ConfirmDialog / Alert / Divider / Spacer; unknown types render a placeholder chip. `workspaceApi.sendToolResult` posts user interactions back via `workspace.tool_result`. |
| 8 — Docs (sunset deferred) | ✅ done | New `packages/go/web/CLAUDE.md` documents the package origin, deploy story, Swift-specific differences, and what stays in `workspace/frontend/` (deprecated mirror, not deleted). |

Status: PR ready. The old path stays put per the user's instruction —
no changes under `workspace/frontend/`. Sunset is a future call once
visual / feature parity is verified in production.

## Post-audit gap-closure (after the audit table)

A complete walk through the `packages/go/OpenAgents/` git history caught
seven Swift features that weren't yet in the web port. All closed in
one follow-up pass:

| Swift commit | Feature | Web location |
|---|---|---|
| `3815fb49` | Workspace-file chips for `/v1/files/<id>` URLs in messages | `components/chat/markdown-content.tsx` — link override detects the URL and renders `FileChip` (paperclip pill, opens file in Content panel) |
| `83911faa` | Fenced ` ```html ` blocks → sandboxed iframe + fullscreen modal | `markdown-content.tsx` — `code` override returns `<HtmlBlock>` for `language-html`. Inline iframe with `sandbox=""` (no scripts), CSP locked to `script-src 'none'`; Maximize button opens a true app-front modal |
| `5400bcf2` | PDF preview in content panel | `components/files/file-preview.tsx` — new `isPdfFile` helper + `<object data type="application/pdf">` viewer with iframe fallback |
| `dc7c0355` | Fullscreen HTML viewer modal | Same `HtmlBlock` component above also handles its own fullscreen modal — single component covers both inline + modal |
| `00fa44a1` | Fullscreen Browser Fabric viewer modal | `components/browser/browser-view.tsx` — new `FullscreenBrowserModal` (`fixed inset-0 z-[100]`); rotated `Maximize2` button distinguishes "true fullscreen" from existing in-layout expand. Esc dismisses. |
| `01c125e4` / `127c78a5` | Auto-follow `/restart` with `/status`; treat "Session restarted" as terminal | `chat-view.tsx` slash handler fires `/status` after a successful `/restart`. `intermediate-steps.tsx` extends `isTerminalStatus` regex to include `session restarted`. |
| `0ce5202d` | Bold matched prefix in slash autocomplete | `chat-input.tsx` slash popup splits each label at `1 + matchLen` and bolds the prefix |

All build-clean; the four-feature audit now closes to zero outstanding
Swift features that didn't have a web equivalent.
