import { useState, useEffect, useCallback } from 'react';
import {
  Bot, Plus, Edit2, Trash2, Key, Copy, Check,
  Shield, ChevronDown, ChevronUp, Search, RefreshCw,
  AlertTriangle, X, Loader2, Users, Database, Wrench,
} from 'lucide-react';
import { agentsAPI } from '../api/client';
import { useAgentsStore } from '../store';
import toast from 'react-hot-toast';

// ─── Constants ────────────────────────────────────────────────────────────────
const TOOL_OPTIONS = [
  'search', 'code_exec', 'file_read', 'file_write',
  'web_browse', 'email_send', 'db_query', 'api_call',
];
const SCOPE_OPTIONS = ['public', 'internal', 'confidential', 'restricted'];

const STATUS_COLORS = {
  active:   'bg-success/15 text-success border border-success/30',
  inactive: 'bg-gray-500/15 text-gray-400 border border-gray-500/30',
  flagged:  'bg-danger/15 text-danger border border-danger/30',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function Badge({ label, color = 'brand', onRemove }) {
  const map = {
    brand:   'bg-brand-500/15 text-brand-300 border border-brand-500/30',
    cyan:    'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30',
    orange:  'bg-orange-500/15 text-orange-300 border border-orange-500/30',
    gray:    'bg-gray-500/15 text-gray-400 border border-gray-500/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${map[color]}`}>
      {label}
      {onRemove && (
        <button onClick={onRemove} className="hover:opacity-60 transition-opacity">
          <X size={10} />
        </button>
      )}
    </span>
  );
}

function MultiSelect({ label, options, selected, onChange, colorMap = {} }) {
  const toggle = (opt) =>
    onChange(selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt]);
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                active
                  ? 'bg-brand-500/25 text-brand-300 border-brand-500/50'
                  : 'bg-surface-3 text-gray-400 border-white/5 hover:border-white/20'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {selected.map((s) => (
            <Badge key={s} label={s} color={colorMap[s] || 'brand'} onRemove={() => toggle(s)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Agent Modal ──────────────────────────────────────────────────────────────
function AgentModal({ agent, onClose, onSave }) {
  const isEdit = Boolean(agent?.id);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: agent?.name || '',
    max_token_budget: agent?.max_token_budget || 4096,
    allowed_tools: agent?.allowed_tools || [],
    allowed_data_scopes: agent?.allowed_data_scopes || ['public'],
  });

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Agent name is required');
    setSaving(true);
    try {
      if (isEdit) {
        const res = await agentsAPI.update(agent.id, form);
        onSave(res.data.agent || res.data, true);
        toast.success('Agent updated');
      } else {
        const res = await agentsAPI.create(form);
        onSave(res.data.agent || res.data, false);
        toast.success('Agent created');
      }
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Bot size={18} className="text-brand-400" />
            {isEdit ? 'Edit Agent' : 'Register New Agent'}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Agent Name *</label>
            <input
              className="input w-full"
              placeholder="e.g. customer-support-agent-v2"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
            />
          </div>

          {/* Token Budget */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              Max Token Budget
              <span className="ml-2 text-brand-400 font-mono">{form.max_token_budget.toLocaleString()}</span>
            </label>
            <input
              type="range" min={256} max={32768} step={256}
              value={form.max_token_budget}
              onChange={(e) => set('max_token_budget', Number(e.target.value))}
              className="w-full accent-brand-500"
            />
            <div className="flex justify-between text-xs text-gray-600 mt-1">
              <span>256</span><span>32,768</span>
            </div>
          </div>

          {/* Allowed Tools */}
          <MultiSelect
            label="Allowed Tools"
            options={TOOL_OPTIONS}
            selected={form.allowed_tools}
            onChange={(v) => set('allowed_tools', v)}
          />

          {/* Data Scopes */}
          <MultiSelect
            label="Allowed Data Scopes"
            options={SCOPE_OPTIONS}
            selected={form.allowed_data_scopes}
            onChange={(v) => set('allowed_data_scopes', v)}
            colorMap={{ confidential: 'orange', restricted: 'cyan' }}
          />

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? <Loader2 size={14} className="animate-spin" /> : (isEdit ? 'Save Changes' : 'Register Agent')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Token Modal ──────────────────────────────────────────────────────────────
function TokenModal({ agent, onClose }) {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    agentsAPI.issueToken(agent.id)
      .then((res) => setToken(res.data.token || res.data.capability_token))
      .catch(() => toast.error('Failed to issue token'))
      .finally(() => setLoading(false));
  }, [agent.id]);

  const copy = () => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Key size={18} className="text-warning" />
            Capability Token
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-gray-400">
          Short-lived token for <span className="text-white font-medium">{agent.name}</span>. Valid for 1 hour.
        </p>
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <Loader2 size={24} className="animate-spin text-brand-400" />
          </div>
        ) : token ? (
          <div className="relative">
            <div className="bg-surface-3 border border-white/10 rounded-lg p-3 pr-10 font-mono text-xs text-gray-300 break-all">
              {token}
            </div>
            <button
              onClick={copy}
              className="absolute top-2 right-2 text-gray-500 hover:text-gray-200 transition-colors"
            >
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            </button>
          </div>
        ) : (
          <p className="text-sm text-danger">Token issuance failed.</p>
        )}
        <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 text-xs text-warning">
          ⚠ Store this token securely — it won't be shown again.
        </div>
        <button onClick={onClose} className="btn-secondary w-full">Close</button>
      </div>
    </div>
  );
}

// ─── Agent Row Expanded Detail ────────────────────────────────────────────────
function AgentDetail({ agent }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 px-4 pb-4 pt-2 bg-surface-2/50 border-t border-white/5">
      <div>
        <p className="text-xs text-gray-500 mb-1.5 flex items-center gap-1.5">
          <Wrench size={11} /> Allowed Tools
        </p>
        <div className="flex flex-wrap gap-1">
          {(agent.allowed_tools || []).length > 0
            ? agent.allowed_tools.map((t) => <Badge key={t} label={t} color="brand" />)
            : <span className="text-xs text-gray-600">None</span>}
        </div>
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-1.5 flex items-center gap-1.5">
          <Database size={11} /> Data Scopes
        </p>
        <div className="flex flex-wrap gap-1">
          {(agent.allowed_data_scopes || []).length > 0
            ? agent.allowed_data_scopes.map((s) => (
                <Badge key={s} label={s} color={s === 'confidential' ? 'orange' : s === 'restricted' ? 'cyan' : 'gray'} />
              ))
            : <span className="text-xs text-gray-600">None</span>}
        </div>
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-1.5 flex items-center gap-1.5">
          <Shield size={11} /> RBAC Info
        </p>
        <div className="space-y-1 text-xs text-gray-400">
          <p>Token Budget: <span className="text-white font-mono">{agent.max_token_budget?.toLocaleString()}</span></p>
          <p>ID: <span className="text-gray-500 font-mono text-[10px]">{agent.id}</span></p>
          <p>Created: <span className="text-white">{new Date(agent.created_at).toLocaleDateString()}</span></p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Agents() {
  const { agents, total, loading, setAgents, setLoading, addAgent, updateAgent, removeAgent } = useAgentsStore();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState(null);
  const [modalAgent, setModalAgent] = useState(undefined); // undefined=closed, null=new, obj=edit
  const [tokenAgent, setTokenAgent] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const PAGE_SIZE = 10;

  const fetchAgents = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await agentsAPI.list({ page, limit: PAGE_SIZE, search: search || undefined });
      const data = res.data;
      setAgents(data.agents || data, data.total || (data.agents || data).length);
    } catch {
      toast.error('Failed to load agents');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, search, setAgents, setLoading]);

  useEffect(() => { fetchAgents(); }, [page]);

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); fetchAgents(); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const handleSave = (savedAgent, isEdit) => {
    if (isEdit) updateAgent(savedAgent.id, savedAgent);
    else addAgent(savedAgent);
  };

  const handleDelete = async (agent) => {
    if (!window.confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;
    setDeleting(agent.id);
    try {
      await agentsAPI.delete(agent.id);
      removeAgent(agent.id);
      toast.success('Agent deleted');
    } catch {
      toast.error('Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="section-header">
        <div>
          <h2 className="section-title">AI Agents</h2>
          <p className="text-sm text-gray-500">
            {total > 0 ? `${total} registered agent${total !== 1 ? 's' : ''}` : 'Manage and govern your AI agents'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => fetchAgents(true)} disabled={refreshing} className="btn-secondary">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button onClick={() => setModalAgent(null)} className="btn-primary">
            <Plus size={14} /> Register Agent
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          className="input w-full pl-9"
          placeholder="Search agents by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {/* Column headers */}
        <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2.5 border-b border-white/5 text-xs font-medium text-gray-500 uppercase tracking-wider">
          <span className="col-span-4">Agent</span>
          <span className="col-span-2">Status</span>
          <span className="col-span-2 text-center">Tools</span>
          <span className="col-span-2 text-center">Budget</span>
          <span className="col-span-2 text-right">Actions</span>
        </div>

        {/* Rows */}
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-4 border-b border-white/5 last:border-0 animate-pulse">
              <div className="w-8 h-8 bg-surface-4 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 bg-surface-4 rounded w-40" />
                <div className="h-2.5 bg-surface-4 rounded w-24" />
              </div>
            </div>
          ))
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <Users size={36} className="mb-3 opacity-30" />
            <p className="text-sm font-medium">No agents found</p>
            <p className="text-xs mt-1">Register your first agent to get started</p>
          </div>
        ) : (
          agents.map((agent) => {
            const isExpanded = expandedId === agent.id;
            const status = agent.status || 'active';
            return (
              <div key={agent.id} className="border-b border-white/5 last:border-0 row-hover transition-colors">
                {/* Main row */}
                <div className="grid grid-cols-12 gap-3 px-4 py-3.5 items-center">
                  {/* Name + icon */}
                  <div className="col-span-12 sm:col-span-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-brand-500/15 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
                      <Bot size={15} className="text-brand-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-200 truncate">{agent.name}</p>
                      <p className="text-xs text-gray-600 font-mono truncate">{agent.id?.slice(0, 16)}…</p>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="hidden sm:block col-span-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || STATUS_COLORS.active}`}>
                      {status}
                    </span>
                  </div>

                  {/* Tools count */}
                  <div className="hidden sm:flex col-span-2 justify-center">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-brand-500/10 text-brand-400 border border-brand-500/20">
                      {agent.allowed_tools?.length || 0} tools
                    </span>
                  </div>

                  {/* Token budget */}
                  <div className="hidden sm:flex col-span-2 justify-center">
                    <span className="text-xs font-mono text-gray-300">
                      {(agent.max_token_budget || 4096).toLocaleString()}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="col-span-12 sm:col-span-2 flex items-center justify-end gap-1.5">
                    {/* Expand */}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : agent.id)}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-white/5 transition-all"
                      title="View details"
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {/* Issue Token */}
                    <button
                      onClick={() => setTokenAgent(agent)}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-warning hover:bg-warning/10 transition-all"
                      title="Issue capability token"
                    >
                      <Key size={14} />
                    </button>
                    {/* Edit */}
                    <button
                      onClick={() => setModalAgent(agent)}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition-all"
                      title="Edit agent"
                    >
                      <Edit2 size={14} />
                    </button>
                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(agent)}
                      disabled={deleting === agent.id}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-danger hover:bg-danger/10 transition-all disabled:opacity-40"
                      title="Delete agent"
                    >
                      {deleting === agent.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && <AgentDetail agent={agent} />}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-gray-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="btn-secondary disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="btn-secondary disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Guardrail hint */}
      {agents.length > 0 && (
        <div className="flex items-start gap-3 glass-card p-4 border-warning/20">
          <AlertTriangle size={16} className="text-warning mt-0.5 flex-shrink-0" />
          <div className="text-xs text-gray-400">
            <span className="text-warning font-medium">Capability Tokens</span> are short-lived JWTs scoped to this agent's tools and data scopes.
            Issue one via the <Key size={11} className="inline mx-0.5" /> button and pass it in the{' '}
            <code className="text-brand-300 bg-brand-500/10 px-1 rounded">Authorization</code> header when making guardrail checks on behalf of this agent.
          </div>
        </div>
      )}

      {/* Modals */}
      {modalAgent !== undefined && (
        <AgentModal
          agent={modalAgent}
          onClose={() => setModalAgent(undefined)}
          onSave={handleSave}
        />
      )}
      {tokenAgent && (
        <TokenModal agent={tokenAgent} onClose={() => setTokenAgent(null)} />
      )}
    </div>
  );
}
