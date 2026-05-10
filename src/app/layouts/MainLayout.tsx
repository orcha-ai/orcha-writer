import { Outlet } from 'react-router-dom';
import { AppProvider, useApp } from '../../AppContext';
import { ScrollSyncProvider } from '../../components/Editor';
import { SettingsApplier } from './SettingsApplier';
import { ConfigProvider, theme } from 'antd';
import { useState, useMemo, useEffect } from 'react';
import { useSettingsStore } from '../../store';

function normalizeThemeColor(color: string | undefined): string {
  const value = color?.trim();
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#0A84FF';
}

function AntThemeProvider({ children }: { children: React.ReactNode }) {
  const { state } = useApp();
  const themeColor = useSettingsStore(s => s.appearance.themeColor);
  const [systemDark, setSystemDark] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const isDark = useMemo(() => {
    if (state.theme === 'system') return systemDark;
    return state.theme === 'dark';
  }, [state.theme, systemDark]);

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? [theme.darkAlgorithm] : [theme.defaultAlgorithm],
        token: {
          colorPrimary: normalizeThemeColor(themeColor),
          colorInfo: normalizeThemeColor(themeColor),
          colorLink: normalizeThemeColor(themeColor),
          fontFamily: 'var(--font-sans)',
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}

export function MainLayout() {
  return (
    <AppProvider>
      <ScrollSyncProvider>
        <SettingsApplier />
        <AntThemeProvider>
          <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)' }}>
            <Outlet />
          </div>
        </AntThemeProvider>
      </ScrollSyncProvider>
    </AppProvider>
  );
}
