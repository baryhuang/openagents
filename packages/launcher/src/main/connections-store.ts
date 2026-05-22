import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app, safeStorage } from 'electron'

export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'expired'
  | 'unauthorized'
  | 'rate_limited'
  | 'offline'
  | 'error'

export type ConnectionAuthKind = 'oauth' | 'token' | 'pat' | 'app' | 'webhook'

export interface ConnectionRecord {
  id: string
  platform: string                    // 'github' | 'slack' | 'discord' | 'telegram' | 'notion' | 'linear' | 'openai' | 'anthropic' | 'google'
  account?: string
  label?: string
  status: ConnectionStatus
  authKind?: ConnectionAuthKind
  scopes?: string[]
  credentialId?: string               // FK → CredentialRecord.id
  meta?: Record<string, unknown>      // platform-specific (e.g. repo selections)
  lastSyncAt?: string                 // ISO
  lastError?: string
  createdAt: string
  updatedAt: string
}

interface FileShape {
  version: 1
  connections: ConnectionRecord[]
}

const FILE_NAME = 'connections.json'

function fsId(): string {
  return crypto.randomBytes(8).toString('hex')
}

export class ConnectionsStore {
  private _path: string | null = null
  private _data: FileShape = { version: 1, connections: [] }
  private _loaded = false

  private _ensure(): void {
    if (this._loaded) return
    this._path = path.join(app.getPath('userData'), FILE_NAME)
    try {
      if (fs.existsSync(this._path)) {
        const raw = fs.readFileSync(this._path, 'utf-8')
        const parsed = JSON.parse(raw)
        if (parsed && Array.isArray(parsed.connections)) {
          this._data = { version: 1, connections: parsed.connections }
        }
      }
    } catch (err) {
      console.error('Failed to load connections.json:', err)
    }
    this._loaded = true
  }

  private _save(): void {
    if (!this._path) return
    try {
      fs.mkdirSync(path.dirname(this._path), { recursive: true })
      fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save connections.json:', err)
    }
  }

  list(): ConnectionRecord[] {
    this._ensure()
    return this._data.connections.map((c) => ({ ...c }))
  }

  get(id: string): ConnectionRecord | null {
    this._ensure()
    return this._data.connections.find((c) => c.id === id) || null
  }

  upsert(record: Partial<ConnectionRecord> & { platform: string }): ConnectionRecord {
    this._ensure()
    const now = new Date().toISOString()
    if (record.id) {
      const idx = this._data.connections.findIndex((c) => c.id === record.id)
      if (idx >= 0) {
        const merged: ConnectionRecord = {
          ...this._data.connections[idx],
          ...record,
          id: this._data.connections[idx].id,
          createdAt: this._data.connections[idx].createdAt,
          updatedAt: now,
        }
        this._data.connections[idx] = merged
        this._save()
        return merged
      }
    }
    const created: ConnectionRecord = {
      id: record.id || fsId(),
      platform: record.platform,
      account: record.account,
      label: record.label,
      status: record.status || 'disconnected',
      authKind: record.authKind,
      scopes: record.scopes,
      credentialId: record.credentialId,
      meta: record.meta,
      lastSyncAt: record.lastSyncAt,
      lastError: record.lastError,
      createdAt: now,
      updatedAt: now,
    }
    this._data.connections.push(created)
    this._save()
    return created
  }

  remove(id: string): boolean {
    this._ensure()
    const before = this._data.connections.length
    this._data.connections = this._data.connections.filter((c) => c.id !== id)
    if (this._data.connections.length !== before) {
      this._save()
      return true
    }
    return false
  }

  setStatus(id: string, status: ConnectionStatus, lastError?: string): ConnectionRecord | null {
    this._ensure()
    const idx = this._data.connections.findIndex((c) => c.id === id)
    if (idx < 0) return null
    this._data.connections[idx] = {
      ...this._data.connections[idx],
      status,
      lastError,
      lastSyncAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this._save()
    return this._data.connections[idx]
  }

  /** Drop any connection pointing at a credential that's being deleted. */
  unlinkCredential(credentialId: string): number {
    this._ensure()
    let n = 0
    for (const c of this._data.connections) {
      if (c.credentialId === credentialId) {
        c.credentialId = undefined
        c.status = 'unauthorized'
        c.updatedAt = new Date().toISOString()
        n++
      }
    }
    if (n > 0) this._save()
    return n
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Credentials
// ─────────────────────────────────────────────────────────────────────────

export type CredentialKind = 'api_key' | 'token' | 'oauth' | 'webhook_secret' | 'password'

export interface CredentialRecord {
  id: string
  provider: string             // 'openai' | 'anthropic' | 'github' | ...
  kind: CredentialKind
  label: string
  // Stored encrypted at rest. Never returned to the renderer in cleartext
  // unless explicitly revealed via revealSecret().
  secretCipher: string         // base64
  shared: boolean              // can be referenced by multiple agents
  scopes?: string[]            // optional permission tags ('read', 'write', etc)
  usedByAgents?: string[]      // agent names that reference this credential
  usedByConnections?: string[] // connection ids that reference this credential
  lastTestedAt?: string
  lastTestOk?: boolean
  lastTestError?: string
  createdAt: string
  updatedAt: string
}

interface CredentialsFileShape {
  version: 1
  credentials: CredentialRecord[]
  /** AES-256-GCM key (base64) wrapped by Electron's safeStorage when available;
   *  otherwise stored in cleartext (still better than plain-secret-on-disk because
   *  we then derive an encryption key for the actual secrets). */
  wrappedKey?: string
}

const CRED_FILE = 'credentials.json'

export class CredentialsStore {
  private _path: string | null = null
  private _data: CredentialsFileShape = { version: 1, credentials: [] }
  private _loaded = false
  private _key: Buffer | null = null

  private _ensure(): void {
    if (this._loaded) return
    this._path = path.join(app.getPath('userData'), CRED_FILE)
    try {
      if (fs.existsSync(this._path)) {
        const raw = fs.readFileSync(this._path, 'utf-8')
        const parsed = JSON.parse(raw) as CredentialsFileShape
        if (parsed && Array.isArray(parsed.credentials)) {
          this._data = parsed
        }
      }
    } catch (err) {
      console.error('Failed to load credentials.json:', err)
    }
    this._ensureKey()
    this._loaded = true
  }

  private _ensureKey(): void {
    if (this._data.wrappedKey) {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          const keyB64 = safeStorage.decryptString(
            Buffer.from(this._data.wrappedKey, 'base64'),
          )
          this._key = Buffer.from(keyB64, 'base64')
        } else {
          this._key = Buffer.from(this._data.wrappedKey, 'base64')
        }
      } catch {
        this._key = null
      }
    }
    if (!this._key) {
      this._key = crypto.randomBytes(32)
      const keyB64 = this._key.toString('base64')
      try {
        if (safeStorage.isEncryptionAvailable()) {
          this._data.wrappedKey = safeStorage.encryptString(keyB64).toString('base64')
        } else {
          this._data.wrappedKey = keyB64
        }
      } catch {
        this._data.wrappedKey = keyB64
      }
      this._save()
    }
  }

  private _save(): void {
    if (!this._path) return
    try {
      fs.mkdirSync(path.dirname(this._path), { recursive: true })
      fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf-8')
      fs.chmodSync(this._path, 0o600)
    } catch (err) {
      console.error('Failed to save credentials.json:', err)
    }
  }

  private _encrypt(plaintext: string): string {
    if (!this._key) throw new Error('Credentials key not initialized')
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', this._key, iv)
    const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, ct]).toString('base64')
  }

  private _decrypt(cipherB64: string): string {
    if (!this._key) throw new Error('Credentials key not initialized')
    const buf = Buffer.from(cipherB64, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const ct = buf.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', this._key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8')
  }

  private _redact(c: CredentialRecord): Omit<CredentialRecord, 'secretCipher'> & { secretMasked: string } {
    let len = 0
    try {
      len = this._decrypt(c.secretCipher).length
    } catch {}
    const visible = len > 4 ? 4 : Math.max(0, len - 1)
    const mask = '•'.repeat(Math.max(0, len - visible))
    return {
      ...c,
      // Never expose ciphertext to the renderer either
      secretMasked: `${mask}${visible > 0 ? '****' : ''}`,
      secretCipher: undefined as unknown as string,
    } as never
  }

  list(): Array<Omit<CredentialRecord, 'secretCipher'> & { secretMasked: string }> {
    this._ensure()
    return this._data.credentials.map((c) => this._redact(c))
  }

  reveal(id: string): { ok: boolean; secret?: string; error?: string } {
    this._ensure()
    const cred = this._data.credentials.find((c) => c.id === id)
    if (!cred) return { ok: false, error: 'Credential not found' }
    try {
      return { ok: true, secret: this._decrypt(cred.secretCipher) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /** Internal-only — used by connection testers / env resolvers. */
  getSecret(id: string): string | null {
    this._ensure()
    const cred = this._data.credentials.find((c) => c.id === id)
    if (!cred) return null
    try {
      return this._decrypt(cred.secretCipher)
    } catch {
      return null
    }
  }

  upsert(input: {
    id?: string
    provider: string
    kind: CredentialKind
    label: string
    secret?: string             // required on create; optional on update (kept if not provided)
    shared?: boolean
    scopes?: string[]
    usedByAgents?: string[]
  }): { ok: boolean; record?: ReturnType<CredentialsStore['list']>[number]; error?: string } {
    this._ensure()
    const now = new Date().toISOString()
    if (input.id) {
      const idx = this._data.credentials.findIndex((c) => c.id === input.id)
      if (idx < 0) return { ok: false, error: 'Credential not found' }
      const prev = this._data.credentials[idx]
      const next: CredentialRecord = {
        ...prev,
        provider: input.provider,
        kind: input.kind,
        label: input.label,
        shared: input.shared ?? prev.shared,
        scopes: input.scopes ?? prev.scopes,
        usedByAgents: input.usedByAgents ?? prev.usedByAgents,
        updatedAt: now,
        secretCipher: input.secret ? this._encrypt(input.secret) : prev.secretCipher,
        lastTestedAt: input.secret ? undefined : prev.lastTestedAt,
        lastTestOk: input.secret ? undefined : prev.lastTestOk,
        lastTestError: input.secret ? undefined : prev.lastTestError,
      }
      this._data.credentials[idx] = next
      this._save()
      return { ok: true, record: this._redact(next) }
    }
    if (!input.secret) return { ok: false, error: 'Secret is required when creating a credential' }
    const created: CredentialRecord = {
      id: fsId(),
      provider: input.provider,
      kind: input.kind,
      label: input.label,
      secretCipher: this._encrypt(input.secret),
      shared: input.shared ?? false,
      scopes: input.scopes,
      usedByAgents: input.usedByAgents,
      usedByConnections: [],
      createdAt: now,
      updatedAt: now,
    }
    this._data.credentials.push(created)
    this._save()
    return { ok: true, record: this._redact(created) }
  }

  remove(id: string): boolean {
    this._ensure()
    const before = this._data.credentials.length
    this._data.credentials = this._data.credentials.filter((c) => c.id !== id)
    if (this._data.credentials.length !== before) {
      this._save()
      return true
    }
    return false
  }

  recordTest(id: string, ok: boolean, error?: string): void {
    this._ensure()
    const idx = this._data.credentials.findIndex((c) => c.id === id)
    if (idx < 0) return
    this._data.credentials[idx] = {
      ...this._data.credentials[idx],
      lastTestedAt: new Date().toISOString(),
      lastTestOk: ok,
      lastTestError: error,
      updatedAt: new Date().toISOString(),
    }
    this._save()
  }

  syncConnectionUsage(connectionId: string, prevCredentialId: string | undefined, nextCredentialId: string | undefined): void {
    this._ensure()
    if (prevCredentialId === nextCredentialId) return
    if (prevCredentialId) {
      const p = this._data.credentials.find((c) => c.id === prevCredentialId)
      if (p) {
        p.usedByConnections = (p.usedByConnections || []).filter((x) => x !== connectionId)
        p.updatedAt = new Date().toISOString()
      }
    }
    if (nextCredentialId) {
      const n = this._data.credentials.find((c) => c.id === nextCredentialId)
      if (n) {
        const set = new Set(n.usedByConnections || [])
        set.add(connectionId)
        n.usedByConnections = Array.from(set)
        n.updatedAt = new Date().toISOString()
      }
    }
    this._save()
  }
}
