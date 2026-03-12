"""Interactive TUI dashboard for OpenAgents — `openagents` or `openagents setup`."""

import asyncio
import os
import subprocess
import sys
from pathlib import Path

from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen, Screen
from textual.widgets import (
    DataTable,
    Footer,
    Header,
    Input,
    Label,
    OptionList,
    Static,
)
from textual.widgets.option_list import Option


# ── Data helpers ────────────────────────────────────────────────────────────


def _load_agent_rows() -> list[dict]:
    """Build unified agent table: one row per configured agent, merged with
    runtime scan and daemon status."""
    from openagents.client.daemon import read_daemon_pid
    from openagents.client.daemon_config import load_config, read_status
    from openagents.client.plugin_registry import registry

    cfg = load_config()
    status = read_status() or {}
    agent_statuses = status.get("agents", {})
    pid = read_daemon_pid()

    scan = {a["name"]: a for a in registry.scan_agents()}

    rows: list[dict] = []

    # Configured agents first
    seen_types: set[str] = set()
    for agent in cfg.agents:
        seen_types.add(agent.type)
        info = agent_statuses.get(agent.name, {})
        state = info.get("state", "stopped") if pid else "stopped"
        rows.append({
            "name": agent.name,
            "type": agent.type,
            "state": state,
            "workspace": agent.network or "",
            "path": agent.path or "",
            "configured": True,
        })

    # Installed but not-configured runtimes
    for s in scan.values():
        if s["name"] not in seen_types and s["installed"]:
            rows.append({
                "name": f"({s['name']})",
                "type": s["name"],
                "state": "not configured",
                "workspace": "",
                "path": "",
                "configured": False,
            })

    return rows


def _load_catalog() -> list[dict]:
    """Return all catalog entries with installed flag and version."""
    from openagents.client.plugin_registry import registry

    scan = {a["name"]: a for a in registry.scan_agents()}
    catalog = registry.get_catalog()
    plugins = registry._plugins

    results = []
    for name, info in catalog.items():
        already = scan.get(name, {})
        installed = already.get("installed", False)
        version = ""
        if installed and name in plugins:
            version = plugins[name].get_version() or ""
        results.append({
            "name": info.name,
            "label": info.label,
            "description": info.description,
            "install_command": info.install_command,
            "installed": installed,
            "version": version,
        })
    return results


# ── State formatting ────────────────────────────────────────────────────────


_STATE_DISPLAY = {
    "online": ("●", "green"),
    "running": ("●", "green"),
    "starting": ("◐", "yellow"),
    "reconnecting": ("◐", "yellow"),
    "stopped": ("○", "dim"),
    "not configured": ("○", "dim"),
    "error": ("✗", "red"),
}


def _state_text(state: str) -> str:
    symbol, color = _STATE_DISPLAY.get(state, ("?", "white"))
    return f"[{color}]{symbol} {state}[/{color}]"


# ── Modal Screens ───────────────────────────────────────────────────────────


class InstallAgentScreen(Screen[dict | None]):
    """Full-screen table to pick an agent runtime to install or update."""

    BINDINGS = [
        Binding("escape", "cancel", "Back"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self._items = _load_catalog()

    def compose(self) -> ComposeResult:
        yield Header(icon="🌀")
        with Vertical():
            yield Label(" [bold]Install Agent Runtime[/bold]  —  Enter to install, or update an installed runtime\n")
            table = DataTable(id="install-table", cursor_type="row")
            table.add_columns("Name", "Label", "Version", "Status", "Description")
            for item in self._items:
                if item["installed"]:
                    table.add_row(
                        f"[dim]{item['name']}[/dim]",
                        f"[dim]{item['label']}[/dim]",
                        f"[dim]{item['version']}[/dim]",
                        "[green]installed[/green]",
                        f"[dim]{item['description'] or ''}[/dim]",
                    )
                else:
                    table.add_row(
                        item["name"],
                        item["label"],
                        "",
                        "[yellow]not installed[/yellow]",
                        item["description"] or "",
                    )
            yield table
        yield Footer()

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        if not self._items:
            return
        row_idx = event.cursor_row
        item = self._items[row_idx]
        action = "update" if item["installed"] else "install"
        self.dismiss({"name": item["name"], "action": action})

    def action_cancel(self) -> None:
        self.dismiss(None)


class StartAgentScreen(ModalScreen[dict | None]):
    """Prompt for agent name and working directory."""

    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def __init__(self, agent_type: str) -> None:
        super().__init__()
        self.agent_type = agent_type

    def compose(self) -> ComposeResult:
        from openagents.client.workspace_client import generate_agent_name

        default_name = generate_agent_name(self.agent_type)
        default_path = str(Path.cwd())

        with Vertical(id="modal-dialog"):
            yield Label(f"[bold]Start {self.agent_type} Agent[/bold]", id="modal-title")
            yield Label("Agent name:")
            yield Input(value=default_name, id="agent-name-input")
            yield Label("Working directory:")
            yield Input(value=default_path, id="agent-path-input")
            yield Label("[dim]Press Enter to confirm, Escape to cancel[/dim]")

    def on_input_submitted(self, event: Input.Submitted) -> None:
        name_input = self.query_one("#agent-name-input", Input)
        path_input = self.query_one("#agent-path-input", Input)
        self.dismiss({
            "name": name_input.value.strip(),
            "type": self.agent_type,
            "path": path_input.value.strip(),
        })

    def action_cancel(self) -> None:
        self.dismiss(None)


class SelectAgentTypeScreen(ModalScreen[str | None]):
    """Pick an installed agent type for starting."""

    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def compose(self) -> ComposeResult:
        from openagents.client.plugin_registry import registry

        scan = registry.scan_agents()
        installed = [a for a in scan if a["installed"]]

        with Vertical(id="modal-dialog"):
            yield Label("[bold]Select Agent Type[/bold]", id="modal-title")
            if not installed:
                yield Label("[dim]No agent runtimes installed. Install one first.[/dim]")
            else:
                ol = OptionList(id="type-list")
                for a in installed:
                    ready_mark = "[green]✓[/green]" if a["ready"] else "[yellow]![/yellow]"
                    ol.add_option(Option(f"{ready_mark} {a['label']}", id=a["name"]))
                yield ol

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        self.dismiss(str(event.option.id))

    def action_cancel(self) -> None:
        self.dismiss(None)


class ConnectWorkspaceScreen(Screen[dict | None]):
    """Full-screen table to pick a workspace to connect an agent to."""

    BINDINGS = [
        Binding("escape", "cancel", "Back"),
    ]

    # Special row IDs for create / join actions
    _ACTION_CREATE = "__create__"
    _ACTION_TOKEN = "__token__"

    def __init__(self, agent_name: str) -> None:
        super().__init__()
        self.agent_name = agent_name
        self._row_actions: list[str] = []  # parallel to table rows

    def compose(self) -> ComposeResult:
        from openagents.client.daemon_config import load_config

        cfg = load_config()

        yield Header(icon="🌀")
        with Vertical():
            yield Label(
                f" [bold]Connect '{self.agent_name}' to Workspace[/bold]"
                f"  —  Select a workspace and press Enter\n"
            )
            table = DataTable(id="connect-table", cursor_type="row")
            table.add_columns("Workspace", "URL")

            for net in cfg.networks:
                name_part = net.name or net.slug or net.id
                is_local = "localhost" in net.endpoint or "127.0.0.1" in net.endpoint
                slug = net.slug or net.id
                if is_local:
                    url = f"{net.endpoint}/{slug}"
                else:
                    url = f"https://workspace.openagents.org/{slug}"
                table.add_row(name_part, url)
                self._row_actions.append(f"existing:{slug}")

            # Action rows
            table.add_row("[bold]✚ Create new workspace[/bold]", "")
            self._row_actions.append(self._ACTION_CREATE)
            table.add_row("[bold]🔑 Join with token[/bold]", "")
            self._row_actions.append(self._ACTION_TOKEN)

            yield table
        yield Footer()

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        row_idx = event.cursor_row
        action = self._row_actions[row_idx]
        self.dismiss({"action": action, "agent": self.agent_name})

    def action_cancel(self) -> None:
        self.dismiss(None)


class TokenInputScreen(ModalScreen[str | None]):
    """Simple modal to paste a workspace token."""

    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def __init__(self, title: str = "Enter workspace token") -> None:
        super().__init__()
        self._title = title

    def compose(self) -> ComposeResult:
        with Vertical(id="modal-dialog"):
            yield Label(f"[bold]{self._title}[/bold]", id="modal-title")
            yield Input(placeholder="Paste token here…", id="token-input")
            yield Label("[dim]Press Enter to confirm, Escape to cancel[/dim]")

    def on_input_submitted(self, event: Input.Submitted) -> None:
        self.dismiss(event.value.strip() or None)

    def action_cancel(self) -> None:
        self.dismiss(None)


class TextInputScreen(ModalScreen[str | None]):
    """Generic single-line input modal."""

    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def __init__(self, title: str, default: str = "") -> None:
        super().__init__()
        self._title = title
        self._default = default

    def compose(self) -> ComposeResult:
        with Vertical(id="modal-dialog"):
            yield Label(f"[bold]{self._title}[/bold]", id="modal-title")
            yield Input(value=self._default, id="text-input")
            yield Label("[dim]Press Enter to confirm, Escape to cancel[/dim]")

    def on_input_submitted(self, event: Input.Submitted) -> None:
        self.dismiss(event.value.strip() or None)

    def action_cancel(self) -> None:
        self.dismiss(None)


# ── Main TUI App ────────────────────────────────────────────────────────────


class OpenAgentsTUI(App):
    """Interactive OpenAgents dashboard."""

    TITLE = "OpenAgents"
    SUB_TITLE = "Interactive Setup"

    CSS = """
    Screen {
        background: $surface;
    }
    #main-layout {
        height: 1fr;
    }
    #agent-panel {
        height: 1fr;
        border: round $primary;
        padding: 0 1;
    }
    #agent-panel > Label {
        margin-bottom: 1;
    }
    #log-panel {
        height: auto;
        max-height: 10;
        border: round $accent;
        padding: 0 1;
    }
    #log-content {
        height: auto;
        max-height: 8;
    }
    #modal-dialog {
        background: $surface;
        border: thick $primary;
        padding: 1 2;
        width: 70;
        max-height: 24;
        margin: 4 0;
    }
    #modal-dialog > Label {
        margin-bottom: 1;
    }
    #modal-title {
        text-style: bold;
        margin-bottom: 1;
    }
    ModalScreen {
        align: center middle;
    }
    """

    BINDINGS = [
        Binding("i", "install", "Install"),
        Binding("n", "new_agent", "New Agent"),
        Binding("s", "start_agent", "Start"),
        Binding("x", "stop_agent", "Stop"),
        Binding("c", "connect_agent", "Connect to Workspace"),
        Binding("d", "disconnect_agent", "Disconnect"),
        Binding("delete", "remove_agent", "Remove"),
        Binding("u", "daemon_up", "Daemon Up"),
        Binding("D", "daemon_down", "Daemon Down"),
        Binding("r", "refresh", "Refresh"),
        Binding("q", "quit", "Quit"),
    ]

    def compose(self) -> ComposeResult:
        yield Header(icon="🌀")
        with Vertical(id="main-layout"):
            with Vertical(id="agent-panel"):
                yield Label("[bold]Agents[/bold]")
                yield DataTable(id="agent-table")
            with Vertical(id="log-panel"):
                yield Label("[bold]Activity Log[/bold]")
                yield VerticalScroll(
                    Static("Ready.", id="log-text"),
                    id="log-content",
                )
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one("#agent-table", DataTable)
        table.cursor_type = "row"
        table.add_columns("Name", "Type", "Status", "Workspace", "Path")
        self._refresh_table()
        self.set_interval(5, self._refresh_table)

    def _refresh_table(self) -> None:
        table = self.query_one("#agent-table", DataTable)
        table.clear()
        try:
            rows = _load_agent_rows()
        except Exception:
            rows = []
        if not rows:
            table.add_row("(no agents)", "", "", "", "")
        else:
            for r in rows:
                table.add_row(
                    r["name"],
                    r["type"],
                    _state_text(r["state"]),
                    r["workspace"],
                    r["path"],
                )

    def __init__(self) -> None:
        super().__init__()
        self._log_lines: list[str] = ["Ready."]

    def _log(self, msg: str) -> None:
        self._log_lines.append(msg)
        # Keep last 50 lines
        if len(self._log_lines) > 50:
            self._log_lines = self._log_lines[-50:]
        try:
            log_widget = self.query_one("#log-text", Static)
            log_widget.update("\n".join(self._log_lines))
        except Exception:
            pass  # widget not ready or markup error

    @staticmethod
    def _workspace_url(net) -> str:
        """Build the full workspace URL with token for display."""
        slug = net.slug or net.id
        is_local = "localhost" in net.endpoint or "127.0.0.1" in net.endpoint
        if is_local:
            base = f"{net.endpoint}/{slug}"
        else:
            base = f"https://workspace.openagents.org/{slug}"
        if net.token:
            return f"{base}?token={net.token}"
        return base

    @staticmethod
    def _signal_daemon_reload():
        """Send SIGHUP to the running daemon so it reloads config."""
        from openagents.client.daemon import read_daemon_pid
        pid = read_daemon_pid()
        if pid:
            try:
                import signal
                os.kill(pid, signal.SIGHUP)
            except (ProcessLookupError, PermissionError):
                pass

    def _selected_agent(self) -> dict | None:
        table = self.query_one("#agent-table", DataTable)
        if table.row_count == 0:
            return None
        try:
            row_idx = table.cursor_row
            row = table.get_row_at(row_idx)
        except Exception:
            return None
        name = str(row[0])
        if name.startswith("("):
            return None
        return {
            "name": name,
            "type": str(row[1]),
            "state": str(row[2]),
            "workspace": str(row[3]),
            "path": str(row[4]),
        }

    # ── Actions ─────────────────────────────────────────────────────────

    def action_refresh(self) -> None:
        self._refresh_table()
        self._log("[green]✓[/green] Refreshed")

    # -- Install --

    def action_install(self) -> None:
        self.push_screen(InstallAgentScreen(), callback=self._on_install_picked)

    def _on_install_picked(self, result: dict | None) -> None:
        if not result:
            return
        agent_name = result["name"]
        action = result["action"]  # "install" or "update"
        verb = "Updating" if action == "update" else "Installing"
        self._log(f"{verb} [cyan]{agent_name}[/cyan]…")
        self._do_install(agent_name)

    @work(thread=True)
    def _do_install(self, agent_type: str) -> None:
        from openagents.client.plugin_registry import registry

        catalog = registry.get_catalog()
        info = catalog.get(agent_type)
        if not info:
            self.call_from_thread(self._log, f"[red]✗ Unknown agent type: {agent_type}[/red]")
            return

        cmd = info.install_command
        try:
            result = subprocess.run(
                cmd, shell=True, capture_output=True, text=True, timeout=300,
            )
            if result.returncode == 0:
                self.call_from_thread(self._log, f"[green]✓[/green] Installed [cyan]{agent_type}[/cyan]")
            else:
                err = result.stderr.strip()[:200] if result.stderr else "unknown error"
                self.call_from_thread(self._log, f"[red]✗ Install failed:[/red] {err}")
        except Exception as e:
            self.call_from_thread(self._log, f"[red]✗ Install error:[/red] {e}")
        self.call_from_thread(self._refresh_table)

    # -- Start --

    def action_new_agent(self) -> None:
        """Create a new agent."""
        self.push_screen(SelectAgentTypeScreen(), callback=self._on_type_picked)

    def action_start_agent(self) -> None:
        """Restart the selected stopped/error agent."""
        agent = self._selected_agent()
        if not agent:
            self._log("[yellow]Select an agent to start[/yellow]")
            return
        if "stopped" not in agent["state"] and "error" not in agent["state"]:
            self._log(f"[yellow]{agent['name']} is already running[/yellow]")
            return
        self._log(f"Starting [cyan]{agent['name']}[/cyan]…")
        self._do_restart(agent["name"])

    def _on_type_picked(self, agent_type: str | None) -> None:
        if not agent_type:
            return
        self.push_screen(StartAgentScreen(agent_type), callback=self._on_start_confirmed)

    def _on_start_confirmed(self, result: dict | None) -> None:
        if not result:
            return
        name = result["name"]
        agent_type = result["type"]
        path = result["path"]

        self._log(f"Starting [cyan]{name}[/cyan] ({agent_type}) in {path}…")
        self._do_start(name, agent_type, path)

    @work(thread=True)
    def _do_start(self, name: str, agent_type: str, path: str) -> None:
        from openagents.client.daemon_config import (
            AgentEntry,
            add_agent_to_config,
        )

        agent_entry = AgentEntry(
            name=name,
            type=agent_type,
            role="worker",
            path=path,
        )
        add_agent_to_config(agent_entry)

        # Start daemon via subprocess (avoids fork issues inside TUI)
        try:
            subprocess.Popen(
                [sys.executable, "-m", "openagents.client.cli", "up"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            self.call_from_thread(
                self._log,
                f"[green]✓[/green] Added [cyan]{name}[/cyan] and started daemon",
            )
        except Exception as e:
            self.call_from_thread(self._log, f"[red]✗ Failed to start daemon:[/red] {e}")
        import time
        time.sleep(2)
        self.call_from_thread(self._refresh_table)

    @work(thread=True)
    def _do_restart(self, name: str) -> None:
        """Restart a stopped agent by calling `openagents up`."""
        try:
            subprocess.Popen(
                [sys.executable, "-m", "openagents.client.cli", "up"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            self.call_from_thread(
                self._log,
                f"[green]✓[/green] Restarting [cyan]{name}[/cyan] via daemon",
            )
        except Exception as e:
            self.call_from_thread(self._log, f"[red]✗ Failed to restart:[/red] {e}")
        import time
        time.sleep(2)
        self.call_from_thread(self._refresh_table)

    # -- Stop --

    def action_stop_agent(self) -> None:
        agent = self._selected_agent()
        if not agent:
            self._log("[yellow]Select an agent to stop[/yellow]")
            return
        name = agent["name"]
        self._log(f"Stopping [cyan]{name}[/cyan]…")
        self._do_stop(name)

    @work(thread=True)
    def _do_stop(self, name: str) -> None:
        try:
            result = subprocess.run(
                [sys.executable, "-m", "openagents.client.cli", "stop", name],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                self.call_from_thread(self._log, f"[green]✓[/green] Stopped [cyan]{name}[/cyan]")
            else:
                err = result.stderr.strip()[:200] if result.stderr else result.stdout.strip()[:200]
                self.call_from_thread(self._log, f"[red]✗ Stop failed:[/red] {err}")
        except Exception as e:
            self.call_from_thread(self._log, f"[red]✗ Stop error:[/red] {e}")
        import time
        time.sleep(1)
        self.call_from_thread(self._refresh_table)

    # -- Remove --

    def action_remove_agent(self) -> None:
        agent = self._selected_agent()
        if not agent:
            self._log("[yellow]Select an agent to remove[/yellow]")
            return
        name = agent["name"]
        from openagents.client.daemon_config import remove_agent_from_config

        if remove_agent_from_config(name):
            self._log(f"[green]✓[/green] Removed [cyan]{name}[/cyan] from config")
        else:
            self._log(f"[red]✗ Agent '{name}' not found in config[/red]")
        self._refresh_table()

    # -- Connect --

    def action_connect_agent(self) -> None:
        agent = self._selected_agent()
        if not agent:
            self._log("[yellow]Select an agent to connect[/yellow]")
            return
        self.push_screen(
            ConnectWorkspaceScreen(agent["name"]),
            callback=self._on_connect_picked,
        )

    def _on_connect_picked(self, result: dict | None) -> None:
        if not result:
            return
        action = result["action"]
        agent_name = result["agent"]

        if action.startswith("existing:"):
            slug = action.split(":", 1)[1]
            from openagents.client.daemon_config import connect_agent_to_network, load_config

            connect_agent_to_network(agent_name, slug)
            self._signal_daemon_reload()
            cfg = load_config()
            net = next((n for n in cfg.networks if (n.slug or n.id) == slug), None)
            url = self._workspace_url(net) if net else slug
            self._log(f"[green]✓[/green] Connected [cyan]{agent_name}[/cyan] → {url}")
            self._refresh_table()

        elif action == ConnectWorkspaceScreen._ACTION_CREATE:
            self.push_screen(
                TextInputScreen("Workspace name", default=f"{agent_name}'s workspace"),
                callback=lambda name: self._on_create_workspace(agent_name, name),
            )

        elif action == ConnectWorkspaceScreen._ACTION_TOKEN:
            self.push_screen(
                TokenInputScreen(),
                callback=lambda token: self._on_join_token(agent_name, token),
            )

    def _on_create_workspace(self, agent_name: str, ws_name: str | None) -> None:
        if not ws_name:
            return
        self._log(f"Creating workspace [bold]{ws_name}[/bold]…")
        self._do_create_workspace(agent_name, ws_name)

    @work(thread=True)
    def _do_create_workspace(self, agent_name: str, ws_name: str) -> None:
        try:
            result = subprocess.run(
                [
                    sys.executable, "-m", "openagents.client.cli",
                    "workspace", "create", "--name", ws_name,
                ],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                # Re-load config to find the newly created network
                from openagents.client.daemon_config import (
                    connect_agent_to_network,
                    load_config,
                )

                cfg = load_config()
                if cfg.networks:
                    last_net = cfg.networks[-1]
                    connect_agent_to_network(agent_name, last_net.slug or last_net.id)
                    self._signal_daemon_reload()
                    url = self._workspace_url(last_net)
                    self.call_from_thread(
                        self._log,
                        f"[green]✓[/green] Created & connected → {url}",
                    )
                else:
                    self.call_from_thread(
                        self._log, "[green]✓[/green] Workspace created"
                    )
            else:
                err = (result.stderr or result.stdout).strip()[:200]
                self.call_from_thread(self._log, f"[red]✗ Create failed:[/red] {err}")
        except Exception as e:
            self.call_from_thread(self._log, f"[red]✗ Error:[/red] {e}")
        self.call_from_thread(self._refresh_table)

    def _on_join_token(self, agent_name: str, token: str | None) -> None:
        if not token:
            return
        self._log(f"Joining workspace with token…")
        self._do_join_token(agent_name, token)

    @work(thread=True)
    def _do_join_token(self, agent_name: str, token: str) -> None:
        try:
            result = subprocess.run(
                [
                    sys.executable, "-m", "openagents.client.cli",
                    "workspace", "join", token,
                ],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                from openagents.client.daemon_config import (
                    connect_agent_to_network,
                    load_config,
                )

                cfg = load_config()
                if cfg.networks:
                    last_net = cfg.networks[-1]
                    connect_agent_to_network(agent_name, last_net.slug or last_net.id)
                    self._signal_daemon_reload()
                    url = self._workspace_url(last_net)
                    self.call_from_thread(
                        self._log,
                        f"[green]✓[/green] Joined & connected [cyan]{agent_name}[/cyan] → {url}",
                    )
                else:
                    self.call_from_thread(
                        self._log,
                        f"[green]✓[/green] Joined & connected [cyan]{agent_name}[/cyan]",
                    )
            else:
                err = (result.stderr or result.stdout).strip()[:200]
                self.call_from_thread(self._log, f"[red]✗ Join failed:[/red] {err}")
        except Exception as e:
            self.call_from_thread(self._log, f"[red]✗ Error:[/red] {e}")
        self.call_from_thread(self._refresh_table)

    # -- Disconnect --

    def action_disconnect_agent(self) -> None:
        agent = self._selected_agent()
        if not agent:
            self._log("[yellow]Select an agent to disconnect[/yellow]")
            return
        name = agent["name"]
        from openagents.client.daemon_config import disconnect_agent_from_network

        if disconnect_agent_from_network(name):
            self._signal_daemon_reload()
            self._log(f"[green]✓[/green] Disconnected [cyan]{name}[/cyan]")
        else:
            self._log(f"[red]✗ Agent '{name}' not found[/red]")
        self._refresh_table()

    # -- Daemon up/down --

    def action_daemon_up(self) -> None:
        self._log("Starting daemon…")
        self._do_daemon_up()

    @work(thread=True)
    def _do_daemon_up(self) -> None:
        try:
            subprocess.Popen(
                [sys.executable, "-m", "openagents.client.cli", "up"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            self.call_from_thread(self._log, "[green]✓[/green] Daemon starting…")
        except Exception as e:
            self.call_from_thread(self._log, f"[red]✗ Failed:[/red] {e}")
        import time
        time.sleep(3)
        self.call_from_thread(self._refresh_table)

    def action_daemon_down(self) -> None:
        self._log("Stopping daemon…")
        self._do_daemon_down()

    @work(thread=True)
    def _do_daemon_down(self) -> None:
        try:
            result = subprocess.run(
                [sys.executable, "-m", "openagents.client.cli", "down"],
                capture_output=True, text=True, timeout=15,
            )
            if result.returncode == 0:
                self.call_from_thread(self._log, "[green]✓[/green] Daemon stopped")
            else:
                err = (result.stderr or result.stdout).strip()[:200]
                self.call_from_thread(self._log, f"[yellow]⚠ {err}[/yellow]")
        except Exception as e:
            self.call_from_thread(self._log, f"[red]✗ Error:[/red] {e}")
        import time
        time.sleep(1)
        self.call_from_thread(self._refresh_table)


# ── Entry point ─────────────────────────────────────────────────────────────


def launch_tui() -> None:
    """Launch the interactive TUI dashboard."""
    app = OpenAgentsTUI()
    app.run()
