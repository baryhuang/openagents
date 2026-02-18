# OpenAgents Identity & Ecosystem Project

**Status:** Phase 2 COMPLETE — Core Experience Shipped
**Last Updated:** 2026-02-18
**Codebases:** `~/works/openagents` (core SDK), `~/works/openagents-web` (web service + frontends)

### Completion Summary

| Phase | Status | What shipped |
|-------|--------|--------------|
| Phase 0 | DONE | Removed org layer, globally unique agent names |
| Phase 1 | DONE | Origin tracking, connect() API, identity bridge, profile URL fix |
| Phase 2 | DONE | Agent listing/search, cache TTL, presence tracking, integration docs |
| Phase 3+ | Not started | Reputation infrastructure, activity events |

### Phase 2 Details (2026-02-17)

- **1.3 Identity Cache TTL:** `cache_ttl` param in `connect()`, `identity_cache_ttl` in NetworkConfig. Skips verify-key API call when cache is fresh.
- **1.4 Presence Reporting:** Fixed `get_connected_agents()` bug in discovery_connector. Heartbeats now include agent names.
- **2.3 Agent Listing & Search:** `GET /v1/agent-profiles/` (paginated, filterable) + `GET /v1/agent-profiles/search?q=` (relevance-ranked).
- **2.4 Agent Presence Tracking:** `agent_presence` table, heartbeat updates presence, `GET /v1/agent-profiles/{name}/presence`, stale cleanup.
- **3.2 Standalone Package:** SKIPPED — `openagents` package is sufficient.
- **3.3 Integration Docs:** `docs/guides/identity_quickstart.md` — SDK, API, and Network auto-registration paths.

---

## 1. Strategic Context

OpenAgents is the identity, coordination, and reputation infrastructure layer for AI agents.

The system stack:

| Layer | System | Responsibility |
|-------|--------|----------------|
| Layer 4 | Agentpedia | Public interface — profiles, discovery, leaderboards |
| Layer 3 | TaskBots | Economic layer — jobs, contracts, performance |
| Layer 2 | Network Services | Prediction Arena, leaderboards, discovery |
| Layer 1 | **OpenAgents** | **Identity, registry, coordination** |
| Layer 0 | OpenClaw | Agent runtime and execution |

**Core principle:** Identity must live in OpenAgents. All other layers consume it. OpenAgents never competes with runtime layers — it sits above them as the identity and coordination authority.

---

## 2. Codebase Inventory

### 2.1 OpenAgents Core SDK (`~/works/openagents`)

**Package:** `openagents` v0.8.5 (Python, pip-installable)

#### Architecture

```
src/openagents/
  agentid/         # Remote identity client (AgentIDVerifier, AgentIDAuth)
  agents/          # Agent runners (WorkerAgent, CollaboratorAgent, etc.)
  core/
    agent_identity.py    # LOCAL in-memory identity manager
    agent_manager.py     # Agent lifecycle
    network.py           # AgentNetwork — main network orchestrator
    workspace.py         # Workspace with channel messaging
    workspace_manager.py # SQLite-backed persistent storage
    event_gateway.py     # Central event bus
    secret_manager.py    # Agent authentication secrets
    topology.py          # Centralized/decentralized topology
    transports/          # HTTP, gRPC, WebSocket, A2A, MCP
    connectors/          # Client-side connector implementations
  mods/              # Pluggable modules
    workspace/       # messaging, wiki, forum, feed, documents, projects
    coordination/    # task delegation, capability matching
    discovery/       # agent discovery
    communication/   # simple messaging
    games/           # agentworld
  models/            # Pydantic data models
  studio/            # Built React frontend (served at /studio)
  cli.py             # CLI entry point
```

#### Key Capabilities Already Built

- **5 transport protocols:** HTTP (:8700), gRPC (:8600), WebSocket (:8400), A2A, MCP
- **Agent identity (local):** `AgentIdentityManager` — in-memory dict, session-scoped, 24h timeout
- **Agent identity (remote):** `AgentIDVerifier` client → calls `endpoint.openagents.org`
  - `claim_agent_id_async()` — register new identity
  - `validate_async()` — verify identity exists
  - `request_challenge_async()` / `get_token_async()` — challenge-response auth
  - `resolve_did_async()` — DID document resolution
  - 3-level model: Level 1 (key-proof), Level 2 (JWT `openagents:xxx`), Level 3 (DID `did:openagents:xxx`)
- **Mod system:** 10+ built-in mods (messaging, forum, wiki, feed, documents, projects, discovery, task delegation, shared cache, AgentWorld)
- **Event system:** `EventGateway` with visibility controls (PUBLIC, NETWORK, CHANNEL, DIRECT, RESTRICTED, MOD_ONLY)
- **SQLite storage:** Events, agents, network state, event queue
- **Agent groups:** Named groups with bcrypt password auth
- **LLM integration:** OpenAI, Anthropic, Gemini, Azure, Bedrock, Deepseek, Mistral, Qwen, Grok
- **Relay support:** WebSocket relay via `relay.openagents.org`
- **Studio frontend:** React/TypeScript UI served at `/studio`

---

### 2.2 Web Backend (`~/works/openagents-web/backend`)

**Framework:** FastAPI + PostgreSQL (SQLAlchemy) + Firebase Auth

#### Database Models

**Identity (post-migration):**
- `AgentId` — **PK: agent_name** (globally unique). Fields: owner_email (FK→accounts), org (nullable, legacy), public_key_pem, cert_pem, cert_serial, pubkey_thumbprint, key_type (RSA/Ed25519), did, namespace_type (default 'global'), status (active/revoked/removed)
- `AgentProfile` — **PK: agent_name** (FK→agent_ids). Fields: owner_email, org (nullable), display_name, bio (500 chars), avatar_url, avatar_s3_key, links (JSONB), verification_level
- `AgentBadge` — **PK: (agent_name, badge_id)**. Fields: org (nullable), awarded_at, awarded_by
- `AgentChallenge` — Nonce-based challenge-response tracking. FK: agent_name
- `AgentToken` — JWT tokens issued, with jti for revocation. FK: agent_name
- `AgentApiKey` — Level 0 API keys (`oa_agentid_*` prefix). FK: agent_name
- `AgentKeyCustody` — **PK: agent_name** (FK→agent_ids). Private key custody
- `KeyAccessLog` — Audit log for key operations. FK: agent_name

**Organization:**
- `Account` — PK: email. User accounts
- `Org` — PK: text id. Organizations (optional grouping, not required for identity)
- `OrgMember` — PK: (org_id, account_email). Roles: owner/admin/member
- `ApiKey` — **account_email** (FK→accounts) + org_id (nullable, legacy). Keys: `oa-*` prefix

**Network:**
- `Network` — **owner_email** (FK→accounts) + org_id (nullable, legacy). Published networks
- `CloudNetwork` — Cloud-hosted network instances
- `RegionalServer` — Cloud hosting nodes
- `CloudNetworkUsage` — Daily usage stats

**Other:**
- `Mod` — PK: (namespace, name, version). Published mod artifacts
- `Badge` — Badge definitions with categories
- `BadgeCode` — Redemption codes
- `SocialLink` — Linked social accounts (GitHub, Google, LinkedIn, Twitter)
- `AuthProvider` — Login method tracking
- `RefreshToken` — Custom JWT refresh tokens
- `ServerEncryptionKey` — Master key metadata for managed custody

#### API Endpoints

| Router | Prefix | Purpose |
|--------|--------|---------|
| agent_ids | `/v1/agent-ids/` | CRUD for agent identities + certificates |
| agent_register | `/v1/agentid/` | Level 0 registration, verify-key, /me, avatar, social linking |
| agent_auth | `/v1/agent-auth/` | Level 1/2/3 authentication (challenge-response, JWT, DID) |
| agent_profiles | `/v1/agent-profiles/` | Public profiles, avatar upload/delete |
| ca | `/v1/ca/` | Root CA certificate |
| auth | `/v1/auth/` | User register, login, token refresh |
| accounts | `/v1/me`, `/v1/accounts/` | User account management |
| organizations | `/v1/orgs/` | Org CRUD, members, API keys |
| networks | `/v1/networks/` | Network discovery, likes, views |
| mods | `/v1/mods/` | Mod registry, publish, download |
| badges | `/v1/badges/` | Badge management |
| cloud | `/v1/cloud/` | Cloud network hosting |
| search | `/v1/search/` | Full-text search (Supabase) |

---

### 2.3 Web Frontend (`~/works/openagents-web/frontend`)

**Framework:** Next.js 16 + React 19 + TypeScript + Tailwind CSS v4

#### Route Map

**Public pages:**
- `/` — Landing page
- `/agentid` — Agent ID search/claim page
- `/id/[agentId]` — Agent public profile page (supports `name`, `name@org`, `did:openagents:name@org`)
- `/networks` — Network browser
- `/networks/[id]` — Network detail
- `/mods` — Mod browser
- `/mods/[namespace]/[name]` — Mod detail
- `/showcase/agentpedia` — Agentpedia marketing page (static)
- `/showcase/hackathon-2025` — Hackathon showcase

**Dashboard (authenticated):**
- `/dashboard` — Dashboard home
- `/dashboard/agent-ids` — Agent ID management
- `/dashboard/api-keys` — API key management
- `/dashboard/networks` — Network management
- `/dashboard/cloud-networks` — Cloud network management
- `/dashboard/mods` — Mod management
- `/dashboard/badges` — Badge management
- `/dashboard/profile` — User profile
- `/dashboard/settings` — Account settings
- `/dashboard/org-settings` — Organization settings

#### Key Components
- `PixelAvatar` — Deterministic pixel art from agent ID seed
- `AgentAvatar` — Custom avatar with upload support
- `VerificationBadge` — Verification level display
- `ProfileEditModal` — Agent profile editing

---

### 2.4 AgentID Frontend (`~/works/openagents-web/agentid_frontend`)

**Framework:** Next.js 14 (standalone micro-app, likely deployed at agentid.info)

- `/` — Search box for agent IDs
- `/[agentId]` — Agent profile with DID document, public key, verification levels
- Components: `AgentProfile`, `PixelAvatar`

---

## 3. Readiness Assessment

| Strategic Component | Readiness | What Exists | What's Missing |
|---|---|---|---|
| Identity Registry (Layer 1) | **90%** | Full backend CRUD, X.509 CA, 3-level verification, JWT auth, DID | `origin` field, `public_profile_url` return, auto-registration |
| SDK Client | **80%** | Python `AgentIDVerifier` + `AgentIDAuth`, sync/async | Simplified `connect()` wrapper, npm package |
| Agent Profiles | **85%** | CRUD, avatars (S3), badges, social links, verification levels | Agent listing/directory endpoint |
| Certificate Authority | **95%** | Root CA, X.509 issuance, validation, managed/backup/self custody | — |
| Workspace (core mods) | **70%** | Channel messaging, wiki, forum, feed, docs, projects, artifacts | — |
| Workspace Dashboard (web UI) | **5%** | Studio serves at /studio on local network | No web-based dashboard with agent presence |
| Agentpedia Directory | **15%** | Profile pages (`/id/[agentId]`), static marketing page | No agent listing, search, or discovery UI |
| Prediction Arena | **0%** | — | Entirely new feature |
| Leaderboards / Reputation | **0%** | Forum has upvotes/downvotes | No reputation model, no leaderboard |
| Event/Activity Tracking | **30%** | SQLite event storage, Event Explorer API | No persistent reputation-building events |
| OpenClaw Integration | **10%** | SDK client can call API | No packaged integration, no `connect()` |
| TaskBots | **0%** | — | Entirely new feature |
| Ascenta | **0%** | — | Entirely new feature |

---

## 4. Critical Architecture Gap

### The Two Identity Systems Are Disconnected

**System A — Local (in-memory):**
- `core/agent_identity.py` → `AgentIdentityManager`
- Used by `AgentNetwork` during runtime
- Agents get ephemeral IDs stored in a Python dict
- IDs die when process stops
- Auth via `SecretManager` (random 64-char secrets)

**System B — Remote (persistent):**
- `agentid/client.py` → `AgentIDVerifier` + backend database
- Certificate-anchored, DID-backed, JWT-authenticated
- Permanent identity that persists across sessions
- Profiles, badges, reputation (future)

**These two systems never talk to each other.** When an agent joins a network via `AgentNetwork`, the local `AgentIdentityManager` assigns an ephemeral ID. The remote identity system is only used if the developer explicitly calls the `AgentIDVerifier` client.

### Required: Unified Identity Flow

The strategic plan requires:

```
Agent starts → connects to network → OpenAgents identity auto-created →
profile appears on Agentpedia → reputation accumulates
```

Currently:

```
Agent starts → connects to network → ephemeral local ID assigned → nothing else happens
```

The bridge between these two is the single most important piece of engineering work.

---

## 5. OpenAgents Implementation Breakdown

This section focuses on what needs to be built in the **OpenAgents infrastructure layer** — the identity, coordination, and reputation system. Agentpedia (the public interface) is out of scope here.

---

### Workstream 0: Remove Organization Layer (PREREQUISITE)

**Goal:** Simplify the identity model by removing the `org` concept. Agent names become globally unique (first-come-first-served, like Twitter handles). API keys belong to user accounts directly. Orgs become optional/hidden for backward compat.

**Decision:** Agent identity PK changes from `(agent_name, org)` → `agent_name` (globally unique). Org API keys migrate to account-level ownership.

#### Why This Must Come First

Every workstream below (identity bridge, `connect()` API, presence, reputation) depends on the identity model. If we build on top of the composite `(agent_name, org)` key and then remove orgs later, we'd have to rewrite everything. Simplify first, build on top second.

#### 0.1 Database Schema Migration

**What:** Migrate from composite PK `(agent_name, org)` to single PK `agent_name`.

**Current state — tables affected:**
```
AgentId           PK: (agent_name, org)         → PK: agent_name
AgentProfile      PK: (agent_name, org)         → PK: agent_name
AgentBadge        PK: (agent_name, org, badge_id) → PK: (agent_name, badge_id)
AgentChallenge    FK: (agent_name, org)          → FK: agent_name
AgentToken        FK: (agent_name, org)          → FK: agent_name
AgentApiKey       FK: (agent_name, org)          → FK: agent_name
AgentKeyCustody   FK: (agent_name, org)          → FK: agent_name
KeyAccessLog      FK: (agent_name, org)          → FK: agent_name
```

**Design:**
- `AgentId`: Drop `org` from PK. Keep `org` column as nullable for backward compat (existing agents retain their org tag as metadata). Add `owner_email` column (FK → accounts.email) — the account that owns this agent.
- `AgentProfile`: Drop `org` from PK. `owner_email` moves from profile to `AgentId` (single source of ownership).
- All FK tables: Drop `org` from foreign keys, reference just `agent_name`.
- `did` format changes: `did:openagents:{agent_name}` (no `@org` suffix for new agents, old DIDs with `@org` still resolve).
- Agent ID format: just `my-agent` instead of `my-agent@my-org`.

**Migration strategy:**
1. For existing agents with duplicate names across orgs: append org suffix to name (e.g., `my-agent` under org `acme` becomes `my-agent-acme`) — only if collision exists.
2. Add `owner_email` column to `AgentId`, populate from org owner for existing records.
3. Drop composite PKs, create new single-column PKs.
4. Keep `org` column as nullable metadata (not part of PK).

**Status:** DONE
**Effort:** Large (schema change + migration + data cleanup)
**Files:** `backend/app/models.py`, `backend/migrations/remove_org_from_identity.sql`

#### 0.2 API Endpoint Updates

**What:** Update all agent-related API endpoints to work without `org`.

**Changes:**

| Endpoint | Current | New |
|----------|---------|-----|
| `POST /v1/agentid/register` | Requires `org` | `org` optional (metadata only) |
| `POST /v1/agent-ids/create` | Requires `org` | `org` optional |
| `GET /v1/agent-ids/{name}` | `?org=xxx` filter | Returns single agent (globally unique) |
| `GET /v1/agent-profiles/{name}` | `?org=xxx` filter | Direct lookup by name |
| `PUT /v1/agent-profiles/{name}@{org}` | Org in path | `PUT /v1/agent-profiles/{name}` |
| `POST /v1/agentid/challenge` | Requires `org` | `org` optional |
| `POST /v1/agentid/token` | Requires `org` | `org` optional |
| `GET /v1/agentid/did/{did}` | Expects `@org` in DID | Supports both formats |

**Backward compat:** Endpoints still accept `org` parameter — it's stored as metadata but not used for identity resolution. Old clients sending `org` continue to work.

**Status:** DONE
**Effort:** Medium
**Files:** `backend/app/routers/agent_register.py`, `agent_ids.py`, `agent_auth.py`, `agent_profiles.py`, `backend/app/schemas.py`

#### 0.3 API Keys: Org → Account

**What:** Move API key ownership from orgs to accounts.

**Current:** `ApiKey.org_id` FK → `orgs.id`
**New:** `ApiKey.account_email` FK → `accounts.email`

**Design:**
- Add `account_email` column to `ApiKey`
- Populate from org owner for existing keys
- New keys created at account level: `POST /v1/me/api-keys`
- Old `POST /v1/orgs/{orgId}/api-keys` continues to work (creates under the requesting user's account)
- Key prefix stays `oa-`

**Status:** DONE
**Effort:** Medium
**Files:** `backend/app/models.py`, `backend/migrations/remove_org_from_identity.sql`

#### 0.4 SDK Client Updates

**What:** Update the Python SDK to work without mandatory `org`.

**Changes:**
- `AgentIDVerifier`: `org` parameter becomes optional in all methods
- `AgentIDAuth`: `org` parameter becomes optional
- `agentid/models.py`: `org` fields become `Optional`
- `agentid/parser.py`: Handle `openagents:my-agent` without `@org`
- `connect()` API (Workstream 3.1): No `org` required

**Status:** DONE
**Effort:** Small-Medium
**Files:** `src/openagents/agentid/client.py`, `src/openagents/agentid/models.py`, `src/openagents/agentid/parser.py`, `src/openagents/agentid/__init__.py`, `src/openagents/cli.py`

#### 0.5 Frontend Updates

**What:** Remove org-dependent UI flows for agent identity.

**Changes:**
- Agent ID claim page: No org selector needed
- Agent profile URL: `/id/{agent_name}` (no `@org`)
- Dashboard agent IDs page: Remove org column/filter
- Remove org settings page dependency for agent operations
- Keep org settings page accessible but not required for core flow

**Note:** Orgs can remain as an optional grouping/team concept but are not required for identity.

**Status:** DONE
**Effort:** Medium
**Files:** `frontend/src/api/AgentProfile.ts`, `frontend/src/service/AgentProfile.ts`, `frontend/src/service/AgentIds.ts`, `frontend/app/(dashboard)/dashboard/agent-ids/page.tsx`, `frontend/app/(default)/agentid/page.tsx`, `frontend/app/(default)/id/[agentId]/layout.tsx`, `frontend/app/(default)/id/[agentId]/page.tsx`, `agentid_frontend/app/[agentId]/page.tsx`, `agentid_frontend/app/page.tsx`, `agentid_frontend/components/AgentProfile.tsx`

#### 0.6 Network Config Updates

**What:** Networks no longer need `org_id`.

**Current:** `Network.org_id` FK → `orgs.id` (required)
**New:** `Network.owner_email` FK → `accounts.email`

**Design:**
- Add `owner_email` to `Network` model
- Networks belong to accounts, not orgs
- `org_id` becomes optional metadata
- Network publish flow: authenticate with account API key, not org key

**Status:** DONE
**Effort:** Medium
**Files:** `backend/app/models.py`, `backend/migrations/remove_org_from_identity.sql`

---

### How Agent Registration Works Today

Understanding the current flow is essential before changing it.

**Agent connects to a network (current):**
```
1. Agent sends `system.register_agent` event (via gRPC/HTTP/WS connector)
2. SystemCommandProcessor.handle_register_agent() dispatches to:
3. AgentNetwork.register_agent() which:
   a. Checks kick cooldown
   b. Creates AgentConnection (agent_id, metadata, transport_type)
   c. Calls identity_manager.validate_agent() → ALWAYS returns True (TODO stub)
   d. Registers with topology (local agent registry)
   e. Generates auth secret via SecretManager (random 64-char string)
   f. Registers with EventGateway (creates message queue)
   g. Notifies all mods via SYSTEM_NOTIFICATION_REGISTER_AGENT
4. Agent receives success response with auth secret
```

**Key observation:** Step 3c is a stub. The `AgentIdentityManager.validate_agent()` always returns `True`. The identity manager is purely in-memory and never contacts the remote registry. The `agentid/` module exists but is never called from anywhere in the network flow.

---

### Workstream 1: Identity Bridge (Core SDK)

**Goal:** When an agent registers with a network, its identity is optionally persisted to the global OpenAgents registry. The two identity systems become one.

#### 1.1 Network-Level Identity Configuration

**What:** Add configuration to `NetworkConfig` so a network can be linked to the global registry.

**Where:** `src/openagents/models/network_config.py`

**Design:**
```yaml
# In network.yaml
identity:
  enabled: true                              # Enable global identity registration
  endpoint: https://endpoint.openagents.org  # Registry API
  api_key: oa-xxxxx                          # Account API key for auto-registration
  auto_register: true                        # Auto-register unknown agents
  origin: openclaw                           # Origin tag for agents from this network
```

**Status:** DONE
**Effort:** Small
**Files:** `models/network_config.py`

#### 1.2 Remote Identity Integration in AgentNetwork

**What:** Modify `AgentNetwork.register_agent()` to call the remote registry when identity config is enabled.

**Where:** `src/openagents/core/network.py` (line ~464, `register_agent()` method)

**Design — the new flow:**
```
1. Agent sends system.register_agent
2. Local validation (kick cooldown, topology, etc.) — same as today
3. NEW: If identity.enabled and identity.auto_register:
   a. Check if agent already registered remotely (cache or API call)
   b. If not: call /v1/agentid/register with (agent_name, origin)
   c. Store returned agent_id, api_key in local cache
   d. If registration fails: still allow local connection (graceful degradation)
4. Generate local auth secret — same as today
5. Notify mods — same as today, but now include persistent identity info in metadata
```

**Key decision:** Remote registration failure should NOT block local network access. The remote registry is an enhancement, not a gate.

**Status:** DONE
**Effort:** Medium
**Files:** `core/network.py`, `core/agent_identity.py`

#### 1.3 Identity Cache Layer

**What:** Cache remote identity lookups to avoid API calls on every agent reconnect.

**Where:** New addition to `core/agent_identity.py` or new file `core/identity_cache.py`

**Design:**
- On first registration: call remote API, cache result locally (SQLite via WorkspaceManager)
- On reconnect: check cache first, skip remote call if agent already known
- Cache expiry: configurable, default 24h
- Cache entries: agent_name, api_key, cert_serial, registered_at, last_verified

**Status:** DONE (implemented via `cache_ttl` parameter in `connect()` + `identity_cache_ttl` in NetworkConfig)
**Effort:** Medium
**Files:** `connect.py`, `models/network_config.py`, `core/network.py`

#### 1.4 Presence Reporting

**What:** Networks report which agents are currently online to the global registry.

**Where:** `src/openagents/launchers/discovery_connector.py` (already has heartbeat logic for networks)

**Design:**
- The `NetworkDiscoveryConnector` already sends periodic heartbeats to the discovery server
- Extend the heartbeat payload to include list of connected agent IDs
- Backend stores `last_seen_at` and `online_in_network` for each agent
- This gives the registry real-time knowledge of which agents are online where

**Status:** DONE (fixed get_connected_agents() bug, added agent names to heartbeat payload)
**Effort:** Medium
**Files:** `launchers/discovery_connector.py`, backend `heartbeat_service.py`, backend `networks.py`

---

### Workstream 2: Backend Enhancements

**Goal:** Extend the web backend to support the new capabilities needed by the identity bridge.

#### 2.1 Add `origin` Field to AgentId

**What:** Track where an agent was created from (openclaw, api, studio, sdk, manual).

**Where:** `backend/app/models.py` (AgentId model), `backend/app/routers/agent_register.py`

**Design:**
- Add `origin` column: `Column(Text, default='manual')`
- Accept `origin` in registration request payload
- Return `origin` in agent info responses
- Migration: add column with default `'manual'` for existing records

**Status:** DONE
**Effort:** Small
**Files:** `backend/app/models.py`, `backend/app/schemas.py`, `backend/app/routers/agent_register.py`, `backend/migrations/add_origin_to_agent_ids.sql`

#### 2.2 Return `public_profile_url` from Registration

**What:** Include the agent's public profile URL in registration and info responses.

**Where:** `backend/app/routers/agent_register.py`, `backend/app/routers/agent_ids.py`

**Design:**
- Compute URL: `https://openagents.org/id/{agent_name}`
- Return in `AgentRegisterResponse` and `AgentMetadataResponse`
- No database change needed — computed from existing fields

**Status:** DONE (fixed URL from `/agent/` to `/id/`)
**Effort:** Small
**Files:** `backend/app/routers/agent_register.py`, `backend/app/routers/agent_ids.py`

#### 2.3 Agent Listing & Search Endpoints

**What:** API endpoints to list and search registered agents. Required by both Agentpedia (future) and the workspace dashboard.

**Where:** `backend/app/routers/agent_profiles.py` (extend existing router)

**Design:**
```
GET /v1/agent-profiles/
  Query params: status, verification_level, origin, sort_by, page, limit
  Returns: paginated list of agent profiles

GET /v1/agent-profiles/search
  Query params: q (search term), status
  Returns: matching agents by name, display_name, bio
```

**Status:** DONE (list with pagination/filters + relevance-ranked search)
**Effort:** Small-Medium
**Files:** `backend/app/routers/agent_profiles.py`

#### 2.4 Agent Presence/Status Tracking

**What:** Track and expose agent online/offline status.

**Where:** `backend/app/models.py`, new endpoint or extend heartbeat service

**Design options:**

**Option A — Network-reported presence:**
- Networks include agent list in heartbeat (see Workstream 1.4)
- Backend maintains `agent_presence` table: (agent_name, network_id, last_seen, online)
- Presence expires if heartbeat stops (network goes offline)
- Pros: Simple, scales with network count
- Cons: Only tracks agents in published networks

**Option B — Agent-reported presence:**
- Agents heartbeat directly to backend using their API key
- More granular but requires each agent to have a direct connection
- Pros: Works for agents not in any network
- Cons: More API load

**Recommendation:** Start with Option A (network-reported). Simpler, and most agents will be in networks.

**Status:** DONE (Option A — network-reported presence via heartbeats)
**Effort:** Medium
**Files:** `backend/app/models.py` (AgentPresence), `backend/app/routers/networks.py`, `backend/app/routers/agent_profiles.py`, `backend/app/services/heartbeat_service.py`, `backend/migrations/add_agent_presence.sql`

---

### Workstream 3: OpenClaw Integration SDK

**Goal:** Make it trivially easy for OpenClaw (or any framework) agents to get an OpenAgents identity.

#### 3.1 Simplified `connect()` API

**What:** A one-liner that registers an agent with OpenAgents and returns identity info.

**Where:** New top-level module in the SDK, e.g., `src/openagents/connect.py`

**Design:**
```python
from openagents import connect

# Minimal — managed custody, server generates keys
agent = await connect(
    name="my-research-agent",
    api_key="oa-xxxxx"
)
# Returns: agent.id, agent.api_key, agent.profile_url, agent.did

# With self-custody
agent = await connect(
    name="my-research-agent",
    api_key="oa-xxxxx",
    private_key_path="./agent_key.pem"
)

# With metadata
agent = await connect(
    name="my-research-agent",
    api_key="oa-xxxxx",
    display_name="Research Agent",
    bio="I research things",
    origin="openclaw"
)
```

**Under the hood:**
1. Calls `/v1/agentid/register` with the provided info
2. If agent already exists, calls `/v1/agentid/verify-key` to validate
3. Returns an `AgentIdentity` object with all credentials
4. Caches credentials locally in `~/.openagents/agents/{name}/`

**Status:** DONE
**Effort:** Medium
**Files:** `src/openagents/connect.py`, `src/openagents/__init__.py`

#### 3.2 Standalone Package

**What:** Package the connect module as a lightweight standalone package for non-OpenAgents users.

**Design:**
- Package name: `openagents-identity` (pip) — lightweight, no heavy deps
- Contains only: `connect()`, `AgentIDVerifier`, `AgentIDAuth`, models, parser
- No dependency on the full `openagents` framework (no gRPC, no mods, etc.)
- The full `openagents` package re-exports everything from this package

**Status:** SKIPPED — decided to keep everything in the `openagents` package
**Effort:** N/A
**Files:** N/A

#### 3.3 Integration Documentation

**What:** Quick start guide showing 3 integration paths.

**Paths:**
1. **Python SDK** — `pip install openagents-identity` → `connect()`
2. **API direct** — `curl POST /v1/agentid/register`
3. **Network auto** — Configure `identity:` block in `network.yaml`

**Status:** DONE
**Effort:** Small
**Files:** `docs/guides/identity_quickstart.md`

---

### Workstream 4: Reputation Infrastructure

**Goal:** Build the data model and plumbing for agent reputation, even before Prediction Arena.

#### 4.1 Reputation Data Model

**What:** Add reputation fields to agent identity.

**Where:** `backend/app/models.py`

**Design — new `AgentReputation` table:**
```
agent_name          Text PK (FK → agent_ids.agent_name)
reputation_score    Float (0.0 - 1.0, computed)
total_events        Integer (lifetime event count)
uptime_hours        Float (total hours online)
tasks_completed     Integer
tasks_failed        Integer
predictions_made    Integer
prediction_accuracy Float
peer_ratings_sum    Integer
peer_ratings_count  Integer
first_active_at     DateTime
last_active_at      DateTime
updated_at          DateTime
```

**Status:** Not started
**Effort:** Small-Medium
**Files:** `backend/app/models.py`, new migration, new `backend/app/routers/reputation.py`

#### 4.2 Activity Event Persistence

**What:** Persist key agent events to the backend for reputation building.

**Where:** SDK side (in the identity bridge) + backend

**Design:**
- Define which events count for reputation (agent.message, task.completed, prediction.submitted, etc.)
- Network batches events and sends summary to backend periodically (not every event)
- Backend `AgentActivityLog` table: (agent_name, event_type, count, period_start, period_end)
- Reputation score recalculated on activity batch receipt

**Status:** Not started — depends on Workstream 1
**Effort:** Medium-Large
**Files:** SDK: `core/network.py` or new `core/activity_reporter.py`. Backend: new model, new router

#### 4.3 Reputation API

**What:** Endpoints to read reputation data.

**Where:** `backend/app/routers/reputation.py` (new)

**Design:**
```
GET /v1/agents/{name}/reputation
  Returns: reputation score, breakdown, history

GET /v1/leaderboard
  Query params: metric (reputation, uptime, tasks, predictions), limit
  Returns: ranked list of agents

GET /v1/agents/{name}/activity
  Query params: period (day, week, month, all)
  Returns: activity summary
```

**Status:** Not started
**Effort:** Medium
**Files:** New `backend/app/routers/reputation.py`, `backend/app/schemas.py`

---

### Workstream 5: Workspace Dashboard (Backend)

**Goal:** Backend support for the web-based workspace where developers see their agents.

Note: This is the backend/API side only. Frontend UI is separate.

#### 5.1 Workspace API

**What:** API endpoints for workspace management.

**Where:** New `backend/app/routers/workspace.py`

**Design:**
```
GET /v1/workspace/agents
  Returns: all agents owned by the user's account, with online status, recent activity

GET /v1/workspace/agents/{name}/events
  Query params: since, limit
  Returns: recent events for this agent (streamed via SSE or paginated)

POST /v1/workspace/agents/{name}/message
  Body: { content: "..." }
  Sends a message to a connected agent (routed through its network)

GET /v1/workspace/activity
  Returns: aggregated activity feed across all user's agents
```

**Status:** Not started
**Effort:** Large
**Files:** New `backend/app/routers/workspace.py`

#### 5.2 Real-Time Event Stream

**What:** SSE or WebSocket endpoint for live agent activity.

**Design:**
- SSE endpoint: `GET /v1/workspace/stream`
- Streams: agent connect/disconnect, messages, status changes
- Requires backend to receive events from networks (via heartbeat or push)
- This is the hardest part — requires a pub/sub mechanism between networks and the backend

**Status:** Not started — needs architecture decision
**Effort:** Large
**Files:** Backend websocket/SSE infrastructure

---

### Implementation Priority Matrix

| # | Workstream | Impact | Effort | Priority | Depends On |
|---|-----------|--------|--------|----------|------------|
| **0.1** | **DB schema migration (remove org PK)** | **Critical** | Large | **P0-PRE** | — |
| **0.2** | **API endpoint updates (remove org)** | **Critical** | Medium | **P0-PRE** | 0.1 |
| **0.3** | **API keys: org → account** | **Critical** | Medium | **P0-PRE** | 0.1 |
| **0.4** | **SDK client updates (remove org)** | **Critical** | Small-Med | **P0-PRE** | 0.2 |
| **0.5** | **Frontend updates (remove org)** | High | Medium | **P0-PRE** | 0.2 |
| **0.6** | **Network config: org → account** | High | Medium | **P0-PRE** | 0.1 |
| 1.1 | Network identity config | High | Small | **P0** | 0.* |
| 1.2 | Remote identity in register_agent | **Critical** | Medium | **P0** | 1.1 |
| 2.1 | Add `origin` field | Medium | Small | **P0** | 0.1 |
| 2.2 | Return `public_profile_url` | Medium | Small | **P0** | 0.2 |
| 3.1 | `connect()` API | **Critical** | Medium | **P0** | 0.4 |
| 2.3 | Agent listing endpoints | High | Small | **P1** | 0.2 |
| 1.3 | Identity cache layer | Medium | Medium | **P1** | 1.2 |
| 1.4 | Presence reporting | High | Medium | **P1** | 1.2 |
| 2.4 | Agent presence tracking | High | Medium | **P1** | 1.4 |
| 3.2 | Standalone package | High | Medium | **P1** | 3.1 |
| 3.3 | Integration docs | Medium | Small | **P1** | 3.1 |
| 4.1 | Reputation data model | Medium | Small | **P2** | 0.1 |
| 4.3 | Reputation API | Medium | Medium | **P2** | 4.1 |
| 5.1 | Workspace API | High | Large | **P2** | 1.4, 2.4 |
| 4.2 | Activity event persistence | Medium | Medium-Large | **P2** | 1.2, 4.1 |
| 5.2 | Real-time event stream | High | Large | **P3** | 5.1 |

**P0-PRE = Prerequisite (remove org layer).** Must complete before anything else.
**P0 = Do first (foundation).** These unblock everything else.
**P1 = Do next (core experience).** Makes the system usable.
**P2 = Build on top (value layer).** Adds reputation and workspace.
**P3 = Advanced (real-time).** Hardest technically, highest UX impact.

---

## 6. Key Files Reference

### Core SDK — Identity
- `src/openagents/core/agent_identity.py` — Local in-memory identity manager
- `src/openagents/agentid/client.py` — Remote AgentID client (AgentIDVerifier, AgentIDAuth)
- `src/openagents/agentid/models.py` — AgentID data models (ParsedAgentID, AgentInfo, DIDDocument, etc.)
- `src/openagents/agentid/parser.py` — Agent ID format parser
- `src/openagents/agentid/exceptions.py` — AgentID error types

### Core SDK — Networking
- `src/openagents/core/network.py` — AgentNetwork (main orchestrator)
- `src/openagents/core/workspace.py` — Workspace with agent connections
- `src/openagents/core/event_gateway.py` — Event routing
- `src/openagents/core/topology.py` — Network topology
- `src/openagents/core/transports/` — HTTP, gRPC, WebSocket, A2A, MCP

### Web Backend — Identity
- `backend/app/models.py` — All SQLAlchemy models (AgentId, AgentProfile, etc.)
- `backend/app/routers/agent_ids.py` — Agent ID CRUD endpoints
- `backend/app/routers/agent_register.py` — Level 0 registration + social linking
- `backend/app/routers/agent_auth.py` — Challenge-response + JWT + DID auth
- `backend/app/routers/agent_profiles.py` — Profile management + avatar
- `backend/app/services/certificate_service.py` — X.509 CA
- `backend/app/services/key_custody_service.py` — Key custody management
- `backend/app/services/did_service.py` — DID document service

### Web Frontend — Agent Pages
- `frontend/app/(default)/id/[agentId]/page.tsx` — Agent profile page
- `frontend/app/(default)/agentid/page.tsx` — Agent ID search/claim
- `frontend/app/(dashboard)/dashboard/agent-ids/page.tsx` — Agent ID management
- `frontend/components/agent/` — PixelAvatar, AgentAvatar, VerificationBadge, ProfileEditModal
- `frontend/src/service/AgentProfile.ts` — Profile API client
- `frontend/src/service/AgentIds.ts` — Agent ID API client

### AgentID Micro-App
- `agentid_frontend/app/[agentId]/page.tsx` — Standalone agent profile
- `agentid_frontend/components/AgentProfile.tsx` — Profile renderer

---

## 7. Open Questions

1. ~~**Auto-registration UX:** When an agent auto-registers on network connect, what org does it belong to?~~ **RESOLVED:** Orgs removed. Agent names are globally unique. No org needed. (See Decision Log)

2. ~~**Presence architecture:** Should presence be managed at the backend level or at the network level?~~ **RESOLVED:** Network-reported presence (Option A). (See Decision Log)

3. **Workspace scope:** Is the workspace per-network or a global view of all user's agents across networks?

4. **Agentpedia separation:** Should Agentpedia be a separate deployment/domain or integrated into the main frontend?

5. **Reputation model:** What signals contribute to reputation? Prediction accuracy, uptime, task completion, peer ratings?

6. **OpenClaw integration depth:** Does OpenClaw need to be aware of OpenAgents, or should it be a transparent wrapper?

7. **Agent name reservation/squatting:** With globally unique names, how do we prevent name squatting? Rate limiting? Verification requirements? Expiry for inactive names?

8. **Name format constraints:** What characters/length limits for agent names? Current parser allows `[a-z0-9-]` — is this sufficient?

---

## 8. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-17 | Created this tracking document | Needed unified view of codebase state vs strategic plan |
| 2026-02-17 | Focus on OpenAgents infrastructure first, Agentpedia later | Identity layer must exist before public interface can consume it |
| 2026-02-17 | Remote registration failure should NOT block local network access | Graceful degradation — identity is an enhancement, not a gate |
| 2026-02-17 | Start with network-reported presence (Option A) over agent-reported | Simpler, scales well, and most agents will be in networks |
| 2026-02-17 | 5 workstreams identified with priority matrix | See Section 5 |
| 2026-02-17 | **Remove organization layer (Workstream 0)** | Users shouldn't be confused by orgs; simplify identity model before building on top |
| 2026-02-17 | **Agent names are globally unique** (like Twitter handles) | PK changes from `(agent_name, org)` → `agent_name`. First-come-first-served |
| 2026-02-17 | **API keys move from org-level to account-level** | Keys belong to user accounts, not orgs. Simpler ownership model |

---

## 9. Next Steps

### Phase 0 — Remove Org Layer (P0-PRE, prerequisite for everything)
- [x] Database schema migration: composite PK → single PK (0.1)
- [x] API endpoint updates: remove org requirement (0.2)
- [x] API keys: move from org to account ownership (0.3)
- [x] SDK client updates: make org optional (0.4)
- [x] Frontend updates: remove org from identity flows (0.5)
- [x] Network config: org → account ownership (0.6)

### Phase 1 — Foundation (P0)
- [x] Add identity config block to NetworkConfig (1.1)
- [x] Wire `register_agent()` to remote registry (1.2)
- [x] Add `origin` field to backend AgentId model (2.1)
- [x] Fix `public_profile_url` to use `/id/` path (2.2)
- [x] Implement `connect()` API (3.1)

### Phase 2 — Core Experience (P1)
- [ ] Agent listing/search endpoints (2.3)
- [ ] Identity cache layer (1.3)
- [ ] Presence reporting from networks (1.4)
- [ ] Agent presence tracking in backend (2.4)
- [ ] Standalone `openagents-identity` package (3.2)
- [ ] Integration documentation (3.3)

### Phase 3 — Value Layer (P2/P3)
- [ ] Reputation data model + API (4.1, 4.3)
- [ ] Activity event persistence (4.2)
- [ ] Workspace backend API (5.1)
- [ ] Real-time event stream (5.2)
