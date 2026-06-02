import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Bot, ScrollText, Shield, Settings,
  ChevronLeft, ChevronRight, Zap
} from 'lucide-react';
import { useUIStore, useMetricsStore } from '../store';

const NAV_ITEMS = [
  { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/agents', icon: Bot, label: 'Agents' },
  { path: '/audit', icon: ScrollText, label: 'Audit Logs' },
  { path: '/redteam', icon: Shield, label: 'Red-Team' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const { isConnected } = useMetricsStore();

  return (
    <aside
      className={`relative flex flex-col bg-surface-2 border-r border-white/5 transition-all duration-300 ${
        sidebarOpen ? 'w-60' : 'w-16'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/5">
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center shadow-glow-sm">
          <span className="text-white text-sm font-bold">AG</span>
        </div>
        {sidebarOpen && (
          <div className="flex flex-col min-w-0">
            <span className="text-white font-bold text-sm leading-tight">AgentGuard</span>
            <span className="text-xs text-gray-500 truncate">AI Security Platform</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {sidebarOpen && (
          <p className="px-3 mb-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Navigation
          </p>
        )}
        {NAV_ITEMS.map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `nav-item ${isActive ? 'active' : ''} ${!sidebarOpen ? 'justify-center px-0' : ''}`
            }
            title={!sidebarOpen ? label : undefined}
          >
            <Icon size={18} className="flex-shrink-0" />
            {sidebarOpen && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Bottom Status */}
      <div className="px-2 py-4 border-t border-white/5">
        {sidebarOpen ? (
          <div className="glass-card px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-success animate-pulse' : 'bg-warning'}`} />
              <span className="text-xs font-medium text-gray-300">
                {isConnected ? 'Live' : 'Reconnecting'}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              {isConnected ? 'Real-time metrics active' : 'Connecting to server...'}
            </p>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success animate-pulse' : 'bg-warning'}`} />
          </div>
        )}
      </div>

      {/* Toggle Button */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full 
                   bg-surface-4 border border-white/10 flex items-center justify-center 
                   text-gray-400 hover:text-white hover:bg-brand-500 hover:border-brand-500
                   transition-all duration-150 z-10"
        title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {sidebarOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
      </button>
    </aside>
  );
}
