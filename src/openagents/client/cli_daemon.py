"""CLI daemon commands — up/down/status/start/stop/connect/disconnect/add/remove + workspace."""

import json
import logging
import os
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from typing import Optional

import typer
from rich.panel import Panel
from rich.prompt import Confirm, Prompt
from rich.table import Table
from rich import box

from openagents.client.cli_shared import app, console

workspace_app = typer.Typer(
    name="workspace",
    help="Workspace management \u2014 create, join, and list workspaces",
    rich_markup_mode="rich",
)
app.add_typer(workspace_app, name="workspace")

@app.command("up")
def daemon_up(
    config: Optional[str] = typer.Option(
        None, "--config", "-c", help="Path to daemon config YAML",
    ),
    foreground: bool = typer.Option(
        False, "--foreground", "-f", help="Run in foreground (don't daemonize)",
    ),
):
    """🚀 Start the OpenAgents daemon — run all configured agents."""
    import asyncio
    from openagents.client.daemon_config import load_config, get_agent_network
    from openagents.client.daemon import DaemonManager, daemonize, read_daemon_pid

    # Check if already running
    existing_pid = read_daemon_pid()
    if existing_pid:
        console.print(Panel(
            f"[yellow]Daemon already running[/yellow] (PID {existing_pid})\n\n"
            "Run [bold]openagents down[/bold] first, or [bold]openagents status[/bold] to check.",
            title="[yellow]Already Running[/yellow]",
            border_style="yellow",
        ))
        raise typer.Exit(1)

    cfg = load_config(config)
    if not cfg.agents:
        console.print(Panel(
            "[yellow]No agents configured.[/yellow]\n\n"
            "Get started: [bold]openagents start openclaw[/bold]",
            title="[yellow]No Agents[/yellow]",
            border_style="yellow",
        ))
        raise typer.Exit(1)

    # Print summary
    network_count = len(set(a.network for a in cfg.agents if a.network))
    local_count = sum(1 for a in cfg.agents if not a.network)

    table = Table(
        title=f"Starting {len(cfg.agents)} agent(s)",
        box=box.ROUNDED,
        title_style="bold",
    )
    table.add_column("Agent", style="cyan")
    table.add_column("Type")
    table.add_column("Role")
    table.add_column("Network", style="dim")
    for a in cfg.agents:
        net = get_agent_network(a, cfg)
        net_label = net.slug if net else "[dim](local)[/dim]"
        table.add_row(a.name, a.type, a.role, net_label)
    console.print()
    console.print(table)
    console.print()

    if not foreground:
        daemonize()
    else:
        console.print("[dim]Running in foreground. Press Ctrl+C to stop.[/dim]\n")

    manager = DaemonManager(cfg, config_path=config)
    try:
        asyncio.run(manager.start())
    except KeyboardInterrupt:
        console.print("\n[yellow]Daemon stopped.[/yellow]")


@app.command("down")
def daemon_down():
    """⏹ Stop the OpenAgents daemon."""
    from openagents.client.daemon import stop_daemon, read_daemon_pid

    pid = read_daemon_pid()
    if pid is None:
        console.print("  [dim]No daemon is running.[/dim]")
        raise typer.Exit(0)

    console.print(f"  Stopping daemon (PID {pid})...")
    if stop_daemon():
        console.print("  [green]✓ Daemon stopped.[/green]")
    else:
        console.print("  [red]✗ Failed to stop daemon.[/red]")
        raise typer.Exit(1)


@app.command("status")
def daemon_status():
    """📋 Show status of the OpenAgents daemon and managed agents."""
    from openagents.client.daemon import read_daemon_pid
    from openagents.client.daemon_config import read_status, load_config

    pid = read_daemon_pid()
    status_data = read_status()

    if pid is None:
        cfg = load_config()
        if cfg.agents:
            console.print(Panel(
                f"[dim]Daemon is not running.[/dim]\n\n"
                f"  {len(cfg.agents)} agent(s) configured\n\n"
                "Start with: [bold]openagents up[/bold]",
                title="[dim]Daemon Stopped[/dim]",
                border_style="dim",
            ))
        else:
            console.print(Panel(
                "[dim]Daemon is not running. No agents configured.[/dim]\n\n"
                "Get started: [bold]openagents start openclaw[/bold]",
                title="[dim]Daemon Stopped[/dim]",
                border_style="dim",
            ))
        return

    console.print(f"\n  [green]●[/green] Daemon running (PID {pid})")

    if not status_data or "agents" not in status_data:
        console.print("  [dim]Waiting for status...[/dim]")
        return

    updated = status_data.get("updated_at", "")
    if updated:
        console.print(f"  [dim]Last updated: {updated}[/dim]")

    table = Table(box=box.ROUNDED, show_header=True, header_style="bold")
    table.add_column("Agent", style="cyan")
    table.add_column("Type")
    table.add_column("Network", style="dim")
    table.add_column("State")
    table.add_column("Restarts", justify="center")
    table.add_column("Error", style="dim", max_width=40)

    for name, info in status_data["agents"].items():
        state = info.get("state", "unknown")
        state_style = {
            "online": "[green]● online[/green]",
            "running": "[green]● running[/green]",
            "starting": "[yellow]◐ starting[/yellow]",
            "reconnecting": "[yellow]◐ reconnecting[/yellow]",
            "stopped": "[dim]○ stopped[/dim]",
            "error": "[red]✗ error[/red]",
        }.get(state, state)

        table.add_row(
            name,
            info.get("type", ""),
            info.get("network", info.get("workspace", "")) or "[dim](local)[/dim]",
            state_style,
            str(info.get("restarts", 0)),
            info.get("last_error", "") or "",
        )

    console.print()
    console.print(table)


@app.command("logs")
def daemon_logs(
    agent: Optional[str] = typer.Argument(
        None, help="Filter logs by agent name",
    ),
    follow: bool = typer.Option(
        False, "--follow", "-f", help="Follow log output (like tail -f)",
    ),
    lines: int = typer.Option(
        50, "--lines", "-n", help="Number of lines to show",
    ),
):
    """View daemon and agent logs."""
    from openagents.client.daemon_config import LOG_PATH

    if not LOG_PATH.exists():
        console.print("[yellow]No log file found. Is the daemon running?[/yellow]")
        console.print(f"[dim]Expected: {LOG_PATH}[/dim]")
        raise typer.Exit(1)

    if follow:
        # Tail -f mode
        console.print(f"[dim]Following {LOG_PATH}" + (f" (filter: {agent})" if agent else "") + "[/dim]")
        console.print("[dim]Press Ctrl+C to stop[/dim]\n")
        try:
            cmd = ["tail", "-f", "-n", str(lines), str(LOG_PATH)]
            if agent:
                # Pipe through grep for agent filtering
                tail = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True)
                try:
                    for line in tail.stdout:
                        if agent in line:
                            console.print(line.rstrip())
                except KeyboardInterrupt:
                    pass
                finally:
                    tail.terminate()
                    tail.wait()
            else:
                subprocess.run(cmd)
        except KeyboardInterrupt:
            pass
    else:
        # Static view
        try:
            with open(LOG_PATH, "r") as f:
                all_lines = f.readlines()
        except OSError as e:
            console.print(f"[red]Cannot read log file: {e}[/red]")
            raise typer.Exit(1)

        if agent:
            all_lines = [l for l in all_lines if agent in l]

        tail_lines = all_lines[-lines:]
        if not tail_lines:
            console.print("[yellow]No matching log entries found.[/yellow]")
            return

        for line in tail_lines:
            console.print(line.rstrip())

        total = len(all_lines)
        if total > lines:
            console.print(f"\n[dim]Showing last {lines} of {total} lines. Use -n to show more, -f to follow.[/dim]")


@app.command("start")
def daemon_start_agent(
    agent_type: str = typer.Argument(
        ..., help="Agent type (claude, openclaw, codex, etc.)",
    ),
    name: Optional[str] = typer.Option(
        None, "--name", "-n", help="Agent name (default: same as type)",
    ),
    path: Optional[str] = typer.Option(
        None, "--path", "-p", help="Working directory for the agent",
    ),
    role: str = typer.Option(
        "worker", "--role", "-r", help="Agent role (master/worker)",
    ),
    create_workspace: Optional[str] = typer.Option(
        None, "--create-workspace", help="Create a workspace with the given name and connect the agent",
    ),
    join_workspace: Optional[str] = typer.Option(
        None, "--join-workspace", help="Join an existing workspace using a token and connect the agent",
    ),
    no_browser: bool = typer.Option(
        False, "--no-browser", help="Don't open browser after workspace setup",
    ),
):
    """🚀 Start an agent — creates it if it doesn't exist yet."""
    from rich.progress import Progress, SpinnerColumn, TextColumn

    from openagents.client.daemon_config import (
        load_config, AgentEntry, add_agent_to_config, find_agent_in_config,
        get_agent_network,
    )
    from openagents.client.plugin_registry import registry
    from openagents.client.daemon import read_daemon_pid

    # Validate agent type
    plugin = registry.get(agent_type)
    if plugin is None:
        console.print(Panel(
            f"[red]Unknown agent type:[/red] [bold]{agent_type}[/bold]\n\n"
            f"[bold cyan]Available types:[/bold cyan] {', '.join(registry.list_names())}\n\n"
            f"Search for more: [bold]openagents search {agent_type}[/bold]",
            title="[red]Agent Not Found[/red]",
            border_style="red",
        ))
        raise typer.Exit(1)

    if not plugin.is_installed():
        console.print(Panel(
            f"[yellow]{plugin.label} is not installed.[/yellow]\n\n"
            f"Install with: [bold]openagents install {agent_type}[/bold]",
            title="[yellow]Not Installed[/yellow]",
            border_style="yellow",
        ))
        raise typer.Exit(1)

    # Check readiness (credentials, config)
    ready, message = plugin.check_ready()
    if ready:
        console.print(f"  [green]✓[/green] {plugin.label} — {message}")
    else:
        console.print(f"  [yellow]![/yellow] {plugin.label} — {message}")
        if not Confirm.ask("  Continue anyway?", default=False):
            raise typer.Exit(0)

    # Default name = agent type (e.g. "claude")
    if not name:
        name = agent_type

    # Idempotent: if agent already exists, just ensure daemon is running
    existing = find_agent_in_config(name)
    if existing:
        console.print(f"  [dim]Agent '{name}' already configured.[/dim]")
        pid = read_daemon_pid()
        if pid:
            console.print(f"  [green]✓[/green] Daemon running (PID {pid})")
            return
        # Daemon not running — start it
        _start_daemon()
        return

    # Create new agent entry
    agent_entry = AgentEntry(
        name=name,
        type=agent_type,
        role=role,
        path=path,
    )

    console.print(f"\n  [green]✓[/green] Created [cyan]{name}[/cyan] ({agent_type})")
    if path:
        console.print(f"    Working dir: {path}")

    # Determine workspace setup mode:
    # --create-workspace or --join-workspace flags skip the interactive prompt
    cfg = load_config()

    if create_workspace and join_workspace:
        console.print("[red]Cannot use --create-workspace and --join-workspace together.[/red]")
        raise typer.Exit(1)

    if create_workspace:
        # Flag mode: create workspace non-interactively
        add_agent_to_config(agent_entry)
        net_entry = _resolve_or_create_network(
            join_id=None, token=None,
            endpoint="https://workspace-endpoint.openagents.org",
            agent_name=name, agent_type=agent_type,
            workspace_name=create_workspace,
        )
        if net_entry:
            from openagents.client.daemon_config import (
                add_network_to_config, connect_agent_to_network,
            )
            add_network_to_config(net_entry)
            connect_agent_to_network(name, net_entry.slug or net_entry.id)
            if not no_browser:
                frontend_url = "https://workspace-endpoint.openagents.org".replace(
                    "workspace-endpoint", "workspace"
                )
                ws_url = f"{frontend_url}/{net_entry.slug}?token={net_entry.token}"
                try:
                    webbrowser.open(ws_url)
                except Exception:
                    pass

    elif join_workspace:
        # Flag mode: join workspace non-interactively
        add_agent_to_config(agent_entry)
        import asyncio
        from openagents.client.workspace_client import WorkspaceClient
        from openagents.client.daemon_config import (
            NetworkEntry, add_network_to_config, connect_agent_to_network,
        )
        client = WorkspaceClient(endpoint="https://workspace-endpoint.openagents.org")
        try:
            info = asyncio.run(client.resolve_token(join_workspace.strip()))
            ws_id = info["workspace_id"]
            slug = info.get("slug", ws_id)
            ws_name = info.get("name", slug)

            asyncio.run(client.join_network(
                agent_name=name,
                network=None,
                token=join_workspace.strip(),
                agent_type=agent_type,
                server_host=socket.gethostname(),
                working_dir=os.getcwd(),
            ))

            net_entry = NetworkEntry(
                id=ws_id, slug=slug, name=ws_name,
                token=join_workspace.strip(),
                endpoint="https://workspace-endpoint.openagents.org",
            )
            add_network_to_config(net_entry)
            connect_agent_to_network(name, slug or ws_id)
            console.print(
                f"  [green]Joined workspace:[/green] [bold]{ws_name}[/bold]"
            )
            if not no_browser:
                frontend_url = "https://workspace-endpoint.openagents.org".replace(
                    "workspace-endpoint", "workspace"
                )
                ws_url = f"{frontend_url}/{slug}?token={join_workspace.strip()}"
                try:
                    webbrowser.open(ws_url)
                except Exception:
                    pass
        except Exception as e:
            console.print(f"  [red]Failed to join: {e}[/red]")

    elif cfg.networks:
        # Auto-connect to first workspace already in config
        net = cfg.networks[0]
        agent_entry.network = net.slug or net.id
        add_agent_to_config(agent_entry)
        console.print(
            f"  Connected to workspace: [bold]{net.name or net.slug}[/bold]"
        )
    else:
        # No workspace and no flags — interactive prompt
        add_agent_to_config(agent_entry)
        console.print()
        choice = Prompt.ask(
            "  Set up a workspace?\n\n"
            "  [bold]1[/bold] Create a new workspace (free)\n"
            "  [bold]2[/bold] Join with a token\n"
            "  [bold]3[/bold] Skip — run locally only\n\n"
            "  Choice",
            choices=["1", "2", "3"],
            default="3",
        )

        if choice == "1":
            # Create workspace inline
            ws_name = Prompt.ask("  Workspace name", default=f"{name}'s workspace")
            net_entry = _resolve_or_create_network(
                join_id=None, token=None,
                endpoint="https://workspace-endpoint.openagents.org",
                agent_name=name, agent_type=agent_type,
                workspace_name=ws_name,
            )
            if net_entry:
                from openagents.client.daemon_config import (
                    add_network_to_config, connect_agent_to_network,
                )
                add_network_to_config(net_entry)
                connect_agent_to_network(name, net_entry.slug or net_entry.id)
                if not no_browser:
                    frontend_url = "https://workspace-endpoint.openagents.org".replace(
                        "workspace-endpoint", "workspace"
                    )
                    ws_url = f"{frontend_url}/{net_entry.slug}?token={net_entry.token}"
                    try:
                        webbrowser.open(ws_url)
                    except Exception:
                        pass

        elif choice == "2":
            # Join with token
            ws_token = Prompt.ask("  Paste workspace token")
            if ws_token.strip():
                import asyncio
                from openagents.client.workspace_client import WorkspaceClient
                from openagents.client.daemon_config import (
                    NetworkEntry, add_network_to_config, connect_agent_to_network,
                )
                client = WorkspaceClient(endpoint="https://workspace-endpoint.openagents.org")
                try:
                    info = asyncio.run(client.resolve_token(ws_token.strip()))
                    ws_id = info["workspace_id"]
                    slug = info.get("slug", ws_id)
                    ws_name = info.get("name", slug)

                    asyncio.run(client.join_network(
                        agent_name=name,
                        network=None,
                        token=ws_token.strip(),
                        agent_type=agent_type,
                        server_host=socket.gethostname(),
                        working_dir=os.getcwd(),
                    ))

                    net_entry = NetworkEntry(
                        id=ws_id, slug=slug, name=ws_name,
                        token=ws_token.strip(),
                        endpoint="https://workspace-endpoint.openagents.org",
                    )
                    add_network_to_config(net_entry)
                    connect_agent_to_network(name, slug or ws_id)
                    console.print(
                        f"  [green]Joined workspace:[/green] [bold]{ws_name}[/bold]"
                    )
                    if not no_browser:
                        frontend_url = "https://workspace-endpoint.openagents.org".replace(
                            "workspace-endpoint", "workspace"
                        )
                        ws_url = f"{frontend_url}/{slug}?token={ws_token.strip()}"
                        try:
                            webbrowser.open(ws_url)
                        except Exception:
                            pass
                except Exception as e:
                    console.print(f"  [red]Failed to join: {e}[/red]")

        # else choice == "3": skip, run locally

    # Start daemon
    _start_daemon()


@app.command("stop")
def daemon_stop_agent(
    agent_name: Optional[str] = typer.Argument(
        None, help="Agent name to stop (omit to stop all / stop daemon)",
    ),
):
    """Stop an agent or the entire daemon."""
    from openagents.client.daemon import read_daemon_pid, stop_daemon
    from openagents.client.daemon_config import find_agent_in_config

    pid = read_daemon_pid()
    if pid is None:
        console.print("[dim]Daemon is not running.[/dim]")
        return

    if agent_name:
        from openagents.client.daemon_config import CMD_PATH, read_status
        agent = find_agent_in_config(agent_name)
        if agent is None:
            console.print(f"[red]Agent '{agent_name}' not found.[/red]")
            raise typer.Exit(1)
        # Check if agent is actually running
        status_data = read_status()
        agents_status = status_data.get("agents", {}) if status_data else {}
        agent_state = agents_status.get(agent_name, {}).get("state", "unknown")
        if agent_state in ("stopped", "unknown"):
            console.print(f"[dim]Agent '{agent_name}' is not running.[/dim]")
            return
        # Write stop command for daemon to pick up
        CMD_PATH.parent.mkdir(parents=True, exist_ok=True)
        CMD_PATH.write_text(f"stop:{agent_name}\n")
        console.print(f"Stopping [cyan]{agent_name}[/cyan]...")
        # Wait briefly for the daemon to process the command
        import time
        for _ in range(6):
            time.sleep(1)
            status_data = read_status()
            agents_status = status_data.get("agents", {}) if status_data else {}
            if agents_status.get(agent_name, {}).get("state") == "stopped":
                console.print(f"[green]Agent '{agent_name}' stopped.[/green]")
                return
        console.print(f"[yellow]Stop command sent. Check status with:[/yellow] [bold]openagents status[/bold]")
        return

    # Stop entire daemon
    console.print(f"Stopping daemon (PID {pid})...")
    if stop_daemon():
        console.print("[green]Daemon stopped.[/green]")
    else:
        console.print("[red]Failed to stop daemon.[/red]")
        raise typer.Exit(1)


@app.command("create", hidden=True)
def daemon_create(
    agent_type: str = typer.Argument(..., help="Agent type"),
    name: Optional[str] = typer.Option(None, "--name", "-n"),
    path: Optional[str] = typer.Option(None, "--path", "-p"),
    role: str = typer.Option("worker", "--role", "-r"),
):
    """[hidden] Alias for 'start'. Use 'openagents start' instead."""
    daemon_start_agent(agent_type=agent_type, name=name, path=path, role=role)


def _start_daemon():
    """Start the daemon if not already running."""
    import asyncio
    from openagents.client.daemon import read_daemon_pid, DaemonManager, daemonize
    from openagents.client.daemon_config import load_config, get_agent_network

    pid = read_daemon_pid()
    if pid:
        console.print(f"  [green]✓[/green] Daemon already running (PID {pid})")
        return

    cfg = load_config()
    if not cfg.agents:
        console.print("  [dim]No agents configured.[/dim]")
        return

    table = Table(box=box.ROUNDED, show_header=True, header_style="bold")
    table.add_column("Agent", style="cyan")
    table.add_column("Type")
    table.add_column("Network", style="dim")
    for a in cfg.agents:
        net = get_agent_network(a, cfg)
        table.add_row(a.name, a.type, net.slug if net else "[dim](local)[/dim]")
    console.print()
    console.print(table)
    console.print()

    daemonize()
    manager = DaemonManager(cfg)
    try:
        asyncio.run(manager.start())
    except KeyboardInterrupt:
        console.print("\n  [yellow]Daemon stopped.[/yellow]")


@app.command("connect")
def daemon_connect_agent(
    agent_name: str = typer.Argument(..., help="Name of the agent to connect"),
    network: Optional[str] = typer.Argument(
        None, help="Network slug, ID, or URL (optional if using --token)",
    ),
    token: Optional[str] = typer.Option(
        None, "--token", "-t", help="Workspace token (can be used alone — workspace is resolved from token)",
    ),
    role: Optional[str] = typer.Option(
        None, "--role", "-r", help="Agent role in the network",
    ),
    endpoint: str = typer.Option(
        "https://workspace-endpoint.openagents.org", "--endpoint",
        envvar="OA_ENDPOINT",
    ),
):
    """Attach an agent to a remote network (Layer 2).

    You can connect using just a token — the workspace is resolved automatically:

        openagents connect my-bot --token <token>
    """
    import asyncio
    from openagents.client.daemon_config import (
        load_config, find_agent_in_config, find_network_in_config,
        NetworkEntry, add_network_to_config, connect_agent_to_network,
        add_agent_to_config, AgentEntry,
    )

    # Find agent
    agent = find_agent_in_config(agent_name)
    if agent is None:
        console.print(f"[red]Agent '{agent_name}' not found.[/red]")
        console.print("Start it first: [bold]openagents start " + agent_name.split("-")[0] + " --name " + agent_name + "[/bold]")
        raise typer.Exit(1)

    if agent.network:
        console.print(
            f"[yellow]{agent_name} is already connected to '{agent.network}'.[/yellow]"
        )
        if not Confirm.ask("Reconnect to a different network?", default=False):
            raise typer.Exit(0)

    net_entry = None

    # If network slug/id provided, check config first
    if network:
        net_entry = find_network_in_config(network)

    if net_entry is None:
        # Need token — either provided or prompted
        if not token:
            token = Prompt.ask("Workspace token")

        if network:
            # Have both network ID and token — join directly
            net_entry = _resolve_or_create_network(
                network, token, endpoint, agent_name, agent.type,
            )
        else:
            # Token-only: resolve workspace from token
            from openagents.client.workspace_client import WorkspaceClient

            client = WorkspaceClient(endpoint=endpoint)
            try:
                info = asyncio.run(client.resolve_token(token))
                ws_id = info["workspace_id"]
                slug = info.get("slug", ws_id)
                ws_name = info.get("name", slug)

                # Join the workspace
                asyncio.run(client.join_network(
                    agent_name=agent_name,
                    network=None,
                    token=token,
                    agent_type=agent.type,
                    server_host=socket.gethostname(),
                    working_dir=os.getcwd(),
                ))

                net_entry = NetworkEntry(
                    id=ws_id, slug=slug, name=ws_name,
                    token=token, endpoint=endpoint,
                )
            except Exception as e:
                console.print(f"[red]Failed to join: {e}[/red]")
                raise typer.Exit(1)

        if net_entry is None:
            raise typer.Exit(1)

        add_network_to_config(net_entry)

    # Update role if provided
    if role:
        agent.role = role
        add_agent_to_config(agent)

    # Connect
    connect_agent_to_network(agent_name, net_entry.slug or net_entry.id)
    console.print(
        f"\n[green]Connected[/green] [cyan]{agent_name}[/cyan] ({agent.type}) "
        f"→ [bold]{net_entry.name or net_entry.slug}[/bold]"
    )
    console.print("Run [bold]openagents up[/bold] to start.")


@app.command("disconnect")
def daemon_disconnect_agent(
    agent_name: str = typer.Argument(..., help="Name of the agent to disconnect"),
):
    """Detach an agent from its network (becomes local-only)."""
    from openagents.client.daemon_config import (
        find_agent_in_config, disconnect_agent_from_network,
    )

    agent = find_agent_in_config(agent_name)
    if agent is None:
        console.print(f"[red]Agent '{agent_name}' not found.[/red]")
        raise typer.Exit(1)

    if not agent.network:
        console.print(f"[dim]{agent_name} is already local-only.[/dim]")
        raise typer.Exit(0)

    old_network = agent.network
    disconnect_agent_from_network(agent_name)
    console.print(
        f"[green]Disconnected[/green] [cyan]{agent_name}[/cyan] from {old_network}. "
        f"Agent will run locally."
    )


@app.command("add", hidden=True)
def daemon_add(
    agent_type: str = typer.Argument(
        ..., help="Agent type to add (claude, openclaw, codex)",
    ),
    name: Optional[str] = typer.Option(
        None, "--name", "-n", help="Agent name (default: auto-generated)",
    ),
    join: Optional[str] = typer.Option(
        None, "--join", "-j", help="Network/workspace ID or slug to join",
    ),
    token: Optional[str] = typer.Option(
        None, "--token", "-t", help="Network token",
    ),
    workspace_name: Optional[str] = typer.Option(
        None, "--workspace-name", "-w", help="New workspace name (if creating)",
    ),
    role: str = typer.Option(
        "worker", "--role", "-r", help="Agent role (master/worker)",
    ),
    endpoint: str = typer.Option(
        "https://workspace-endpoint.openagents.org", "--endpoint",
        envvar="OA_ENDPOINT",
    ),
):
    """[deprecated] Use 'create' + 'connect' instead. Kept for backward compat."""
    import asyncio
    from openagents.client.daemon_config import (
        load_config, AgentEntry, NetworkEntry,
        add_network_to_config, add_agent_to_config,
        connect_agent_to_network,
    )
    from openagents.client.agent_setup import detect_runtimes
    from openagents.client.workspace_client import generate_agent_name

    # Validate agent type
    runtimes = detect_runtimes()
    if agent_type not in runtimes:
        console.print(f"[red]Unknown agent type: {agent_type}[/red]")
        console.print(f"Available types: {', '.join(runtimes.keys())}")
        raise typer.Exit(1)

    rt = runtimes[agent_type]
    if not rt["installed"]:
        console.print(f"[yellow]{rt['label']} is not installed.[/yellow]")
        console.print(f"Install with: [bold]{rt['install']}[/bold]")
        if not Confirm.ask("Continue anyway?", default=False):
            raise typer.Exit(0)

    if rt["path"]:
        console.print(f"[green]{rt['label']}[/green] detected at {rt['path']}\n")

    # Resolve agent name
    if not name:
        name = generate_agent_name(agent_type)

    # Create agent entry
    agent_entry = AgentEntry(name=name, type=agent_type, role=role)

    if join:
        # Join network — resolve and connect
        if not token:
            token = Prompt.ask("Network token")
        net_entry = _resolve_or_create_network(
            join, token, endpoint, name, agent_type, workspace_name,
        )
        if net_entry is None:
            raise typer.Exit(1)
        agent_entry.network = net_entry.slug or net_entry.id
        add_network_to_config(net_entry)
        add_agent_to_config(agent_entry)
        console.print(
            f"\n[green]Added[/green] [cyan]{name}[/cyan] ({agent_type}) "
            f"→ [bold]{net_entry.name or net_entry.slug}[/bold]"
        )
    else:
        # Local-only (no network)
        add_agent_to_config(agent_entry)
        console.print(f"\n[green]Added[/green] [cyan]{name}[/cyan] ({agent_type}), local-only.")

    console.print("Run [bold]openagents up[/bold] to start all agents.")


# ---------------------------------------------------------------------------
# Workspace commands
# ---------------------------------------------------------------------------

@workspace_app.command("create")
def workspace_create(
    name: Optional[str] = typer.Option(
        None, "--name", "-n", help="Workspace name",
    ),
    endpoint: str = typer.Option(
        "https://workspace-endpoint.openagents.org", "--endpoint",
        envvar="OA_ENDPOINT",
    ),
):
    """🌐 Create a new workspace and get a token."""
    import asyncio
    from rich.progress import Progress, SpinnerColumn, TextColumn

    from openagents.client.workspace_client import WorkspaceClient, generate_agent_name
    from openagents.client.daemon_config import (
        NetworkEntry, add_network_to_config, load_config,
    )

    ws_name = name or Prompt.ask("  Workspace name", default="my-workspace")
    agent_name = generate_agent_name("cli")

    client = WorkspaceClient(endpoint=endpoint)

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Creating workspace...", total=None)
        try:
            ws = asyncio.run(client.create_workspace(agent_name, ws_name))
            progress.update(task, description="[green]✓ Workspace created[/green]")
        except Exception as e:
            progress.update(task, description="[red]✗ Failed[/red]")
            console.print(Panel(
                f"[red]Failed to create workspace:[/red] {e}",
                title="[red]Error[/red]",
                border_style="red",
            ))
            raise typer.Exit(1)

    # Save to config
    net_entry = NetworkEntry(
        id=ws.workspace_id,
        slug=ws.slug,
        name=ws.name,
        token=ws.token,
        endpoint=endpoint,
    )
    add_network_to_config(net_entry)

    console.print(Panel(
        f"[bold]{ws.name}[/bold]\n\n"
        f"  Slug   [dim]{ws.slug}[/dim]\n"
        f"  Token  [bold]{ws.token}[/bold]\n"
        f"  URL    [link={ws.url}]{ws.url}[/link]\n\n"
        f"Share this token to invite others:\n"
        f"  [bold]openagents workspace join {ws.token}[/bold]\n\n"
        f"Connect an agent:\n"
        f"  [bold]openagents start openclaw[/bold]",
        title="[green]✓ Workspace Created[/green]",
        border_style="green",
    ))


@workspace_app.command("join")
def workspace_join(
    token: str = typer.Argument(..., help="Workspace token"),
    endpoint: str = typer.Option(
        "https://workspace-endpoint.openagents.org", "--endpoint",
        envvar="OA_ENDPOINT",
    ),
):
    """🔗 Join an existing workspace using a token."""
    import asyncio
    from rich.progress import Progress, SpinnerColumn, TextColumn

    from openagents.client.workspace_client import WorkspaceClient
    from openagents.client.daemon_config import (
        NetworkEntry, add_network_to_config, find_network_in_config,
    )

    client = WorkspaceClient(endpoint=endpoint)

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Resolving token...", total=None)

        # Resolve token to workspace info
        try:
            info = asyncio.run(client.resolve_token(token))
            progress.update(task, description="[green]✓ Token resolved[/green]")
        except Exception as e:
            progress.update(task, description="[red]✗ Failed[/red]")
            console.print(Panel(
                f"[red]Invalid token:[/red] {e}",
                title="[red]Error[/red]",
                border_style="red",
            ))
            raise typer.Exit(1)

    ws_id = info["workspace_id"]
    slug = info.get("slug", ws_id)
    name = info.get("name", slug)

    # Check if already in config
    existing = find_network_in_config(slug) or find_network_in_config(ws_id)
    if existing:
        console.print(f"  [dim]Already joined workspace '{existing.name or existing.slug}'.[/dim]")
        return

    # Save to config
    net_entry = NetworkEntry(
        id=ws_id,
        slug=slug,
        name=name,
        token=token,
        endpoint=endpoint,
    )
    add_network_to_config(net_entry)

    frontend_url = endpoint.replace("workspace-endpoint", "workspace").replace("/v1", "")
    ws_url = f"{frontend_url}/{slug}?token={token}"

    console.print(Panel(
        f"[bold]{name}[/bold]\n\n"
        f"  URL  [link={ws_url}]{ws_url}[/link]\n\n"
        f"Connect an agent:\n"
        f"  [bold]openagents start openclaw[/bold]",
        title="[green]✓ Joined Workspace[/green]",
        border_style="green",
    ))


@workspace_app.command("list")
def workspace_list():
    """📋 List configured workspaces."""
    from openagents.client.daemon_config import load_config

    cfg = load_config()
    if not cfg.networks:
        console.print(Panel(
            "[dim]No workspaces configured.[/dim]\n\n"
            "Create one:  [bold]openagents workspace create[/bold]\n"
            "Or join:     [bold]openagents workspace join <token>[/bold]",
            title="[dim]No Workspaces[/dim]",
            border_style="dim",
        ))
        return

    table = Table(
        title="Workspaces",
        box=box.ROUNDED,
        title_style="bold",
        show_header=True,
        header_style="bold",
    )
    table.add_column("Name", style="cyan")
    table.add_column("Slug")
    table.add_column("Agents", justify="center")

    for net in cfg.networks:
        agent_count = sum(
            1 for a in cfg.agents
            if a.network == net.slug or a.network == net.id
        )
        table.add_row(
            net.name or net.slug,
            net.slug,
            str(agent_count) if agent_count else "[dim]-[/dim]",
        )

    console.print()
    console.print(table)


@workspace_app.command("members")
def workspace_members(
    workspace_id: str = typer.Argument(
        ..., help="Workspace ID or slug",
    ),
    token: Optional[str] = typer.Option(
        None, "--token", "-t", help="Workspace token for auth",
    ),
):
    """👥 List members (agents) in a workspace."""
    import asyncio
    from rich.progress import Progress, SpinnerColumn, TextColumn

    from openagents.client.workspace_client import WorkspaceClient
    from openagents.client.daemon_config import load_config

    # Try to find token from config if not provided
    if not token:
        cfg = load_config()
        for net in cfg.networks:
            if net.slug == workspace_id or net.id == workspace_id:
                token = net.token
                break

    endpoint = "https://workspace-endpoint.openagents.org"
    client = WorkspaceClient(endpoint=endpoint)

    async def _fetch():
        import aiohttp
        async with aiohttp.ClientSession() as session:
            headers = {"Content-Type": "application/json"}
            if token:
                headers["X-Workspace-Token"] = token
            async with session.get(
                f"{endpoint}/v1/discover",
                params={"network": workspace_id},
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                return await resp.json()

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Fetching members...", total=None)
        try:
            data = asyncio.run(_fetch())
            progress.update(task, description="[green]✓ Done[/green]")
        except Exception as e:
            progress.update(task, description="[red]✗ Failed[/red]")
            console.print(Panel(
                f"[red]Failed to fetch members:[/red] {e}",
                title="[red]Error[/red]",
                border_style="red",
            ))
            raise typer.Exit(1)

    if data.get("code") and data["code"] != 200:
        console.print(f"  [red]{data.get('message', 'Error')}[/red]")
        raise typer.Exit(1)

    agents = data.get("data", {}).get("agents", [])
    if not agents:
        console.print("  [dim]No agents in this workspace.[/dim]")
        return

    table = Table(
        title=f"Members — {workspace_id}",
        box=box.ROUNDED,
        title_style="bold",
        show_header=True,
        header_style="bold",
    )
    table.add_column("Agent", style="cyan")
    table.add_column("Role")
    table.add_column("Type", style="dim")
    table.add_column("Status")

    for agent in agents:
        name = agent.get("address", "").replace("openagents:", "")
        status = agent.get("status", "unknown")
        status_style = "[green]● online[/green]" if status == "online" else f"[dim]○ {status}[/dim]"
        table.add_row(
            name,
            agent.get("role", ""),
            agent.get("agent_type", "") or "",
            status_style,
        )

    console.print()
    console.print(table)


def _resolve_or_create_network(
    join_id: Optional[str],
    token: Optional[str],
    endpoint: str,
    agent_name: str,
    agent_type: str,
    workspace_name: Optional[str] = None,
) -> Optional["NetworkEntry"]:
    """Join or create a network, returning a NetworkEntry."""
    import asyncio
    from openagents.client.workspace_client import WorkspaceClient
    from openagents.client.daemon_config import NetworkEntry

    client = WorkspaceClient(endpoint=endpoint)

    if join_id and token:
        async def _join():
            result = await client.join_network(
                agent_name=agent_name,
                network=join_id,
                token=token,
                agent_type=agent_type,
                server_host=socket.gethostname(),
                working_dir=os.getcwd(),
            )
            ws_id = result.get("network_id", join_id)
            return NetworkEntry(
                id=ws_id,
                slug=join_id,
                name=join_id,
                token=token,
                endpoint=endpoint,
            )

        try:
            return asyncio.run(_join())
        except Exception as e:
            console.print(f"[red]Failed to join: {e}[/red]")
            return None
    else:
        async def _create():
            ws = await client.create_workspace(
                agent_name, workspace_name, agent_type=agent_type,
            )
            console.print(f"[green]Network created:[/green] {ws.name}")
            console.print(f"[bold]URL:[/bold] [link={ws.url}]{ws.url}[/link]")
            return NetworkEntry(
                id=ws.workspace_id,
                slug=ws.slug if hasattr(ws, "slug") else ws.workspace_id,
                name=ws.name,
                token=ws.token,
                endpoint=endpoint,
            )

        try:
            return asyncio.run(_create())
        except Exception as e:
            console.print(f"[red]Failed to create network: {e}[/red]")
            return None


