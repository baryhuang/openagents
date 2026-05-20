import fs from "fs"
import path from "path"
import { app } from "electron"

export interface GitHubBinding {
  agentName: string
  owner: string
  repo: string
  credentialId: string
  createdAt: string
  updatedAt: string
}

interface FileShape {
  version: 1
  bindings: GitHubBinding[]
}

const FILE_NAME = "github-bindings.json"

export class GitHubBindingsStore {
  private _path: string | null = null
  private _data: FileShape = { version: 1, bindings: [] }
  private _loaded = false

  private _ensure(): void {
    if (this._loaded) return
    this._path = path.join(app.getPath("userData"), FILE_NAME)
    try {
      if (fs.existsSync(this._path)) {
        const raw = fs.readFileSync(this._path, "utf-8")
        const parsed = JSON.parse(raw)
        if (parsed && Array.isArray(parsed.bindings)) {
          this._data = { version: 1, bindings: parsed.bindings }
        }
      }
    } catch (err) {
      console.error("Failed to load github-bindings.json:", err)
    }
    this._loaded = true
  }

  private _save(): void {
    if (!this._path) return
    try {
      fs.mkdirSync(path.dirname(this._path), { recursive: true })
      fs.writeFileSync(
        this._path,
        JSON.stringify(this._data, null, 2),
        "utf-8",
      )
    } catch (err) {
      console.error("Failed to save github-bindings.json:", err)
    }
  }

  list(): GitHubBinding[] {
    this._ensure()
    return this._data.bindings.map((b) => ({ ...b }))
  }

  get(agentName: string): GitHubBinding | null {
    this._ensure()
    return this._data.bindings.find((b) => b.agentName === agentName) || null
  }

  upsert(input: {
    agentName: string
    owner: string
    repo: string
    credentialId: string
  }): GitHubBinding {
    this._ensure()
    const now = new Date().toISOString()
    const idx = this._data.bindings.findIndex(
      (b) => b.agentName === input.agentName,
    )
    if (idx >= 0) {
      const prev = this._data.bindings[idx]
      const next: GitHubBinding = {
        ...prev,
        owner: input.owner,
        repo: input.repo,
        credentialId: input.credentialId,
        updatedAt: now,
      }
      this._data.bindings[idx] = next
      this._save()
      return next
    }
    const created: GitHubBinding = {
      agentName: input.agentName,
      owner: input.owner,
      repo: input.repo,
      credentialId: input.credentialId,
      createdAt: now,
      updatedAt: now,
    }
    this._data.bindings.push(created)
    this._save()
    return created
  }

  remove(agentName: string): boolean {
    this._ensure()
    const before = this._data.bindings.length
    this._data.bindings = this._data.bindings.filter(
      (b) => b.agentName !== agentName,
    )
    if (this._data.bindings.length === before) return false
    this._save()
    return true
  }

  unlinkCredential(credentialId: string): void {
    this._ensure()
    const before = this._data.bindings.length
    this._data.bindings = this._data.bindings.filter(
      (b) => b.credentialId !== credentialId,
    )
    if (this._data.bindings.length !== before) this._save()
  }
}
