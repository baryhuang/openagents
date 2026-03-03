# OpenAgents Network Model

**A Network Model for the Internet of Agents**

Version 1.0

---

## 1. Introduction

OpenAgents Network defines how agents discover each other, communicate through events, and share resources within and across agent networks. It is the foundational model behind both the [OpenAgents SDK](https://github.com/OpenAgentsInc/openagents) and [OpenAgents Workspace](https://workspace.openagents.org).

### Goals

- **Unified architecture.** One model that governs both the open source SDK and the hosted Workspace product. Contributors build on the same abstractions regardless of which project they work on.
- **Simple by default, powerful when needed.** Connect an agent and start communicating in minutes. Add verification, permissions, mods, and cross-network federation when you need them.
- **Transport-agnostic.** Agents communicate through events. How those events travel over the wire (HTTP, WebSocket, gRPC, stdio) is a transport detail, not an architectural decision.
- **Open and extensible.** The model defines a small, stable core. Everything else — workspace features, custom tools, domain-specific behavior — is built as extensions on top of that core.

### Relationship Between Projects

| | OpenAgents SDK | OpenAgents Workspace |
|---|---|---|
| **What** | Open source runtime and SDK for agent networks | Managed product experience for agent collaboration |
| **For whom** | Developers building custom agent systems | Anyone who wants multi-agent collaboration now |
| **Effort** | High (code mods, configure topology, deploy) | Zero (connect agents, get a URL, start working) |
| **Flexibility** | Unlimited (custom mods, transports, federation) | Opinionated but extensible via the underlying network |
| **Relationship** | Implements the OpenAgents Network model directly | A product built on the same model with workspace-specific mods |

A Workspace IS an OpenAgents network. It runs the same event system with workspace-specific mods loaded (persistence, sessions, presence, auth) and exposes an HTTP transport for the web UI.

---

## 2. Core Concepts

The model has seven building blocks:

1. **Network** — the bounded context where agents communicate
2. **Addressing** — how entities are identified and located
3. **Verification** — how agent identity is proven
4. **Events** — the unit of communication
5. **Mods** — event pipeline interceptors for extensibility
6. **Resources** — shared tools, files, and context
7. **Transport** — how events move on the wire

---

## 3. Network

### Definition

A network is a bounded context where agents communicate through events. Events flow within a network by default. Crossing network boundaries requires explicit action.

### Properties

```
Network {
  id:              string        short, globally unique (e.g., "a1b2c3d4")
  name:            string        human-readable

  access: {
    policy:        open | token | invite | did-verify
    min_verification: 0 | 1 | 2 | 3
  }

  delivery:        at-least-once | at-most-once   (default: at-least-once)
  status:          active | paused | archived

  agents:          [Agent]       members
  mods:            [Mod]         ordered event pipeline
  channels:        [Channel]     named event streams
  groups:          [Group]       named collections of agents
  resources:       [Resource]    shared tools, files, context

  metadata:        {}            description, icon, tags, etc.
}
```

### Access Policies

| Policy | Description |
|---|---|
| `open` | Any agent can join without credentials |
| `token` | Agent must present a network-specific token to join |
| `invite` | An existing member must invite the agent |
| `did-verify` | Agent must present a verified DID to join |

The `min_verification` field sets the minimum verification level (0–3) an agent must have to join the network. See [Section 5: Verification](#5-verification).

### Membership

Every agent in a network has a membership record:

```
Membership {
  address:         string         agent's address in this network
  role:            string         master | member | observer
  verification:    0 | 1 | 2 | 3  agent's verified level
  status:          online | offline
}
```

Roles:

| Role | Description |
|---|---|
| `master` | Coordinator agent. Workspace-level concept — typically the first responder in a thread. |
| `member` | Regular participant. Can send and receive events. |
| `observer` | Can receive events but not emit. Read-only participation. |

### Boundaries

The key rule: **events don't leak.** An event emitted inside network A is never delivered to agents in network B unless an agent explicitly bridges them.

Cross-network communication happens when an agent that is a member of both networks routes events between them. See [Section 10: Cross-Network Communication](#10-cross-network-communication).

---

## 4. Addressing

### Unified Identifier

Every entity in the network has a single identifier that serves as both its routing address and its identity. There is no separate "address" and "ID" — they are the same thing.

### Entity Types

| Prefix | Entity | Example | Description |
|---|---|---|---|
| `agent:` | Local agent | `agent:charlie` | Network-scoped agent, not globally registered |
| `openagents:` | Global agent | `openagents:charlie123` | Globally registered agent with verified identity |
| `human:` | Human user | `human:raphael` | Human participant, network-local, not registrable as a global ID |
| `channel/` | Channel | `channel/general` | Named event stream (sessions, topics, rooms) |
| `mod/` | Mod | `mod/persistence` | Event pipeline interceptor |
| `group/` | Group | `group/team-alpha` | Named collection of agents |
| `resource/tool/` | Tool | `resource/tool/search_web` | Shared invocable tool |
| `resource/file/` | File | `resource/file/requirements.md` | Shared file |
| `resource/context/` | Context | `resource/context/project-brief` | Shared context or memory |
| `core` | Network | `core` | The network itself (reserved, always present) |

### Network Scoping

Addresses are local by default. The network scope is added explicitly for cross-network references.

```
Local (within current network):
  agent:charlie                       implied local::agent:charlie
  openagents:charlie123               implied local::openagents:charlie123
  channel/general                     implied local::channel/general
  mod/persistence                     implied local::mod/persistence

Explicit local:
  local::agent:charlie                same as agent:charlie
  local::openagents:charlie123        same as openagents:charlie123

Cross-network:
  network123::agent:charlie           agent:charlie in network "network123"
  network123::openagents:charlie123   openagents:charlie123 in network "network123"
  network123::channel/general         a channel in another network
```

### Shorthand

Within a network context, bare names resolve to agents:

```
charlie        →  agent:charlie
channel/general →  channel/general  (no ambiguity, slash indicates entity type)
```

### DID Mapping

Global agents (`openagents:{name}`) map directly to W3C DIDs:

```
openagents:charlie123  ←→  did:openagents:charlie123
```

The transformation is mechanical — prepend or strip `did:`. The agent name (`charlie123`) is the invariant across all representations.

Local agents (`agent:{name}`) and human users (`human:{name}`) do NOT have DID forms. They exist only within their network.

### URI Form

For external references, configuration files, and DID service endpoints, an `openagents://` URI form is available:

```
openagents://local/agent:charlie
openagents://local/openagents:charlie123
openagents://network123/agent:charlie
openagents://network123/openagents:charlie123
openagents://network123/mod/persistence
openagents://network123/channel/general
openagents://network123/resource/tool/search_web
```

The URI maps to the short form: `openagents://{network}/{entity}` ←→ `{network}::{entity}`.

### Special Addresses

| Address | Meaning |
|---|---|
| `core` | The network itself. Target for system operations (join, leave, discover, ping). |
| `agent:broadcast` | All agents and humans in the network. Used for broadcast events. |

### Parsing Rules

```
1. If "::" is present → split on first "::" → left is network, right is entity
2. If no "::" → network is "local" (implied), entire string is entity
3. Entity type determined by prefix:
   - "agent:" or "openagents:" or "human:" → agent/human (colon separator)
   - "channel/" or "mod/" or "group/" or "resource/" → structured entity (slash separator)
   - "core" → network system
   - bare string → defaults to agent:{string}
```

---

## 5. Verification

Agent identity has four verification levels. The level is a property of the agent's membership in a network — the same agent may have different verification levels in different networks.

### Level 0 — Anonymous

```
Address:    agent:{name} or human:{identifier}
Proof:      none
Trust:      network-local, operator trusts all participants
Use cases:  local development, ephemeral agents, human users, prototyping
```

The agent claims a name. The network accepts it without proof. Anyone could claim the same name in a different network. Level 0 identities have no meaning outside their home network.

### Level 1 — Key-Proof

```
Address:    agent:{name}
Proof:      challenge-response with private key
Trust:      network verified the agent controls a specific cryptographic key
Use cases:  private networks needing basic authentication
```

The network issues a challenge. The agent signs it with their private key. The network verifies the signature. This proves key ownership but does not issue a persistent credential.

### Level 2 — Token (JWT)

```
Address:    openagents:{name}
Proof:      signed JWT from the OpenAgents identity service
Trust:      centrally verified, portable across networks
Use cases:  production agents, cross-network identification
```

The agent has registered with the OpenAgents identity service and obtained a JWT token. The token carries the agent's name, verification level, and expiration. Other networks can verify the JWT without contacting the agent.

Supported signing algorithms: RS256 (RSA), Ed25519 (EdDSA), ES256 (ECDSA).

### Level 3 — DID (Decentralized Identity)

```
Address:    openagents:{name}  (resolvable as did:openagents:{name})
Proof:      W3C DID document with verification methods and service endpoints
Trust:      decentralized, self-sovereign, no dependency on a central service
Use cases:  maximum trust, federation, open ecosystems
```

The agent has a W3C-compliant DID document containing public keys, authentication methods, and service endpoints. Any party can resolve the DID and verify the agent's identity independently.

### Summary

| Level | Address Form | Proof | Scope | Registrable as OpenAgents ID |
|---|---|---|---|---|
| 0 | `agent:{name}` / `human:{id}` | None | Network-local | No |
| 1 | `agent:{name}` | Challenge-response | Network-local | No |
| 2 | `openagents:{name}` | JWT | Global | Yes |
| 3 | `openagents:{name}` | DID document | Global | Yes |

---

## 6. Events

### Definition

Every interaction in the network is an event. Events are the single unit of communication — there are no separate concepts for "messages," "commands," or "notifications." They are all events with different types.

### Event Envelope

```
Event {
  id:           string          unique identifier (ULID or UUID)
  type:         string          hierarchical, dot-separated
  source:       string          sender's address
  target:       string          recipient's address (NEVER null)
  payload:      any             the data (schema depends on type)
  metadata:     {}              protocol-level metadata
  timestamp:    integer         unix milliseconds
  network:      string          network ID where the event originated
}
```

Every event has a `target`. There are no null targets. If you want to broadcast, use `agent:broadcast`. If you want to talk to the network, use `core`. If you want to reach a channel, use `channel/{name}`.

### Event Types

Event types are hierarchical, dot-separated strings following a `{domain}.{entity}.{action}` convention.

#### Core Events (`network.*`)

Every implementation of the OpenAgents Network model must handle these:

**Agent lifecycle:**

| Event Type | Source | Target | Description |
|---|---|---|---|
| `network.agent.join` | joining agent | `core` | Agent requests to join the network |
| `network.agent.leave` | leaving agent | `core` | Agent announces departure |
| `network.agent.discover` | requesting agent | `core` | Agent asks "who's here?" |
| `network.agent.discover.response` | `core` | requesting agent | Network responds with roster |
| `network.agent.announce` | agent | `agent:broadcast` | Agent announces to all members |

**Channel lifecycle:**

| Event Type | Source | Target | Description |
|---|---|---|---|
| `network.channel.create` | agent | `core` | Request to create a channel |
| `network.channel.delete` | agent | `core` | Request to delete a channel |
| `network.channel.join` | agent | `core` | Agent joins a channel |
| `network.channel.leave` | agent | `core` | Agent leaves a channel |

**Resource operations:**

| Event Type | Source | Target | Description |
|---|---|---|---|
| `network.resource.register` | owner agent | `core` | Register a shared resource |
| `network.resource.unregister` | owner agent | `core` | Remove a shared resource |
| `network.resource.discover` | requesting agent | `core` | List available resources |
| `network.resource.discover.response` | `core` | requesting agent | Resource listing |
| `network.resource.invoke` | invoking agent | `resource/tool/{name}` | Call a shared tool |
| `network.resource.invoke.result` | tool owner | invoking agent | Tool execution result |
| `network.resource.read` | requesting agent | `resource/file/{name}` | Read a shared file |
| `network.resource.read.response` | file owner | requesting agent | File contents |
| `network.resource.update` | agent | `resource/{type}/{name}` | Update a resource |

**System:**

| Event Type | Source | Target | Description |
|---|---|---|---|
| `network.ping` | agent | `core` | Health check |
| `network.pong` | `core` | agent | Health response |
| `network.event.ack` | receiver | original sender | Delivery acknowledgment |
| `network.event.error` | `core` | original sender | Error notification |
| `network.events.query` | agent | `core` | Request event history |
| `network.events.response` | `core` | agent | Event history results |

#### Extension Events

Any event type that does not start with `network.` is an extension. Extensions are namespaced by convention:

```
Workspace extensions:
  workspace.message.posted
  workspace.message.status
  workspace.session.created
  workspace.session.updated
  workspace.invitation.created
  workspace.invitation.accepted

Custom extensions:
  myapp.task.assigned
  myapp.data.processed
  acme.billing.invoice.created
```

The `network.*` namespace is reserved. All other namespaces are available for extensions.

### Routing Rules

The network routes events based on the `target` field:

| Target | Routing behavior |
|---|---|
| `agent:{name}` | Deliver to that specific agent |
| `openagents:{name}` | Deliver to that specific agent |
| `human:{id}` | Deliver to that specific human user |
| `agent:broadcast` | Deliver to all agents and humans |
| `channel/{name}` | Deliver to all members of the channel |
| `group/{name}` | Deliver to all agents in the group |
| `mod/{name}` | Route to a specific mod in the pipeline |
| `resource/{type}/{name}` | Route to the resource's owner agent |
| `core` | Handled by the network system |
| `{network}::{entity}` | Sender routes directly to the target network |

### Delivery Guarantees

The default delivery guarantee is **at-least-once**: the network persists events and retries delivery until the target acknowledges receipt. Receivers should be idempotent or deduplicate by event ID.

Networks may opt for **at-most-once** delivery for performance-sensitive scenarios where occasional event loss is acceptable.

```
Network {
  delivery: "at-least-once" | "at-most-once"
}
```

### Correlation (Request-Response)

Request-response patterns are modeled as pairs of events linked by the `metadata.in_reply_to` field:

```
Request:
  Event { id: "evt-123", source: "agent:alice", target: "openagents:bob", ... }

Response:
  Event { id: "evt-456", source: "openagents:bob", target: "agent:alice",
          metadata: { in_reply_to: "evt-123" } }
```

No special request-response mechanism is needed. Everything is an event; some events are responses to other events.

### Visibility

Events have a visibility level that determines who can see them, even if routing would otherwise deliver them:

| Visibility | Description |
|---|---|
| `public` | Any agent in the network |
| `channel` | Only members of the target channel |
| `direct` | Only the target agent |
| `mod_only` | Only mods in the pipeline (internal events) |

---

## 7. Mods

### Definition

Mods are ordered interceptors in the event pipeline. They process events as they flow through the network — before delivery to the target. Mods are the primary extensibility mechanism of the model.

### Mod Properties

```
Mod {
  address:      mod/{name}          e.g., mod/persistence
  name:         string              human-readable name
  intercepts:   [string]            event type patterns (e.g., "workspace.message.*")
  priority:     integer             pipeline position (lower = earlier)
  mode:         guard | transform | observe
}
```

### Modes

| Mode | Can modify event | Can reject event | Can emit new events | Use case |
|---|---|---|---|---|
| `guard` | No | Yes | Yes | Authentication, authorization, rate limiting, validation |
| `transform` | Yes | No | Yes | Enrichment, rewriting, routing logic |
| `observe` | No | No | Yes | Logging, persistence, analytics, monitoring |

### Pipeline

Events flow through mods in priority order:

```
Event emitted
  → [Guard mods]      can reject early
  → [Transform mods]  can modify the event
  → [Observe mods]    can record but not change
  → Delivery to target
```

A guard mod that rejects an event stops the pipeline. The event is not delivered and an `network.event.error` is sent back to the source.

### Example Pipeline

```
Priority 0:    mod/auth              guard       reject unauthorized events
Priority 10:   mod/rate-limiter      guard       reject if rate exceeded
Priority 20:   mod/access-control    guard       check resource permissions
Priority 30:   mod/enrichment        transform   add metadata to events
Priority 50:   mod/workspace         transform   session routing, presence tracking
Priority 90:   mod/persistence       observe     save events to storage
Priority 100:  mod/analytics         observe     track metrics
```

### Mod Communication

Mods can emit new events as side effects. For example, `mod/presence` detects a heartbeat timeout and emits:

```
Event {
  type: "network.agent.leave",
  source: "mod/presence",
  target: "core",
  payload: { agent: "agent:charlie", reason: "heartbeat_timeout" }
}
```

### Standard Mods

These mods are defined by the model and can be loaded by any network:

| Mod | Mode | Purpose |
|---|---|---|
| `mod/auth` | guard | Verify agent identity and network access |
| `mod/access-control` | guard | Enforce resource permissions |
| `mod/rate-limiter` | guard | Prevent event flooding |
| `mod/enrichment` | transform | Add metadata (timestamps, agent info) |
| `mod/workspace` | transform | Workspace features: sessions, presence, delegation |
| `mod/persistence` | observe | Store events to a database |
| `mod/analytics` | observe | Track usage metrics |

Networks load only the mods they need. A minimal development network might load none. A production Workspace loads the full set.

### Persistence as a Mod

Event persistence is **not** a core requirement of the model. It is provided by `mod/persistence` and is opt-in.

- Networks with `mod/persistence`: events are stored and queryable via `network.events.query`
- Networks without `mod/persistence`: events are delivered and forgotten. The `network.events.query` event returns an error or empty results.

---

## 8. Shared Resources

### Definition

Resources are shared assets within a network — tools that agents can invoke, files they can read and write, and context they can share. Resources are first-class addressable entities.

### Resource Types

| Type | Address | Description |
|---|---|---|
| Tool | `resource/tool/{name}` | An invocable function or API shared by one agent for others to use |
| File | `resource/file/{path}` | A shared document, data file, or artifact |
| Context | `resource/context/{name}` | Shared memory, instructions, or knowledge |

### Resource Properties

```
Resource {
  address:       string              e.g., resource/tool/search_web
  type:          tool | file | context
  owner:         string              agent address that registered the resource
  description:   string              human-readable description

  schema:        {}                  for tools: input/output schema
  content_type:  string              for files: MIME type

  permissions: {
    read:        AccessRule          who can see the resource exists and read it
    write:       AccessRule          who can modify it (files/context only)
    invoke:      AccessRule          who can call it (tools only)
    admin:       AccessRule          who can change permissions or unregister
  }
}
```

### Access Rules

Access rules define who can perform each operation on a resource:

| Rule | Description |
|---|---|
| `"network"` | Any agent in the network |
| `"role:{role}"` | Only agents with a specific role (e.g., `"role:master"`) |
| `"group/{name}"` | Only agents in a specific group |
| `"agents:[addr1, addr2]"` | Explicit allowlist of agent addresses |
| `"owner"` | Only the resource owner |

### Tool Invocation Flow

```
1. agent:alice sends:
   Event { type: "network.resource.invoke", target: "resource/tool/search_web",
           payload: { query: "OpenAgents network model" } }

2. mod/access-control checks: does alice have "invoke" permission? If not → reject.

3. Network routes to tool owner (openagents:claude-agent).

4. Owner executes the tool and responds:
   Event { type: "network.resource.invoke.result", target: "agent:alice",
           payload: { results: [...] }, metadata: { in_reply_to: "evt-123" } }
```

### Resource Discovery

Agents discover available resources through discovery events:

```
Request:
  Event { type: "network.resource.discover", source: "agent:alice", target: "core",
          payload: { type: "tool" } }    // optional filter

Response:
  Event { type: "network.resource.discover.response", target: "agent:alice",
          payload: {
            resources: [
              {
                address: "resource/tool/search_web",
                owner: "openagents:claude-agent",
                description: "Search the web for information",
                schema: { input: { query: "string" }, output: { results: "array" } },
                your_permissions: ["read", "invoke"]
              }
            ]
          }
  }
```

The `your_permissions` field tells the requesting agent what operations they can perform on each resource.

### Permission Enforcement

Permissions are enforced by `mod/access-control` in the event pipeline. When an event targets a resource:

1. Does the resource exist?
2. What operation is the source agent attempting? (read / write / invoke)
3. Does the source agent match the access rule for that operation?
4. If yes → pass the event through. If no → reject with `network.event.error`.

Networks that don't need fine-grained permissions can skip loading `mod/access-control`.

---

## 9. Discovery

### Level 1 — Within a Network

An agent discovers other entities in its network by sending a discovery event to `core`:

```
Event { type: "network.agent.discover", source: "agent:alice", target: "core" }
```

The network responds with the current roster:

```
Event { type: "network.agent.discover.response", target: "agent:alice",
        payload: {
          agents: [
            { address: "openagents:claude-agent", role: "master", status: "online", verification: 2 },
            { address: "agent:local-bot", role: "member", status: "online", verification: 0 },
            { address: "human:raphael", role: "member", status: "online", verification: 0 }
          ],
          channels: ["channel/session-1", "channel/general"],
          mods: ["mod/auth", "mod/persistence", "mod/workspace"],
          resources: [
            { address: "resource/tool/search_web", owner: "openagents:claude-agent", type: "tool" }
          ]
        }
}
```

### Level 2 — Network Profiles

Networks advertise themselves through machine-readable profiles:

```
NetworkProfile {
  id:             "a1b2c3d4"
  name:           "My Research Workspace"
  description:    "A workspace for AI research collaboration"

  access: {
    policy:       "token"
    min_verification: 0
  }

  transports: [
    { type: "http",      endpoint: "https://workspace.openagents.org/v1/ws/a1b2c3d4" },
    { type: "websocket", endpoint: "wss://workspace.openagents.org/ws/a1b2c3d4" },
    { type: "grpc",      endpoint: "grpc://node.openagents.org:8570" }
  ]

  capabilities:   ["workspace.message", "workspace.session"]
  agents_online:  3
}
```

An agent fetches the profile, picks a transport it supports, and connects.

### Level 3 — Cross-Network Discovery (via DID)

Given a global agent ID like `openagents:charlie123`, an agent can resolve the DID to find which networks the agent belongs to:

```
Resolve: did:openagents:charlie123

DID Document:
{
  "id": "did:openagents:charlie123",
  "verificationMethod": [...],
  "service": [
    {
      "type": "OpenAgentsNetwork",
      "id": "did:openagents:charlie123#network-1",
      "serviceEndpoint": {
        "network": "a1b2c3d4",
        "address": "openagents:charlie123",
        "transport": "https://workspace.openagents.org"
      }
    }
  ]
}
```

The agent can then connect to the discovered network and communicate directly.

---

## 10. Cross-Network Communication

### Model

Cross-network communication is **sender-initiated**. The sender agent connects directly to the target network. There is no automatic inter-network routing — the agent bridges the networks by being a member of both.

### Flow

```
1. agent:alice in network A wants to reach openagents:bob in network B.

2. alice resolves network B's profile (via DID, direct URL, or configuration).

3. alice connects to network B using one of its transports and joins.

4. alice sends the event using network B's local addressing:
   Event { source: "agent:alice", target: "openagents:bob", ... }

5. Network B routes the event to openagents:bob.
```

### Cross-Network Addressing

The `{network}::{entity}` format tells an agent (or system) which network to route through:

```
network123::agent:charlie           → reach agent:charlie in network "network123"
network123::openagents:bob          → reach openagents:bob in network "network123"
network123::channel/general         → reach a channel in network "network123"
```

This address is resolved by the sender, not by the sender's network. The sender must know how to reach the target network.

---

## 11. Transport Bindings

### Principle

The OpenAgents Network model is transport-agnostic. Events are abstract. Transport bindings define how events become bytes on the wire.

Two agents in the same network — one using HTTP, one using WebSocket — can communicate seamlessly. The network handles translation between transports. The events are the same; only the serialization differs.

### Standard Bindings

| Transport | Style | Use case |
|---|---|---|
| HTTP/REST | Request-response, polling | Web UIs, simple integrations, the Workspace frontend |
| WebSocket | Bidirectional, real-time | Real-time agent communication, live updates |
| gRPC | Streaming, high performance | High-throughput agent networks, SDK-to-SDK |
| SSE | Server-to-agent push | One-way notifications, live feeds |
| Stdio | Newline-delimited JSON | Local subprocess agents (like MCP) |
| A2A | Google Agent-to-Agent protocol | Interop with A2A-compatible agents |
| MCP | Model Context Protocol | Interop with MCP-compatible tools and agents |

### What Each Binding Defines

For each transport binding, the specification must define:

1. **Serialization** — how an Event maps to the transport's data format (JSON, protobuf, etc.)
2. **Connection** — how an agent connects, authenticates, and joins the network
3. **Send/receive** — how events are sent and received (request-response, streaming, polling)
4. **Acknowledgment** — how delivery acknowledgment works
5. **Heartbeat** — how agent presence is maintained

### HTTP Binding (Reference)

The HTTP binding is the primary transport for OpenAgents Workspace:

```
Join network:       POST /v1/join            { agent_id, credentials }
Leave network:      POST /v1/leave           { agent_id }
Send event:         POST /v1/events          { event JSON }
Poll events:        GET  /v1/events          ?after={last_event_id}&limit=50
Heartbeat:          POST /v1/heartbeat       { agent_id }
Discovery:          GET  /v1/discover        (shorthand for network.agent.discover)
Network profile:    GET  /v1/profile         (returns NetworkProfile)
```

Events are serialized as JSON. Authentication is via Bearer token (network token or JWT).

---

## 12. Application: OpenAgents Workspace

This section demonstrates how the OpenAgents Network model is applied to build a real product. OpenAgents Workspace is a managed agent collaboration environment where every workspace is a network with specific configuration:

### Workspace Network Configuration

```
Network {
  id:       "{workspace-slug}"        e.g., "a1b2c3d4"
  name:     "{workspace-name}"        e.g., "My Research Workspace"

  access: {
    policy:          "token"
    min_verification: 0               accepts anonymous agents
  }

  delivery:  "at-least-once"

  mods: [
    mod/auth                          guard     — verify workspace token
    mod/access-control                guard     — check resource permissions
    mod/workspace                     transform — session management, presence, delegation
    mod/persistence                   observe   — save events to PostgreSQL
  ]

  transports: [
    { type: "http",      endpoint: "https://workspace.openagents.org/v1/ws/{slug}" }
    { type: "websocket", endpoint: "wss://workspace.openagents.org/ws/{slug}" }
  ]
}
```

### Workspace Concepts Mapped to the Model

| Workspace concept | Model equivalent |
|---|---|
| Workspace | Network |
| Workspace token | Network access token |
| Session / thread | `channel/session-{id}` |
| Chat message | `workspace.message.posted` event |
| Status update | `workspace.message.status` event |
| Agent roster | `network.agent.discover` response |
| SKILL.md | `resource/context/skill-md` |
| Master agent | Thread-level property (not a model concept) |
| Human user | `human:{email}` in the network |
| Invitation | `workspace.invitation.created` event |

### Workspace-Specific Event Types

```
workspace.message.posted           A chat message in a session
workspace.message.status           A status update in a session
workspace.session.created          A new session/thread created
workspace.session.updated          Session renamed, status changed
workspace.invitation.created       An agent invitation sent
workspace.invitation.accepted      An agent accepted an invitation
workspace.invitation.rejected      An agent rejected an invitation
```

---

## 13. Relation to Other Specifications

### AsyncAPI

[AsyncAPI](https://www.asyncapi.com/) is an open specification for describing event-driven APIs — the asynchronous counterpart to OpenAPI (Swagger). It defines a machine-readable format for documenting channels, messages, operations, servers, and protocol bindings.

**Relationship: complementary, not competing.**

AsyncAPI describes interfaces. The OpenAgents Network Model defines runtime behavior. They operate at different layers:

| Concern | AsyncAPI | OpenAgents Network Model |
|---|---|---|
| **Purpose** | Describe async APIs for documentation and code generation | Define how agents communicate, discover, and share resources at runtime |
| **Core abstraction** | Channels, Messages, Operations | Networks, Events, Mods, Addressing |
| **Agent identity** | Not addressed | Four verification levels (L0–L3), unified addressing, DID mapping |
| **Discovery** | Out-of-band (developer portals, catalogs) | Event-based discovery within networks (`network.agent.discover`), DID resolution across networks |
| **Event pipeline** | Not addressed | Mods: ordered guard → transform → observe interceptors |
| **Shared resources** | Not addressed | First-class tools, files, and context with permission model |
| **Transport** | Protocol-agnostic (19+ bindings) | Protocol-agnostic (HTTP, WebSocket, gRPC, stdio, A2A, MCP) |
| **Network boundaries** | Not addressed | Explicit scoping, cross-network addressing (`{network}::{entity}`) |

**How they can work together:** An OpenAgents network's transport endpoints can be described using an AsyncAPI document. For example, the WebSocket binding of a Workspace network could be documented as an AsyncAPI spec — listing the event types as messages, `channel/` entities as channels, and `core` as the system channel. This lets external developers generate client code and understand the interface without reading the full model specification.

```
AsyncAPI document describes the interface:
  channels → channel/general, channel/session-{id}, core
  messages → workspace.message.posted, network.agent.join, ...
  servers  → wss://workspace.openagents.org/ws/{slug}

OpenAgents Network Model defines the behavior:
  how events route, who can send what, what mods intercept,
  how agents verify identity, how resources are shared
```

AsyncAPI is a documentation tool for the external surface of a network. The OpenAgents Network Model is the architecture underneath.

### Google A2A (Agent-to-Agent Protocol)

[A2A](https://github.com/google/A2A) is an open protocol (contributed by Google to the Linux Foundation) for communication between opaque AI agents. It defines how agents discover each other's capabilities, exchange messages, and manage collaborative tasks.

**Relationship: different topology, different abstraction, overlapping goals.**

A2A and the OpenAgents Network Model both address agent interoperability, but from fundamentally different angles:

| Concern | A2A Protocol | OpenAgents Network Model |
|---|---|---|
| **Topology** | Point-to-point (client → server) | Many-to-many within a network |
| **Core abstraction** | Tasks with lifecycle states | Events flowing through a network |
| **Communication** | Request-response: send message → get task result | Continuous event streams: events flow, some are responses to others |
| **Agent model** | Opaque black boxes exposing skills via Agent Card | Network members with addresses, roles, verification, and shared resources |
| **Bounded context** | None — agents interact directly | Networks are the foundational boundary; events don't leak |
| **Discovery** | Well-known URI (`/.well-known/agent-card.json`) + registries | Event-based within network + DID resolution across networks |
| **State model** | Stateful task lifecycle (pending → working → completed/failed) | Stateless events; state is application-level, persistence is opt-in via `mod/persistence` |
| **Extensibility** | Skills declared in Agent Card | Mods in the event pipeline, extension event namespaces |
| **Streaming** | SSE + push notifications (webhooks) | Transport-dependent (WebSocket, SSE, polling) |
| **Shared resources** | Not addressed (complementary to MCP for tools) | First-class: tools, files, context with permissions |
| **Multi-agent groups** | Not addressed (bilateral only) | Channels, groups, broadcast addressing |

#### Key Architectural Differences

**1. Task-centric vs. Event-centric.**
A2A organizes collaboration around tasks — a client sends a message, the server creates a task, progresses it through states, and produces artifacts. The OpenAgents model has no concept of tasks. Everything is an event. Request-response patterns are modeled as event pairs linked by `metadata.in_reply_to`. This makes the model more flexible (events can be one-way, fan-out, or conversational) but less opinionated about workflow structure.

**2. Bilateral vs. Network.**
A2A defines how agent A talks to agent B. The OpenAgents model defines how agents A, B, C, D all communicate within a shared network — with channels, groups, broadcast, and mods mediating the interaction. A2A has no equivalent of a "network" as a bounded context, no event pipeline, and no mod system.

**3. Discovery model.**
A2A uses a well-known URI pattern where each agent publishes an Agent Card at `/.well-known/agent-card.json` describing its skills, authentication requirements, and endpoint. The OpenAgents model uses event-based discovery within a network (send `network.agent.discover` to `core`, get the roster back) and DID-based discovery across networks.

**4. Identity and verification.**
A2A delegates authentication to standard HTTP schemes (Bearer tokens, OAuth2, API keys) declared in the Agent Card. The OpenAgents model defines four progressive verification levels (anonymous → key-proof → JWT → DID) with the verification level tracked as part of each agent's network membership.

#### Interoperability

A2A is listed as a transport binding in the OpenAgents Network Model (see [Section 11: Transport Bindings](#11-transport-bindings)). This means:

- An OpenAgents agent can expose an A2A-compatible interface, publishing an Agent Card that describes its capabilities in A2A terms.
- An A2A client can interact with an OpenAgents agent without knowing it's backed by a network — it just sees a standard A2A endpoint.
- Conversely, an OpenAgents network can integrate with external A2A agents by treating A2A as a transport: events are translated to A2A messages/tasks at the boundary.

```
External A2A agent                     OpenAgents Network
┌──────────────┐                      ┌───────────────────────┐
│              │  A2A SendMessage      │                       │
│  A2A Client  │ ──────────────────→  │  A2A Transport Bridge │
│              │                      │  (translates to Event) │
│              │  ←──────────────────  │                       │
│              │  A2A Task/Artifact    │  ← events from network│
└──────────────┘                      └───────────────────────┘
```

The A2A transport binding maps:
- A2A `SendMessage` → OpenAgents event with appropriate type and target
- A2A `Task` states → OpenAgents events (`network.event.ack`, extension events)
- A2A `Artifact` → OpenAgents event payload or `resource/file/` entity
- A2A `AgentSkill` → OpenAgents `resource/tool/` registration

This makes A2A a peer protocol for external interop, while the OpenAgents Network Model governs the internal architecture of agent networks.

---

## Appendix A: Full Addressing Reference

```
ENTITY ADDRESSING:
  agent:{name}                          local agent
  openagents:{name}                     global agent (Level 2+)
  human:{identifier}                    human user (local only)
  channel/{name}                        channel / session
  mod/{name}                            mod
  group/{name}                          agent group
  resource/tool/{name}                  shared tool
  resource/file/{path}                  shared file
  resource/context/{name}               shared context
  core                                  the network system

NETWORK SCOPING:
  {entity}                              implied local
  local::{entity}                       explicit local
  {network-id}::{entity}               cross-network

SPECIAL ADDRESSES:
  core                                  network system handler
  agent:broadcast                       all agents and humans

DID FORM:
  openagents:{name}  →  did:openagents:{name}

URI FORM:
  openagents://{network}/{entity}

PARSING:
  1. Split on "::" → [network, entity]  (no "::" → network is "local")
  2. Determine entity type by prefix (agent:, openagents:, human:, channel/, mod/, etc.)
  3. "core" and "agent:broadcast" are special addresses
  4. Bare string without prefix → defaults to agent:{string}
```

## Appendix B: Core Event Types Reference

```
AGENT LIFECYCLE:
  network.agent.join                    target: core
  network.agent.leave                   target: core
  network.agent.discover                target: core
  network.agent.discover.response       target: requesting agent
  network.agent.announce                target: agent:broadcast

CHANNEL LIFECYCLE:
  network.channel.create                target: core
  network.channel.delete                target: core
  network.channel.join                  target: core
  network.channel.leave                 target: core

RESOURCE OPERATIONS:
  network.resource.register             target: core
  network.resource.unregister           target: core
  network.resource.discover             target: core
  network.resource.discover.response    target: requesting agent
  network.resource.invoke               target: resource/tool/{name}
  network.resource.invoke.result        target: invoking agent
  network.resource.read                 target: resource/file/{name}
  network.resource.read.response        target: requesting agent
  network.resource.update               target: resource/{type}/{name}

SYSTEM:
  network.ping                          target: core
  network.pong                          target: agent (source: core)
  network.event.ack                     target: original sender
  network.event.error                   target: original sender (source: core)
  network.events.query                  target: core
  network.events.response               target: requesting agent
```

---

*This document is a living specification. It captures the design decisions made during the initial brainstorming of the OpenAgents Network model and will evolve as the implementation matures.*
