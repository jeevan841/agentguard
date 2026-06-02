import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { useUIStore } from '../store';
import { useWebSocket } from '../hooks/useWebSocket';

export default function Layout() {
  // Initialize WebSocket connection for real-time metrics
  useWebSocket();

  const { sidebarOpen } = useUIStore();

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      {/* Background glow effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <div
        className={`flex-1 flex flex-col min-h-0 transition-all duration-300 ${
          sidebarOpen ? 'ml-0' : 'ml-0'
        }`}
      >
        <TopBar />
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-screen-2xl mx-auto animate-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
