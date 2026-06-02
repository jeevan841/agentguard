import { useLocation } from 'react-router-dom';
import { Bell, User, LogOut, Wifi, WifiOff } from 'lucide-react';
import { useAuthStore, useMetricsStore } from '../store';
import toast from 'react-hot-toast';

const PAGE_TITLES = {
  '/dashboard': { title: 'Dashboard', subtitle: 'Live metrics & system overview' },
  '/agents': { title: 'Agents', subtitle: 'Manage AI agents and permissions' },
  '/audit': { title: 'Audit Logs', subtitle: 'Searchable, immutable audit trail' },
  '/redteam': { title: 'Red-Team', subtitle: 'Adversarial testing suite' },
  '/settings': { title: 'Settings', subtitle: 'Policies, alerts & webhooks' },
};

export default function TopBar() {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { isConnected, lastUpdated } = useMetricsStore();

  const page = PAGE_TITLES[location.pathname] || { title: 'AgentGuard', subtitle: '' };

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
  };

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-surface-2/40 backdrop-blur-sm">
      {/* Page Title */}
      <div>
        <h1 className="text-lg font-bold text-white">{page.title}</h1>
        <p className="text-xs text-gray-500">{page.subtitle}</p>
      </div>

      {/* Right Side */}
      <div className="flex items-center gap-3">
        {/* Connection Status */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
          isConnected
            ? 'bg-success/10 text-success border border-success/20'
            : 'bg-warning/10 text-warning border border-warning/20'
        }`}>
          {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {isConnected ? 'Live' : 'Offline'}
        </div>

        {/* Last updated */}
        {lastUpdated && (
          <span className="text-xs text-gray-500 hidden sm:block">
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}

        {/* User */}
        <div className="flex items-center gap-2 pl-3 border-l border-white/10">
          <div className="w-7 h-7 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center">
            <User size={14} className="text-brand-400" />
          </div>
          <div className="hidden sm:block">
            <p className="text-xs font-medium text-gray-200">{user?.name || user?.email}</p>
            <p className="text-xs text-gray-500">{user?.role || 'Admin'}</p>
          </div>
          <button
            onClick={handleLogout}
            className="ml-1 p-1.5 text-gray-500 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
            title="Logout"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
