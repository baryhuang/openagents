import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  Plus,
  RefreshCw,
  ExternalLink,
  Github,
  Trash2,
  Pencil,
  MessageSquare,
  GitPullRequest,
  CircleDot,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { TopBar } from "../../components/TopBar"
import { Button } from "../../components/ui/Button"
import { Card } from "../../components/ui/Card"
import { Input } from "../../components/ui/Input"
import { ConfirmDialog } from "../../components/ui/ConfirmDialog"
import { GitHubBindDialog } from "../../components/github/GitHubBindDialog"
import { useAgentsStore } from "../../store/agents"
import { useCredentialsStore } from "../../store/credentials"
import { useGitHubStore } from "../../store/github"
import type {
  GitHubBinding,
  GitHubIssue,
  GitHubPullRequest,
} from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { cn } from "../../lib/utils"

interface Props {
  showToast: (msg: string, type?: ToastType) => void
}

type Tab = "issues" | "pulls"

interface BindingFeed {
  loading: boolean
  issues: GitHubIssue[]
  pulls: GitHubPullRequest[]
  error?: string
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function GitHubPage({ showToast }: Props): React.JSX.Element {
  const { bindings, refresh, loading } = useGitHubStore(
    useShallow((s) => ({
      bindings: s.bindings,
      refresh: s.refresh,
      loading: s.loading,
    })),
  )
  const refreshAgents = useCallback(
    async () => window.api.listAgents().then((a) => useAgentsStore.getState().setAgents(a)),
    [],
  )
  const refreshCredentials = useCredentialsStore((s) => s.refresh)

  const [bindOpen, setBindOpen] = useState(false)
  const [bindEditing, setBindEditing] = useState<GitHubBinding | null>(null)
  const [unbindTarget, setUnbindTarget] = useState<GitHubBinding | null>(null)
  const [unbinding, setUnbinding] = useState(false)
  const [feeds, setFeeds] = useState<Record<string, BindingFeed>>({})
  const [tabs, setTabs] = useState<Record<string, Tab>>({})
  const [search, setSearch] = useState("")
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({})
  const [commenting, setCommenting] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
    void refreshAgents()
    void refreshCredentials()
  }, [refresh, refreshAgents, refreshCredentials])

  const credentials = useCredentialsStore((s) => s.credentials)

  const loadFeed = useCallback(async (b: GitHubBinding): Promise<void> => {
    setFeeds((prev) => ({
      ...prev,
      [b.agentName]: {
        loading: true,
        issues: prev[b.agentName]?.issues || [],
        pulls: prev[b.agentName]?.pulls || [],
      },
    }))
    const [issuesRes, pullsRes] = await Promise.all([
      window.api.githubListIssues({ agentName: b.agentName, state: "open", perPage: 10 }),
      window.api.githubListPullRequests({ agentName: b.agentName, state: "open", perPage: 10 }),
    ])
    setFeeds((prev) => ({
      ...prev,
      [b.agentName]: {
        loading: false,
        issues: issuesRes.ok ? issuesRes.items || [] : [],
        pulls: pullsRes.ok ? pullsRes.items || [] : [],
        error: !issuesRes.ok ? issuesRes.error : !pullsRes.ok ? pullsRes.error : undefined,
      },
    }))
  }, [])

  useEffect(() => {
    for (const b of bindings) {
      if (!feeds[b.agentName] && !tabs[b.agentName]) {
        setTabs((prev) => ({ ...prev, [b.agentName]: "issues" }))
        void loadFeed(b)
      }
    }
  }, [bindings, feeds, tabs, loadFeed])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return bindings
    return bindings.filter(
      (b) =>
        b.agentName.toLowerCase().includes(q) ||
        b.owner.toLowerCase().includes(q) ||
        b.repo.toLowerCase().includes(q),
    )
  }, [bindings, search])

  const handleUnbind = async (): Promise<void> => {
    if (!unbindTarget) return
    setUnbinding(true)
    try {
      const ok = await window.api.githubUnbindRepo(unbindTarget.agentName)
      if (ok) {
        showToast(`Unbound ${unbindTarget.agentName}`, "success")
        await refresh()
        setFeeds((prev) => {
          const next = { ...prev }
          delete next[unbindTarget.agentName]
          return next
        })
      }
      setUnbindTarget(null)
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setUnbinding(false)
    }
  }

  const handleComment = async (b: GitHubBinding, issueNumber: number): Promise<void> => {
    const key = `${b.agentName}:${issueNumber}`
    const body = (commentDraft[key] || "").trim()
    if (!body) return
    setCommenting(key)
    try {
      const res = await window.api.githubComment({
        agentName: b.agentName,
        issueNumber,
        body,
      })
      if (res.ok) {
        showToast(`Comment posted on #${issueNumber}`, "success")
        setCommentDraft((d) => ({ ...d, [key]: "" }))
        void loadFeed(b)
      } else {
        showToast(res.error || "Failed to post comment", "error")
      }
    } finally {
      setCommenting(null)
    }
  }

  const credLabel = (id: string): string =>
    credentials.find((c) => c.id === id)?.label || "(missing credential)"

  return (
    <section className="flex flex-col h-full">
      <TopBar
        title="GitHub"
        subtitle="— Bind agents to repos, surface recent issues / PRs"
        actions={
          <>
            <Button
              variant="default"
              onClick={() => {
                void refresh()
                for (const b of bindings) void loadFeed(b)
              }}
              disabled={loading}
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setBindEditing(null)
                setBindOpen(true)
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              Bind repo
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-9 py-6 flex flex-col gap-5">

      {bindings.length > 0 && (
        <div className="max-w-md">
          <Input
            placeholder="Filter by agent or repo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {bindings.length === 0 && !loading && (
        <Card>
          <div className="flex flex-col items-center text-center py-10 gap-3">
            <Github className="w-10 h-10 text-(--text-tertiary)" />
            <div className="text-[13px] text-(--text-primary) font-medium">
              No GitHub bindings yet
            </div>
            <div className="text-[12px] text-(--text-secondary) max-w-md">
              Connect an agent to a GitHub repository to surface recent
              issues / PRs and let the agent post comments via its bound
              token.
            </div>
            <Button
              variant="primary"
              onClick={() => {
                setBindEditing(null)
                setBindOpen(true)
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              Bind first repo
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {visible.map((b) => {
          const feed = feeds[b.agentName] || {
            loading: false,
            issues: [],
            pulls: [],
          }
          const tab = tabs[b.agentName] || "issues"
          return (
            <Card key={b.agentName}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-(--text-primary)">
                    <span className="truncate">{b.agentName}</span>
                    <span className="text-(--text-tertiary) text-[12px] font-normal">→</span>
                    <a
                      className="text-(--accent) hover:underline truncate"
                      href={`https://github.com/${b.owner}/${b.repo}`}
                      onClick={(e) => {
                        e.preventDefault()
                        window.api.openExternal(
                          `https://github.com/${b.owner}/${b.repo}`,
                        )
                      }}
                    >
                      {b.owner}/{b.repo}
                    </a>
                  </div>
                  <div className="text-[11px] text-(--text-tertiary) mt-0.5">
                    Credential: {credLabel(b.credentialId)} · Bound {timeAgo(b.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => loadFeed(b)}
                    disabled={feed.loading}
                    title="Refresh"
                  >
                    <RefreshCw
                      className={cn("w-3.5 h-3.5", feed.loading && "animate-spin")}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBindEditing(b)
                      setBindOpen(true)
                    }}
                    title="Edit binding"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setUnbindTarget(b)}
                    title="Unbind"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex gap-1 p-1 rounded-(--radius-sm) bg-(--bg-input) mb-3 w-fit">
                {(["issues", "pulls"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTabs((prev) => ({ ...prev, [b.agentName]: t }))}
                    className={cn(
                      "px-3 py-1 text-[11px] font-medium rounded-sm cursor-pointer border-0 flex items-center gap-1.5",
                      tab === t
                        ? "bg-(--bg-card) text-(--text-primary) shadow-sm"
                        : "bg-transparent text-(--text-secondary)",
                    )}
                  >
                    {t === "issues" ? (
                      <CircleDot className="w-3 h-3" />
                    ) : (
                      <GitPullRequest className="w-3 h-3" />
                    )}
                    {t === "issues"
                      ? `Issues (${feed.issues.length})`
                      : `Pull requests (${feed.pulls.length})`}
                  </button>
                ))}
              </div>

              {feed.error && (
                <div className="px-3 py-2 rounded-sm bg-(--danger-bg) text-(--danger-text) text-[11px] mb-2 break-words">
                  {feed.error}
                </div>
              )}

              {tab === "issues" && (
                <IssueList
                  binding={b}
                  items={feed.issues}
                  loading={feed.loading}
                  commentDraft={commentDraft}
                  setCommentDraft={setCommentDraft}
                  onComment={(num) => handleComment(b, num)}
                  commentingKey={commenting}
                />
              )}
              {tab === "pulls" && (
                <PullList items={feed.pulls} loading={feed.loading} />
              )}
            </Card>
          )
        })}
      </div>
      </div>

      <GitHubBindDialog
        open={bindOpen}
        onClose={() => {
          setBindOpen(false)
          setBindEditing(null)
        }}
        existing={bindEditing}
        showToast={showToast}
      />

      <ConfirmDialog
        open={!!unbindTarget}
        title={`Unbind ${unbindTarget?.agentName}?`}
        description={
          unbindTarget
            ? `This removes the link to ${unbindTarget.owner}/${unbindTarget.repo}. The credential itself is kept.`
            : ""
        }
        confirmLabel="Unbind"
        destructive
        onCancel={() => setUnbindTarget(null)}
        onConfirm={handleUnbind}
        busy={unbinding}
      />
    </section>
  )
}

function IssueList({
  binding,
  items,
  loading,
  commentDraft,
  setCommentDraft,
  onComment,
  commentingKey,
}: {
  binding: GitHubBinding
  items: GitHubIssue[]
  loading: boolean
  commentDraft: Record<string, string>
  setCommentDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onComment: (issueNumber: number) => void
  commentingKey: string | null
}): React.JSX.Element {
  if (loading && items.length === 0) {
    return <div className="text-[12px] text-(--text-tertiary) py-3">Loading…</div>
  }
  if (items.length === 0) {
    return (
      <div className="text-[12px] text-(--text-tertiary) py-3">
        No open issues.
      </div>
    )
  }
  return (
    <ul className="flex flex-col gap-2 list-none m-0 p-0">
      {items.map((i) => {
        const key = `${binding.agentName}:${i.number}`
        const draft = commentDraft[key] || ""
        const sending = commentingKey === key
        return (
          <li
            key={i.number}
            className="border border-(--border) rounded-sm p-3 bg-(--bg-primary)"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <a
                  className="text-[13px] font-medium text-(--text-primary) hover:underline break-words"
                  href={i.html_url}
                  onClick={(e) => {
                    e.preventDefault()
                    window.api.openExternal(i.html_url)
                  }}
                >
                  #{i.number} {i.title}
                </a>
                <div className="text-[11px] text-(--text-tertiary) mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>by {i.user.login}</span>
                  <span>·</span>
                  <span>updated {timeAgo(i.updated_at)}</span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    {i.comments}
                  </span>
                  {i.labels.slice(0, 3).map((l) => (
                    <span
                      key={l.name}
                      className="px-1.5 py-0.5 rounded-full text-[10px] text-(--text-secondary)"
                      style={{
                        background: l.color ? `#${l.color}33` : "var(--bg-input)",
                      }}
                    >
                      {l.name}
                    </span>
                  ))}
                </div>
              </div>
              <a
                className="shrink-0 text-(--text-tertiary) hover:text-(--text-primary)"
                href={i.html_url}
                onClick={(e) => {
                  e.preventDefault()
                  window.api.openExternal(i.html_url)
                }}
                title="Open on GitHub"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <Input
                placeholder="Reply as the bound agent…"
                value={draft}
                onChange={(e) =>
                  setCommentDraft((d) => ({ ...d, [key]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && draft.trim() && !sending) {
                    e.preventDefault()
                    onComment(i.number)
                  }
                }}
                disabled={sending}
                className="flex-1"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => onComment(i.number)}
                disabled={!draft.trim() || sending}
              >
                {sending ? "Posting…" : "Comment"}
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function PullList({
  items,
  loading,
}: {
  items: GitHubPullRequest[]
  loading: boolean
}): React.JSX.Element {
  if (loading && items.length === 0) {
    return <div className="text-[12px] text-(--text-tertiary) py-3">Loading…</div>
  }
  if (items.length === 0) {
    return (
      <div className="text-[12px] text-(--text-tertiary) py-3">
        No open pull requests.
      </div>
    )
  }
  return (
    <ul className="flex flex-col gap-2 list-none m-0 p-0">
      {items.map((p) => (
        <li
          key={p.number}
          className="border border-(--border) rounded-sm p-3 bg-(--bg-primary)"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <a
                className="text-[13px] font-medium text-(--text-primary) hover:underline break-words"
                href={p.html_url}
                onClick={(e) => {
                  e.preventDefault()
                  window.api.openExternal(p.html_url)
                }}
              >
                #{p.number} {p.title}
                {p.draft && (
                  <span className="ml-2 text-[10px] uppercase text-(--text-tertiary)">
                    draft
                  </span>
                )}
              </a>
              <div className="text-[11px] text-(--text-tertiary) mt-0.5 flex items-center gap-2 flex-wrap">
                <span>by {p.user.login}</span>
                <span>·</span>
                <span>
                  {p.head.ref} → {p.base.ref}
                </span>
                <span>·</span>
                <span>updated {timeAgo(p.updated_at)}</span>
              </div>
            </div>
            <a
              className="shrink-0 text-(--text-tertiary) hover:text-(--text-primary)"
              href={p.html_url}
              onClick={(e) => {
                e.preventDefault()
                window.api.openExternal(p.html_url)
              }}
              title="Open on GitHub"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </li>
      ))}
    </ul>
  )
}
