import { useState, useEffect } from 'react';
import { Search, Download, Filter, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle } from 'lucide-react';
import { auditAPI, agentsAPI } from '../api/client';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const VIOLATION_TYPES = ['pii', 'injection', 'output'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

function SeverityBadge({ severity }) {
  if (!severity) return <span className="badge-muted">none</span>;
  const map = { low: 'badge-info', medium: 'badge-warning', high: 'badge-danger', critical: 'badge-danger' };
  return <span className={map[severity] || 'badge-muted'}>{severity}</span>;
}

function ViolationBadge({ type }) {
  if (!type) return <span className="badge-success">✓ clean</span>;
  const map = { pii: 'badge-danger', injection: 'badge-warning', output: 'badge-brand' };
  return <span className={map[type] || 'badge-muted'}>{type}</span>;
}

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [agents, setAgents] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [filters, setFilters] = useState({
    search: '', agent_id: '', violation_type: '', severity: '', start_date: '', end_date: ''
  });
  const limit = 20;

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = { page, limit, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
      const res = await auditAPI.list(params);
      setLogs(res.data.logs);
      setTotal(res.data.pagination.total);
    } catch {
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [page, filters]);
  useEffect(() => { agentsAPI.list().then((r) => setAgents(r.data.agents)).catch(() => {}); }, []);

  const handleExport = async () => {
    try {
      const res = await auditAPI.exportCSV(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agentguard-audit-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      a.click();
      toast.success('Export downloaded');
    } catch {
      toast.error('Export failed');
    }
  };

  const pages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="section-header">
        <div>
          <h2 className="section-title">Audit Logs</h2>
          <p className="text-sm text-gray-500">{total.toLocaleString()} total records</p>
        </div>
        <button onClick={handleExport} className="btn-secondary">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="glass-card p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="relative lg:col-span-2">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Search logs..." value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="input-field pl-8" />
          </div>
          <select value={filters.agent_id} onChange={(e) => setFilters({ ...filters, agent_id: e.target.value })} className="select-field">
            <option value="">All Agents</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={filters.violation_type} onChange={(e) => setFilters({ ...filters, violation_type: e.target.value })} className="select-field">
            <option value="">All Violations</option>
            {VIOLATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filters.severity} onChange={(e) => setFilters({ ...filters, severity: e.target.value })} className="select-field">
            <option value="">All Severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="date" value={filters.start_date} onChange={(e) => setFilters({ ...filters, start_date: e.target.value })} className="input-field" />
        </div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500 text-sm">Loading audit logs...</div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-gray-500 text-sm">No audit logs found</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Agent</th>
                <th>Violation</th>
                <th>Severity</th>
                <th>Latency</th>
                <th>Hallucination</th>
                <th>Input Hash</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <>
                  <tr key={log.id} className="cursor-pointer" onClick={() => setExpanded(expanded === log.id ? null : log.id)}>
                    <td className="text-xs font-mono">{format(new Date(log.timestamp), 'MM/dd HH:mm:ss')}</td>
                    <td className="text-xs text-gray-300">{log.agent?.name || log.agent_id?.slice(0, 8) || '—'}</td>
                    <td><ViolationBadge type={log.violation_type} /></td>
                    <td><SeverityBadge severity={log.severity} /></td>
                    <td className="text-xs font-mono text-gray-400">{log.latency_ms}ms</td>
                    <td>
                      {log.hallucination_score != null ? (
                        <div className="flex items-center gap-1.5">
                          <div className="h-1 w-16 bg-surface-4 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${log.hallucination_score > 0.5 ? 'bg-danger' : log.hallucination_score > 0.2 ? 'bg-warning' : 'bg-success'}`}
                              style={{ width: `${log.hallucination_score * 100}%` }} />
                          </div>
                          <span className="text-xs text-gray-400">{(log.hallucination_score * 100).toFixed(0)}%</span>
                        </div>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="font-mono text-xs text-gray-500">{log.input_hash?.slice(0, 12)}…</td>
                  </tr>
                  {expanded === log.id && (
                    <tr key={`${log.id}-exp`}>
                      <td colSpan={7} className="!py-0">
                        <div className="px-4 py-4 bg-surface-0/50 border-t border-white/5 space-y-3">
                          {log.chain_of_thought && (
                            <div>
                              <p className="text-xs font-medium text-gray-400 mb-1">Decision Trace</p>
                              <p className="text-xs text-gray-300 bg-surface-2 p-3 rounded-lg">{log.chain_of_thought}</p>
                            </div>
                          )}
                          <div className="grid grid-cols-3 gap-4 text-xs">
                            <div><p className="text-gray-500 mb-0.5">Log ID</p><p className="font-mono text-gray-400">{log.id}</p></div>
                            <div><p className="text-gray-500 mb-0.5">Tools Called</p>
                              <p className="text-gray-300">{Array.isArray(log.tools_called) && log.tools_called.length > 0 ? log.tools_called.join(', ') : 'None'}</p>
                            </div>
                            <div><p className="text-gray-500 mb-0.5">Output Hash</p><p className="font-mono text-gray-400">{log.output_hash?.slice(0, 16) || '—'}…</p></div>
                          </div>
                          {Array.isArray(log.policy_decisions) && log.policy_decisions.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-gray-400 mb-1">Policy Decisions</p>
                              <div className="space-y-1">
                                {log.policy_decisions.map((d, i) => (
                                  <div key={i} className="flex items-center gap-2 text-xs">
                                    {d.passed ? <CheckCircle size={11} className="text-success" /> : <AlertTriangle size={11} className="text-danger" />}
                                    <span className="text-gray-400 font-medium">{d.check}:</span>
                                    <span className="text-gray-300">{d.reason}</span>
                                    <span className="text-gray-600">({(d.confidence * 100).toFixed(0)}%)</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-gray-400">Page {page} of {pages}</span>
            <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} className="btn-ghost">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
