/**
 * Pure data helpers for the agent list, shared by the TUI (tui.js) and tests.
 *
 * Kept free of any UI/blessed dependency so the list-rendering logic — in
 * particular the "(local)" labelling and Connect gating — can be unit-tested.
 */

'use strict';

/**
 * Build one display row per configured agent from a connector.
 *
 * `workspace` holds the resolved workspace URL (or '' when the agent is not
 * connected). `workspaceLabel` is what the WORKSPACE column shows: the URL when
 * connected, otherwise "(local)" — matching `agn list` so local-only agents are
 * always visible rather than rendered as a blank cell.
 */
function loadAgentRows(connector) {
  const config = connector.config.load();
  const agents = config.agents || [];
  const agentStatuses = connector.getDaemonStatus() || {};
  const pid = connector.getDaemonPid();
  const networks = config.networks || [];
  return agents.map(agent => {
    const info = agentStatuses[agent.name] || {};
    const state = pid ? (info.state || 'stopped') : 'stopped';
    let workspace = '';
    if (agent.network) {
      const net = networks.find(n => n.slug === agent.network || n.id === agent.network);
      if (net) {
        const slug = net.slug || net.id;
        const isLocal = (net.endpoint || '').includes('localhost') || (net.endpoint || '').includes('127.0.0.1');
        if (isLocal) workspace = `${net.endpoint}/${slug}`;
        else workspace = `workspace.openagents.org/${slug}`;
      } else {
        workspace = agent.network;
      }
    }
    let notReadyMsg = '';
    let health = null;
    try {
      health = connector.healthCheck(agent.type || 'openclaw');
      if (health && !health.ready) notReadyMsg = health.message || 'Not configured';
    } catch {}

    return {
      name: agent.name,
      type: agent.type || 'openclaw',
      state,
      workspace,
      // "(local)" when there's no workspace connection; URL otherwise. `workspace`
      // stays empty for local-only agents so Connect gating still treats them as
      // connectable (see connectAvailable).
      workspaceLabel: workspace || '(local)',
      path: agent.path || '',
      network: agent.network || '',
      lastError: info.last_error || '',
      notReadyMsg,
      health,
      configured: true,
    };
  });
}

/**
 * An agent can be connected to a workspace when it's configured and not already
 * bound to one. Mirrors the footer/menu gating so it can be unit-tested.
 */
function connectAvailable(row) {
  return !!(row && row.configured && !row.workspace);
}

module.exports = { loadAgentRows, connectAvailable };
