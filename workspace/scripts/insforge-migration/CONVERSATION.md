# How to instruct InsForge through Claude

The actual prompts that drove this migration end-to-end. Copy, adapt the URL/IDs to yours, paste.

## 1. Bootstrap — get Claude wired up to InsForge

> I'm using InsForge as my backend platform. Read the current directory, make sure InsForge skills are installed, and use InsForge CLI for backend tasks.

This single prompt gets Claude to:

- check / install the four InsForge skills under `~/.claude/skills/` (`insforge`, `insforge-cli`, `insforge-debug`, `insforge-integrations`),
- run `npx @insforge/cli login` if needed,
- read `.insforge/project.json` so it knows which project this directory is linked to,
- confirm the linked project name + region back to you.

Run it once per repo.

## 2. Sanity-check which project Claude is operating on

> what insforge project you are seeing?

Useful before any destructive backend op — confirms you're not about to write into the wrong tenant.

## 3. Plan a migration / replication into InsForge

> this is a very complex task. you must think deep. plan with insforge, using existing api to migrate or replicate all data from `<source-url-with-token>` to insforge project.

The "think deep" + "plan with insforge" + "using existing api" framing matters:

- "plan" forces a written phased plan with go/no-go checkpoints rather than immediate writes.
- "existing api" rules out building new endpoints — keeps the work to a script + InsForge schema.
- "to insforge project" anchors the target as the linked one (no need to repeat the project ID).

Claude will come back with a phased plan and ask for confirmation on the schema, storage backend, and bucket strategy before touching anything.

## 4. Get the Postgres password

> go ask insforge

Claude will probe the InsForge CLI bundle and dashboard endpoints, fail to find a programmatic path, and direct you to the dashboard (Settings → Database). The password is dashboard-only — there is no `db connection-string` or `db rotate-password` CLI command. Use this prompt mainly to confirm there isn't a CLI shortcut you're missing before clicking through the dashboard yourself.

## 5. Approve / drive each phase

Phase confirmations are just `proceed`, `yes`, `go`. Claude pauses at every reversible/irreversible boundary; you only need to type a word.

For overrides mid-run, plain English works: `dry run on one channel only first`, `keep going`, `roll back to revision 4`, `check progress`.

---

That's it. The whole InsForge side of this migration was driven by these five prompts plus single-word approvals.
