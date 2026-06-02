import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ─── Auth Store ───────────────────────────────────────────────────────────────
export const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      login: (user, token) => set({ user, token, isAuthenticated: true }),
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
      updateUser: (user) => set((state) => ({ user: { ...state.user, ...user } })),
    }),
    {
      name: 'agentguard-auth',
      partialize: (state) => ({ token: state.token, user: state.user }),
    }
  )
);

// ─── UI Store ─────────────────────────────────────────────────────────────────
export const useUIStore = create((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  // Active alerts banner
  alerts: [],
  addAlert: (alert) =>
    set((state) => ({
      alerts: [{ id: Date.now(), ...alert }, ...state.alerts].slice(0, 5),
    })),
  dismissAlert: (id) =>
    set((state) => ({ alerts: state.alerts.filter((a) => a.id !== id) })),
}));

// ─── Metrics Store ────────────────────────────────────────────────────────────
export const useMetricsStore = create((set) => ({
  metrics: null,
  isConnected: false,
  lastUpdated: null,

  setMetrics: (metrics) => set({ metrics, lastUpdated: new Date() }),
  setConnected: (isConnected) => set({ isConnected }),
}));

// ─── Agents Store ─────────────────────────────────────────────────────────────
export const useAgentsStore = create((set) => ({
  agents: [],
  total: 0,
  loading: false,

  setAgents: (agents, total) => set({ agents, total }),
  setLoading: (loading) => set({ loading }),
  addAgent: (agent) => set((state) => ({ agents: [agent, ...state.agents], total: state.total + 1 })),
  updateAgent: (id, data) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.id === id ? { ...a, ...data } : a)),
    })),
  removeAgent: (id) =>
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== id),
      total: state.total - 1,
    })),
}));
