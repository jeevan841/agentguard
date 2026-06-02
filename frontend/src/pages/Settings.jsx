import { useState, useEffect } from 'react';
import { Plus, Trash2, Bell, Webhook, Shield, Play, CheckCircle, XCircle, RefreshCw, Lock, Smartphone } from 'lucide-react';
import { dashboardAPI, guardrailAPI, authAPI } from '../api/client';
import { useAuthStore } from '../store';
import TotpSetupModal from '../components/TotpSetupModal';
import toast from 'react-hot-toast';

function Section({ title, icon: Icon, children }) {
  return (
    <div className="glass-card p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 border-b border-white/5 pb-3">
        <Icon size={14} className="text-brand-400" /> {title}
      </h3>
      {children}
    </div>
  );
}

export default function Settings() {
  const [alerts, setAlerts] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);

  const [newAlert, setNewAlert] = useState({ name: '', metric: 'guardrail_hit_rate', threshold: 0.2, operator: 'gt', webhook_url: '' });
  const [newWebhook, setNewWebhook] = useState({ name: '', url: '', events: ['guardrail_violation'] });
  const [newPolicy, setNewPolicy] = useState({ name: '', description: '', rules: { check_pii: true, check_injection: true, check_output: true, blocklist: [], restricted_topics: [] } });
  const [policyBlocklist, setPolicyBlocklist] = useState('');
  const [policyTopics, setPolicyTopics] = useState('');

  // Playground state
  const [testInput, setTestInput] = useState('');
  const [testPolicyId, setTestPolicyId] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Security / 2FA state
  const { user, updateUser } = useAuthStore();
  const [mfaLevel, setMfaLevel] = useState(user?.mfa_level || 1);
  const [totpEnabled, setTotpEnabled] = useState(user?.totp_enabled || false);
  const [showTotpModal, setShowTotpModal] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disablingTotp, setDisablingTotp] = useState(false);

  useEffect(() => {
    Promise.all([
      dashboardAPI.listAlerts().then((r) => setAlerts(r.data.alerts)),
      dashboardAPI.listWebhooks().then((r) => setWebhooks(r.data.webhooks)),
      guardrailAPI.listPolicies().then((r) => setPolicies(r.data.policies)),
      authAPI.me().then((r) => {
        updateUser(r.data.user);
        setMfaLevel(r.data.user.mfa_level || 1);
        setTotpEnabled(r.data.user.totp_enabled || false);
      })
    ]).catch(() => toast.error('Failed to load settings')).finally(() => setLoading(false));
  }, [updateUser]);

  const createAlert = async () => {
    if (!newAlert.name) return toast.error('Alert name required');
    try {
      const res = await dashboardAPI.createAlert(newAlert);
      setAlerts((prev) => [res.data.alert, ...prev]);
      setNewAlert({ name: '', metric: 'guardrail_hit_rate', threshold: 0.2, operator: 'gt', webhook_url: '' });
      toast.success('Alert created');
    } catch { toast.error('Failed to create alert'); }
  };

  const deleteAlert = async (id) => {
    try {
      await dashboardAPI.deleteAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      toast.success('Alert deleted');
    } catch { toast.error('Failed to delete alert'); }
  };

  const toggleAlert = async (alert) => {
    try {
      const res = await dashboardAPI.updateAlert(alert.id, { is_active: !alert.is_active });
      setAlerts((prev) => prev.map((a) => a.id === alert.id ? res.data.alert : a));
    } catch { toast.error('Failed to update alert'); }
  };

  const createWebhook = async () => {
    if (!newWebhook.name || !newWebhook.url) return toast.error('Name and URL required');
    try {
      const res = await dashboardAPI.createWebhook(newWebhook);
      setWebhooks((prev) => [res.data.webhook, ...prev]);
      setNewWebhook({ name: '', url: '', events: ['guardrail_violation'] });
      toast.success('Webhook created');
    } catch { toast.error('Failed to create webhook'); }
  };

  const createPolicy = async () => {
    if (!newPolicy.name) return toast.error('Policy name required');
    try {
      const rules = {
        ...newPolicy.rules,
        blocklist: policyBlocklist ? policyBlocklist.split(',').map((s) => s.trim()).filter(Boolean) : [],
        restricted_topics: policyTopics ? policyTopics.split(',').map((s) => s.trim()).filter(Boolean) : [],
      };
      const res = await guardrailAPI.createPolicy({ ...newPolicy, rules });
      setPolicies((prev) => [res.data.policy, ...prev]);
      setNewPolicy({ name: '', description: '', rules: { check_pii: true, check_injection: true, check_output: true, blocklist: [], restricted_topics: [] } });
      setPolicyBlocklist('');
      setPolicyTopics('');
      toast.success('Policy created');
    } catch { toast.error('Failed to create policy'); }
  };

  const runPlaygroundTest = async () => {
    if (!testInput.trim()) return toast.error('Please enter an input to test');
    setTestRunning(true);
    setTestResult(null);
    try {
      const payload = { input: testInput, log: false };
      if (testPolicyId) payload.policy_id = testPolicyId;
      const res = await guardrailAPI.test(payload);
      setTestResult(res.data);
      toast.success('Test complete');
    } catch (err) {
      toast.error('Test failed to run');
    } finally {
      setTestRunning(false);
    }
  };

  const handleSetMfaLevel = async (newLevel) => {
    try {
      await authAPI.setMfaLevel(newLevel);
      setMfaLevel(newLevel);
      if (newLevel === 1) setTotpEnabled(false);
      toast.success(newLevel === 2 ? 'Email OTP login enabled' : 'Password-only login restored');
    } catch {
      toast.error('Failed to update security level');
    }
  };

  const handleDisableTotp = async () => {
    if (!disablePassword) return toast.error('Enter your password to confirm');
    setDisablingTotp(true);
    try {
      await authAPI.disableTotp(disablePassword);
      setTotpEnabled(false);
      setMfaLevel(2);
      setDisablePassword('');
      toast.success('Authenticator app disabled');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to disable TOTP');
    } finally {
      setDisablingTotp(false);
    }
  };

  if (loading) return <div className="text-center text-gray-500 mt-20">Loading settings...</div>;

  return (
    <>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h2 className="section-title">Settings</h2>
          <p className="text-sm text-gray-500">Configure guardrail policies, alert thresholds, and webhooks</p>
        </div>

      {/* Alert Thresholds */}
      <Section title="Alert Thresholds" icon={Bell}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input value={newAlert.name} onChange={(e) => setNewAlert({ ...newAlert, name: e.target.value })} placeholder="Alert name" className="input-field" />
          <select value={newAlert.metric} onChange={(e) => setNewAlert({ ...newAlert, metric: e.target.value })} className="select-field">
            <option value="guardrail_hit_rate">Guardrail Hit Rate</option>
            <option value="avg_latency_ms">Avg Latency (ms)</option>
            <option value="requests_per_min">Requests/min</option>
          </select>
          <div className="flex gap-2">
            <select value={newAlert.operator} onChange={(e) => setNewAlert({ ...newAlert, operator: e.target.value })} className="select-field w-16">
              <option value="gt">&gt;</option>
              <option value="lt">&lt;</option>
            </select>
            <input type="number" step="0.01" value={newAlert.threshold}
              onChange={(e) => setNewAlert({ ...newAlert, threshold: parseFloat(e.target.value) })}
              className="input-field flex-1" placeholder="0.2" />
          </div>
          <button onClick={createAlert} className="btn-primary justify-center"><Plus size={14} /> Add</button>
        </div>

        {alerts.length > 0 && (
          <div className="space-y-2 mt-2">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex items-center justify-between py-2.5 px-3 bg-surface-2 rounded-lg">
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleAlert(alert)}
                    className={`w-8 h-4 rounded-full transition-colors flex items-center px-0.5 ${alert.is_active ? 'bg-brand-500' : 'bg-surface-4'}`}>
                    <span className={`w-3 h-3 rounded-full bg-white transition-transform ${alert.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-sm text-gray-300">{alert.name}</span>
                  <span className="badge-muted text-xs">{alert.metric} {alert.operator === 'gt' ? '>' : '<'} {alert.threshold}</span>
                </div>
                <button onClick={() => deleteAlert(alert.id)} className="btn-ghost text-danger/70 hover:text-danger">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Guardrail Policies */}
      <Section title="Guardrail Policies" icon={Shield}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input value={newPolicy.name} onChange={(e) => setNewPolicy({ ...newPolicy, name: e.target.value })} placeholder="Policy name" className="input-field" />
          <input value={newPolicy.description} onChange={(e) => setNewPolicy({ ...newPolicy, description: e.target.value })} placeholder="Description (optional)" className="input-field" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[['check_pii', 'PII Detection'], ['check_injection', 'Injection Detection'], ['check_output', 'Output Validation']].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={newPolicy.rules[key]} onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, [key]: e.target.checked } })}
                className="w-4 h-4 rounded accent-brand-500" />
              <span className="text-sm text-gray-300">{label}</span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Blocklist (comma-separated)</label>
            <input value={policyBlocklist} onChange={(e) => setPolicyBlocklist(e.target.value)} placeholder="bomb making, how to hack..." className="input-field" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Restricted Topics (comma-separated)</label>
            <input value={policyTopics} onChange={(e) => setPolicyTopics(e.target.value)} placeholder="politics, medical_advice..." className="input-field" />
          </div>
        </div>
        <button onClick={createPolicy} className="btn-primary"><Plus size={14} /> Create Policy</button>

        {policies.length > 0 && (
          <div className="space-y-2 mt-1">
            {policies.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2.5 px-3 bg-surface-2 rounded-lg">
                <div>
                  <span className="text-sm font-medium text-gray-200">{p.name}</span>
                  {p.description && <span className="text-xs text-gray-500 ml-2">{p.description}</span>}
                </div>
                <span className={p.is_active ? 'badge-success' : 'badge-muted'}>{p.is_active ? 'Active' : 'Inactive'}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Webhooks */}
      <Section title="Webhook Integrations" icon={Webhook}>
        <div className="grid grid-cols-2 gap-3">
          <input value={newWebhook.name} onChange={(e) => setNewWebhook({ ...newWebhook, name: e.target.value })} placeholder="Webhook name (e.g. Slack)" className="input-field" />
          <input value={newWebhook.url} onChange={(e) => setNewWebhook({ ...newWebhook, url: e.target.value })} placeholder="https://hooks.slack.com/..." className="input-field" />
        </div>
        <button onClick={createWebhook} className="btn-primary"><Plus size={14} /> Add Webhook</button>
        {webhooks.length > 0 && (
          <div className="space-y-2">
            {webhooks.map((w) => (
              <div key={w.id} className="flex items-center justify-between py-2.5 px-3 bg-surface-2 rounded-lg">
                <div>
                  <span className="text-sm font-medium text-gray-200">{w.name}</span>
                  <span className="text-xs text-gray-500 ml-2 font-mono">{w.url.slice(0, 40)}…</span>
                </div>
                <span className={w.is_active ? 'badge-success' : 'badge-muted'}>{w.is_active ? 'Active' : 'Inactive'}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Guardrail Playground */}
      <Section title="Guardrail Playground" icon={Play}>
        <div className="grid grid-cols-1 gap-4">
          <div className="flex gap-3">
            <select 
              value={testPolicyId} 
              onChange={(e) => setTestPolicyId(e.target.value)} 
              className="select-field flex-1"
            >
              <option value="">Global Default Policy (No specific policy)</option>
              {policies.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <textarea
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            placeholder="Enter a prompt to test against the guardrails..."
            className="input-field min-h-[100px] resize-y font-mono text-sm"
          />
          <div className="flex justify-end">
            <button 
              onClick={runPlaygroundTest} 
              disabled={testRunning || !testInput} 
              className="btn-primary"
            >
              {testRunning ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />} 
              Run Test
            </button>
          </div>

          {testResult && (
            <div className={`mt-2 p-4 rounded-lg border ${testResult.passed ? 'border-success/30 bg-success/5' : 'border-danger/30 bg-danger/5'}`}>
              <div className="flex items-center gap-2 mb-3">
                {testResult.passed ? <CheckCircle size={18} className="text-success" /> : <XCircle size={18} className="text-danger" />}
                <h4 className={`font-bold ${testResult.passed ? 'text-success' : 'text-danger'}`}>
                  {testResult.passed ? 'All Checks Passed' : 'Violation Detected'}
                </h4>
                <span className="ml-auto text-xs text-gray-400">{testResult.latency_ms}ms</span>
              </div>
              
              <div className="space-y-2 mt-3">
                {testResult.checks.map((check, idx) => (
                  <div key={idx} className="flex flex-col bg-surface-2/50 p-2.5 rounded border border-white/5">
                    <div className="flex items-center gap-2">
                      {check.passed ? <CheckCircle size={14} className="text-success" /> : <XCircle size={14} className="text-danger" />}
                      <span className="text-sm font-medium text-gray-200 capitalize">{check.check.replace('_', ' ')}</span>
                      <span className="ml-auto text-xs text-gray-500">{(check.confidence * 100).toFixed(0)}% confidence</span>
                    </div>
                    {check.reason && <p className="text-xs text-gray-400 mt-1 ml-6">{check.reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Security */}
      <Section title="Account Security" icon={Lock}>
        <div className="space-y-5">

          {/* Email Verification status */}
          {user && !user.email_verified && (
            <div className="flex items-center gap-3 p-3 bg-warning/10 border border-warning/20 rounded-lg">
              <span className="text-warning text-sm">⚠️</span>
              <p className="text-sm text-warning flex-1">Your email is not verified. Some features may be limited.</p>
            </div>
          )}

          {/* MFA Level Control */}
          <div>
            <p className="text-sm font-medium text-gray-200 mb-1">Two-Factor Authentication (Step 2)</p>
            <p className="text-xs text-gray-400 mb-3">When enabled, logging in requires a 6-digit code sent to your email after your password.</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleSetMfaLevel(mfaLevel === 1 ? 2 : 1)}
                className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${
                  mfaLevel >= 2 ? 'bg-brand-500' : 'bg-surface-4'
                }`}
              >
                <span className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  mfaLevel >= 2 ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
              <span className={`text-sm font-medium ${ mfaLevel >= 2 ? 'text-brand-300' : 'text-gray-500' }`}>
                {mfaLevel >= 2 ? 'Enabled — Password + Email OTP' : 'Disabled — Password only'}
              </span>
            </div>
          </div>

          {/* TOTP Section — only visible when MFA level 2 is on */}
          {mfaLevel >= 2 && (
            <div className="p-4 bg-surface-2 rounded-xl border border-white/5">
              <div className="flex items-center gap-2 mb-1">
                <Smartphone size={14} className="text-brand-400" />
                <p className="text-sm font-medium text-gray-200">Authenticator App (Step 3 — Optional)</p>
              </div>
              <p className="text-xs text-gray-400 mb-3">
                Adds a third login step using Google Authenticator, Authy, or any TOTP-compatible app.
              </p>

              {!totpEnabled ? (
                <button onClick={() => setShowTotpModal(true)} className="btn-secondary">
                  <Smartphone size={14} /> Set Up Authenticator
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle size={14} />
                    <span className="text-sm font-medium">Authenticator app active</span>
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      type="password" value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                      placeholder="Confirm your password to disable"
                      className="input-field flex-1 text-sm"
                    />
                    <button onClick={handleDisableTotp} disabled={disablingTotp} className="btn-ghost text-danger hover:text-danger text-sm">
                      {disablingTotp ? <RefreshCw size={14} className="animate-spin" /> : 'Disable'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Section>
    </div>

    {showTotpModal && (
      <TotpSetupModal
        onClose={() => setShowTotpModal(false)}
        onSuccess={() => { setTotpEnabled(true); setMfaLevel(3); setShowTotpModal(false); }}
      />
    )}
  </>
  );
}
