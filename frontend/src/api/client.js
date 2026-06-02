import axios from 'axios';
import { useAuthStore } from '../store';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Request interceptor: attach JWT ──────────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── Response interceptor: handle 401 ────────────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (email, password, name) => api.post('/auth/register', { email, password, name }),
  me: () => api.get('/auth/me'),
  verifyEmail: (token) => api.get(`/auth/verify-email?token=${token}`),
  resendVerification: (email) => api.post('/auth/resend-verification', { email }),
  // MFA login steps
  verifyEmailOtp: (temp_token, code) => api.post('/auth/mfa/email-otp', { temp_token, code }),
  verifyTotp: (temp_token, code) => api.post('/auth/mfa/totp', { temp_token, code }),
  // 2FA / TOTP management
  setupTotp: () => api.post('/auth/2fa/setup'),
  confirmTotp: (code) => api.post('/auth/2fa/confirm', { code }),
  disableTotp: (password) => api.delete('/auth/2fa/totp', { data: { password } }),
  setMfaLevel: (level) => api.put('/auth/mfa/level', { level }),
};

// ─── Agents ───────────────────────────────────────────────────────────────────
export const agentsAPI = {
  list: (params) => api.get('/agents', { params }),
  get: (id) => api.get(`/agents/${id}`),
  create: (data) => api.post('/agents', data),
  update: (id, data) => api.put(`/agents/${id}`, data),
  delete: (id) => api.delete(`/agents/${id}`),
  issueToken: (id) => api.post(`/agents/${id}/token`),
  delegate: (id, childId) => api.post(`/agents/${id}/delegate`, { child_agent_id: childId }),
};

// ─── Guardrail ────────────────────────────────────────────────────────────────
export const guardrailAPI = {
  check: (data) => api.post('/guardrail/check', data),
  test: (data) => api.post('/guardrail/test', data),
  listPolicies: () => api.get('/guardrail/policies'),
  createPolicy: (data) => api.post('/guardrail/policies', data),
  updatePolicy: (id, data) => api.put(`/guardrail/policies/${id}`, data),
};

// ─── Audit ────────────────────────────────────────────────────────────────────
export const auditAPI = {
  log: (data) => api.post('/audit/log', data),
  list: (params) => api.get('/audit/logs', { params }),
  stats: () => api.get('/audit/stats'),
  exportCSV: (params) =>
    api.get('/audit/export', {
      params: { format: 'csv', ...params },
      responseType: 'blob',
    }),
};

// ─── Red-Team ─────────────────────────────────────────────────────────────────
export const redTeamAPI = {
  run: (agentId, attackTypes) => api.post('/redteam/run', { agent_id: agentId, attack_types: attackTypes }),
  listRuns: (params) => api.get('/redteam/runs', { params }),
  getRun: (id) => api.get(`/redteam/runs/${id}`),
  getAttacks: () => api.get('/redteam/attacks'),
  exportPDF: (id) =>
    api.get(`/redteam/runs/${id}/export`, {
      responseType: 'blob',
    }),
};

// ─── Dashboard ────────────────────────────────────────────────────────────────
export const dashboardAPI = {
  metrics: () => api.get('/dashboard/metrics'),
  listAlerts: () => api.get('/dashboard/alerts'),
  createAlert: (data) => api.post('/dashboard/alerts', data),
  updateAlert: (id, data) => api.put(`/dashboard/alerts/${id}`, data),
  deleteAlert: (id) => api.delete(`/dashboard/alerts/${id}`),
  listWebhooks: () => api.get('/dashboard/webhooks'),
  createWebhook: (data) => api.post('/dashboard/webhooks', data),
};

// ─── Health ───────────────────────────────────────────────────────────────────
export const healthAPI = {
  check: () => api.get('/health'),
};

export default api;
