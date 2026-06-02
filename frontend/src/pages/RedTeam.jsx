import { useState, useEffect, useRef } from 'react';
import { Play, RefreshCw, ChevronDown, ChevronUp, Target, Shield, AlertTriangle, CheckCircle, XCircle, Download } from 'lucide-react';
import { redTeamAPI, agentsAPI } from '../api/client';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const ATTACK_TYPE_LABELS = {
  prompt_injection: 'Prompt Injection',
  roleplay_jailbreak: 'Roleplay Jailbreak',
  data_exfiltration: 'Data Exfiltration',
  hallucination_traps: 'Hallucination Traps',
};

function SeverityBar({ score, max = 5 }) {
  const pct = (score / max) * 100;
  const color = score >= 4 ? 'bg-danger' : score >= 3 ? 'bg-warning' : score >= 2 ? 'bg-info' : 'bg-success';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 bg-surface-4 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400">{score}/{max}</span>
    </div>
  );
}

function RunResultsModal({ run, onClose }) {
  const results = Array.isArray(run.results) ? run.results : [];
  const failed = results.filter((r) => r.was_fooled);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    try {
      setExporting(true);
      const res = await redTeamAPI.exportPDF(run.id);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `redteam-report-${run.id}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      toast.error('Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card w-full max-w-4xl max-h-[90vh] flex flex-col animate-slide-up">
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Target size={16} className="text-brand-400" /> Red-Team Report
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">{run.agent?.name} · {format(new Date(run.created_at), 'MMM dd, yyyy HH:mm')}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleExport} disabled={exporting} className="btn-secondary">
              {exporting ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
              Export PDF
            </button>
            <button onClick={onClose} className="btn-ghost">✕</button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total Tests', value: run.total_tests, color: 'text-gray-200' },
              { label: 'Passed', value: run.passed_tests, color: 'text-success' },
              { label: 'Failed', value: run.failed_tests, color: 'text-danger' },
              { label: 'Pass Rate', value: run.pass_rate != null ? `${run.pass_rate.toFixed(1)}%` : '—', color: run.pass_rate >= 80 ? 'text-success' : run.pass_rate >= 60 ? 'text-warning' : 'text-danger' },
            ].map(({ label, value, color }) => (
              <div key={label} className="glass-card p-3 text-center">
                <p className={`text-xl font-bold ${color}`}>{value ?? '—'}</p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Summary text */}
          {run.summary && (
            <div className="glass-card p-4">
              <p className="text-xs font-medium text-gray-400 mb-2">Executive Summary</p>
              <p className="text-sm text-gray-300 leading-relaxed">{run.summary}</p>
            </div>
          )}

          {/* Attack Results */}
          <div>
            <p className="text-sm font-medium text-gray-300 mb-2">Attack Results ({results.length})</p>
            <div className="space-y-2">
              {results.map((r, i) => (
                <div key={i} className={`glass-card p-3 border ${r.was_fooled ? 'border-danger/20' : 'border-success/10'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      {r.was_fooled
                        ? <XCircle size={14} className="text-danger flex-shrink-0" />
                        : <CheckCircle size={14} className="text-success flex-shrink-0" />}
                      <span className="text-sm font-medium text-gray-200">{r.attack_name}</span>
                      <span className="badge-muted">{r.attack_type?.replace('_', ' ')}</span>
                      {r.guardrail_caught && <span className="badge-success">guardrail caught</span>}
                    </div>
                    <SeverityBar score={r.fooled_score || 0} />
                  </div>
                  {r.reason && <p className="text-xs text-gray-500 mt-1">{r.reason}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          {run.recommendations?.length > 0 && (
            <div className="glass-card p-4 border border-brand-500/20">
              <p className="text-sm font-medium text-brand-300 mb-2 flex items-center gap-1.5">
                <Shield size={13} /> Recommended Guardrail Updates
              </p>
              <ul className="space-y-1">
                {run.recommendations.map((r, i) => (
                  <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                    <span className="text-brand-400 mt-0.5">•</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RedTeam() {
  const [agents, setAgents] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [selectedTypes, setSelectedTypes] = useState(Object.keys(ATTACK_TYPE_LABELS));
  const [viewRun, setViewRun] = useState(null);
  const pollRef = useRef(null);

  const fetchRuns = async () => {
    try {
      const res = await redTeamAPI.listRuns({ limit: 20 });
      setRuns(res.data.runs);
    } catch { }
  };

  useEffect(() => {
    Promise.all([
      agentsAPI.list().then((r) => { setAgents(r.data.agents); if (r.data.agents[0]) setSelectedAgent(r.data.agents[0].id); }),
      fetchRuns(),
    ]).finally(() => setLoading(false));
    return () => clearInterval(pollRef.current);
  }, []);

  const startRun = async () => {
    if (!selectedAgent) return toast.error('Select an agent first');
    setRunning(true);
    try {
      const res = await redTeamAPI.run(selectedAgent, selectedTypes);
      toast.success('Red-team suite started!');
      setRuns((prev) => [{ id: res.data.run_id, status: 'running', created_at: new Date().toISOString(), agent: agents.find((a) => a.id === selectedAgent) }, ...prev]);

      // Poll until complete
      pollRef.current = setInterval(async () => {
        try {
          const r = await redTeamAPI.getRun(res.data.run_id);
          if (r.data.run.status !== 'running' && r.data.run.status !== 'pending') {
            clearInterval(pollRef.current);
            setRunning(false);
            setRuns((prev) => prev.map((run) => run.id === res.data.run_id ? r.data.run : run));
            toast.success(`Run completed! Pass rate: ${r.data.run.pass_rate?.toFixed(1)}%`);
          }
        } catch { }
      }, 3000);
    } catch (err) {
      setRunning(false);
      toast.error(err.response?.data?.message || 'Failed to start run');
    }
  };

  const toggleType = (type) =>
    setSelectedTypes((prev) => prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]);

  const statusBadge = (status) => {
    const map = { pending: 'badge-muted', running: 'badge-info', completed: 'badge-success', failed: 'badge-danger' };
    return <span className={map[status] || 'badge-muted'}>{status}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="section-header">
        <div>
          <h2 className="section-title">Red-Team Testing</h2>
          <p className="text-sm text-gray-500">Adversarial attack simulation suite</p>
        </div>
      </div>

      {/* Run Configuration */}
      <div className="glass-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Target size={14} className="text-brand-400" /> Configure Test Suite
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Target Agent</label>
            <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} className="select-field">
              <option value="">Select agent...</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">Attack Categories</label>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(ATTACK_TYPE_LABELS).map(([type, label]) => (
                <button key={type} type="button" onClick={() => toggleType(type)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                    selectedTypes.includes(type)
                      ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                      : 'bg-surface-4 text-gray-500 border-white/5 hover:border-white/20'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button onClick={startRun} disabled={running || !selectedAgent} className="btn-primary">
          {running ? <><RefreshCw size={14} className="animate-spin" /> Running...</> : <><Play size={14} /> Run Suite ({selectedTypes.length} attack types)</>}
        </button>
      </div>

      {/* Results */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-gray-200">Test Runs</h3>
        </div>
        {loading ? (
          <div className="p-12 text-center text-gray-500 text-sm">Loading...</div>
        ) : runs.length === 0 ? (
          <div className="p-12 text-center">
            <Shield size={40} className="mx-auto text-gray-700 mb-3" />
            <p className="text-gray-400 font-medium">No test runs yet</p>
            <p className="text-gray-600 text-sm mt-1">Select an agent and run the suite above</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Status</th>
                <th>Pass Rate</th>
                <th>Total</th>
                <th>Failed</th>
                <th>Started</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="font-medium text-gray-200 text-sm">{run.agent?.name || '—'}</td>
                  <td>
                    {statusBadge(run.status)}
                    {run.status === 'running' && <RefreshCw size={10} className="inline ml-1 animate-spin text-info" />}
                  </td>
                  <td>
                    {run.pass_rate != null ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 bg-surface-4 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${run.pass_rate >= 80 ? 'bg-success' : run.pass_rate >= 60 ? 'bg-warning' : 'bg-danger'}`}
                            style={{ width: `${run.pass_rate}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-gray-300">{run.pass_rate.toFixed(1)}%</span>
                      </div>
                    ) : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="text-gray-400 text-sm">{run.total_tests || '—'}</td>
                  <td className="text-danger text-sm font-medium">{run.failed_tests ?? '—'}</td>
                  <td className="text-gray-500 text-xs">{format(new Date(run.created_at), 'MM/dd HH:mm')}</td>
                  <td>
                    {run.status === 'completed' && (
                      <button onClick={() => setViewRun(run)} className="btn-ghost text-xs">View Report</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {viewRun && <RunResultsModal run={viewRun} onClose={() => setViewRun(null)} />}
    </div>
  );
}
