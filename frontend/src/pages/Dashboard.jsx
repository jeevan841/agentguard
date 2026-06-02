import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  Activity, Shield, AlertTriangle, Bot, TrendingUp, Zap,
  Clock, CheckCircle, XCircle, RefreshCw
} from 'lucide-react';
import { dashboardAPI } from '../api/client';
import { useMetricsStore } from '../store';
import toast from 'react-hot-toast';

const COLORS = {
  brand: '#7c3aed',
  cyan: '#06b6d4',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#f43f5e',
  info: '#3b82f6',
};

const PIE_COLORS = [COLORS.danger, COLORS.warning, COLORS.brand, COLORS.cyan];

function MetricCard({ title, value, subtitle, icon: Icon, color = 'brand', trend, loading }) {
  const colorMap = {
    brand: 'text-brand-400 bg-brand-500/10',
    cyan: 'text-accent bg-accent/10',
    success: 'text-success bg-success/10',
    warning: 'text-warning bg-warning/10',
    danger: 'text-danger bg-danger/10',
  };

  return (
    <div className="metric-card hover-lift">
      <div className="flex items-start justify-between">
        <div className={`p-2.5 rounded-lg ${colorMap[color]}`}>
          <Icon size={18} />
        </div>
        {trend !== undefined && (
          <span className={`text-xs font-medium flex items-center gap-0.5 ${
            trend >= 0 ? 'text-success' : 'text-danger'
          }`}>
            <TrendingUp size={11} className={trend < 0 ? 'rotate-180' : ''} />
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div>
        {loading ? (
          <div className="h-7 w-24 bg-surface-4 rounded animate-pulse" />
        ) : (
          <p className="text-2xl font-bold text-white">{value ?? '—'}</p>
        )}
        <p className="text-sm text-gray-400 mt-0.5">{title}</p>
        {subtitle && <p className="text-xs text-gray-600 mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}

function AgentHealthHeatmap({ agents }) {
  if (!agents || agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
        No agents to display
      </div>
    );
  }

  const statusColor = {
    healthy: 'bg-success shadow-glow-green',
    degraded: 'bg-orange-400',
    warning: 'bg-warning',
    critical: 'bg-danger shadow-glow-red animate-pulse',
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {agents.map((agent) => (
        <div key={agent.agent_id} className="glass-card p-3 flex items-center gap-2.5">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor[agent.status] || 'bg-gray-500'}`} />
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-200 truncate">{agent.agent_name}</p>
            <p className="text-xs text-gray-500">
              {(agent.error_rate * 100).toFixed(1)}% violations
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-card px-3 py-2 text-xs">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(p.value < 1 ? 3 : 0) : p.value}
        </p>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const { metrics, setMetrics } = useMetricsStore();
  const [loading, setLoading] = useState(!metrics);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMetrics = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await dashboardAPI.metrics();
      setMetrics(res.data);
    } catch (err) {
      if (!metrics) toast.error('Failed to load metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [metrics, setMetrics]);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(() => fetchMetrics(), 30000);
    return () => clearInterval(interval);
  }, []);

  const m = metrics;
  const violationData = m?.guardrail_stats?.violation_counts
    ? Object.entries(m.guardrail_stats.violation_counts)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => ({ name: k.toUpperCase(), value: v }))
    : [{ name: 'No violations', value: 1 }];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="section-header">
        <div>
          <h2 className="section-title">System Overview</h2>
          <p className="text-sm text-gray-500">Real-time AI governance metrics</p>
        </div>
        <button
          onClick={() => fetchMetrics(true)}
          disabled={refreshing}
          className="btn-secondary"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Audit Logs"
          value={m?.summary?.total_logs?.toLocaleString()}
          icon={Activity}
          color="brand"
          loading={loading}
        />
        <MetricCard
          title="Active Agents"
          value={m?.summary?.active_agents}
          icon={Bot}
          color="cyan"
          loading={loading}
        />
        <MetricCard
          title="Guardrail Hit Rate"
          value={m?.summary?.guardrail_hit_rate != null
            ? `${(m.summary.guardrail_hit_rate * 100).toFixed(1)}%`
            : '—'}
          subtitle="violations / total checks"
          icon={Shield}
          color={
            m?.summary?.guardrail_hit_rate > 0.2 ? 'danger' :
            m?.summary?.guardrail_hit_rate > 0.05 ? 'warning' : 'success'
          }
          loading={loading}
        />
        <MetricCard
          title="Avg Latency"
          value={m?.summary?.avg_latency_ms != null ? `${m.summary.avg_latency_ms}ms` : '—'}
          subtitle="p95: " 
          icon={Zap}
          color="cyan"
          loading={loading}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Requests per Minute */}
        <div className="lg:col-span-2 glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
            <Activity size={14} className="text-brand-400" />
            Requests per Minute (Last 30 min)
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={m?.requests_per_minute || []}>
              <defs>
                <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.brand} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.brand} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone" dataKey="requests" name="Requests"
                stroke={COLORS.brand} fill="url(#reqGrad)"
                strokeWidth={2} dot={false} activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Violation Breakdown Pie */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
            <AlertTriangle size={14} className="text-warning" />
            Violation Types
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={violationData} cx="50%" cy="45%"
                innerRadius={50} outerRadius={75}
                paddingAngle={3} dataKey="value"
              >
                {violationData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(v) => <span style={{ color: '#9ca3af', fontSize: 11 }}>{v}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Violation Trend */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
          <TrendingUp size={14} className="text-accent" />
          Violation Trend (Last 24 Hours)
        </h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={m?.violation_trend || []} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="total" name="Total" fill={COLORS.brand} opacity={0.4} radius={[2, 2, 0, 0]} />
            <Bar dataKey="violations" name="Violations" fill={COLORS.danger} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Agent Health Heatmap */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
            <Bot size={14} className="text-cyan-400" />
            Agent Health Heatmap
          </h3>
          <AgentHealthHeatmap agents={m?.agent_health || []} />
        </div>

        {/* Guardrail Stats */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
            <Shield size={14} className="text-brand-400" />
            Guardrail Statistics
          </h3>
          <div className="space-y-3">
            {[
              { label: 'Total Checks', value: m?.guardrail_stats?.total_checks, icon: Activity },
              { label: 'Passed', value: m?.guardrail_stats?.passed, icon: CheckCircle, color: 'text-success' },
              { label: 'Failed', value: m?.guardrail_stats?.failed, icon: XCircle, color: 'text-danger' },
              { label: 'Avg Latency p95', value: m?.latency?.p95 ? `${m.latency.p95}ms` : '—', icon: Clock },
              { label: 'Red-Team Runs', value: m?.summary?.red_team_runs, icon: Shield },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-2">
                  <Icon size={13} className={color || 'text-gray-500'} />
                  <span className="text-sm text-gray-400">{label}</span>
                </div>
                <span className={`text-sm font-semibold ${color || 'text-gray-200'}`}>
                  {loading ? <span className="w-8 h-3 bg-surface-4 rounded animate-pulse inline-block" /> : (value ?? '—')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
