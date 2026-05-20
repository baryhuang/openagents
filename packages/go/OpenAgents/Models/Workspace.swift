import Foundation

struct Workspace: Identifiable, Decodable, Sendable, Equatable {
    let workspaceId: String
    let slug: String
    let name: String
    let creatorEmail: String?
    let status: String
    let createdAt: String?
    let lastActivityAt: String?
    let agents: [Agent]
    /// Workspace-scoped toggle for the Browser Fabric viewer. The backend
    /// emits `browserEnabled` at the top level alongside the existing
    /// `settings` JSONB; older backends omit it and we default to false.
    let browserEnabled: Bool

    var id: String { workspaceId }

    enum CodingKeys: String, CodingKey {
        case workspaceId
        case slug
        case name
        case creatorEmail
        case status
        case createdAt
        case lastActivityAt
        case agents
        case browserEnabled
    }

    init(
        workspaceId: String,
        slug: String,
        name: String,
        creatorEmail: String? = nil,
        status: String,
        createdAt: String? = nil,
        lastActivityAt: String? = nil,
        agents: [Agent] = [],
        browserEnabled: Bool = false,
    ) {
        self.workspaceId = workspaceId
        self.slug = slug
        self.name = name
        self.creatorEmail = creatorEmail
        self.status = status
        self.createdAt = createdAt
        self.lastActivityAt = lastActivityAt
        self.agents = agents
        self.browserEnabled = browserEnabled
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workspaceId = try c.decode(String.self, forKey: .workspaceId)
        slug = try c.decode(String.self, forKey: .slug)
        name = try c.decode(String.self, forKey: .name)
        creatorEmail = try c.decodeIfPresent(String.self, forKey: .creatorEmail)
        status = try c.decode(String.self, forKey: .status)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        lastActivityAt = try c.decodeIfPresent(String.self, forKey: .lastActivityAt)
        agents = try c.decodeIfPresent([Agent].self, forKey: .agents) ?? []
        browserEnabled = try c.decodeIfPresent(Bool.self, forKey: .browserEnabled) ?? false
    }
}
