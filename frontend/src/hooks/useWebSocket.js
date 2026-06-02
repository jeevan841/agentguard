import { useEffect, useRef, useCallback } from 'react';
import { useMetricsStore, useAuthStore } from '../store';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4000';

export function useWebSocket() {
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const reconnectAttempts = useRef(0);
  const { setMetrics, setConnected } = useMetricsStore();
  const { token, isAuthenticated } = useAuthStore();

  const connect = useCallback(() => {
    // Don't connect if not authenticated
    if (!isAuthenticated || !token) {
      setConnected(false);
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      // Include token in WebSocket URL
      const ws = new WebSocket(`${WS_URL}/ws/metrics?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected');
        setConnected(true);
        reconnectAttempts.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'metrics' && message.data) {
            setMetrics(message.data);
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        setConnected(false);
        console.log('[WS] Disconnected, reconnecting...');

        // Exponential backoff reconnect
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = (err) => {
        console.warn('[WS] Error, closing connection');
        ws.close();
      };
    } catch (err) {
      console.warn('[WS] Could not connect:', err.message);
      // Retry in 5s
      reconnectTimer.current = setTimeout(connect, 5000);
    }
  }, [setMetrics, setConnected, token, isAuthenticated]);

  useEffect(() => {
    connect();

    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional close
        wsRef.current.close();
      }
    };
  }, [connect]);
}
