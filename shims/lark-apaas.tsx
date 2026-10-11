// Shim for @lark-apaas/client-toolkit-lite
import React from 'react';

// Scoped storage using localStorage
const STORAGE_SCOPE = 'glowstone_';

export const scopedStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(STORAGE_SCOPE + key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(STORAGE_SCOPE + key, value);
    } catch {
      // ignore
    }
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(STORAGE_SCOPE + key);
    } catch {
      // ignore
    }
  },
};

// Logger
export const logger = {
  log: (...args: unknown[]) => console.log('[Glowstone]', ...args),
  info: (...args: unknown[]) => console.info('[Glowstone]', ...args),
  warn: (...args: unknown[]) => console.warn('[Glowstone]', ...args),
  error: (...args: unknown[]) => console.error('[Glowstone]', ...args),
  debug: (...args: unknown[]) => console.debug('[Glowstone]', ...args),
};

// AppContainer - just renders children
export function AppContainer({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ErrorRender - simple error display
export function ErrorRender({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h2 style={{ color: '#ef4444' }}>Something went wrong</h2>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem', color: '#666' }}>{error.message}</pre>
      <button
        onClick={resetErrorBoundary}
        style={{ marginTop: '1rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer' }}
      >
        Try again
      </button>
    </div>
  );
}
