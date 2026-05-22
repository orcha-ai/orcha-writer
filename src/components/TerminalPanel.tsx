import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Terminal as XTerm, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { RotateCcw, SquareTerminal, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import { translateText } from '../i18n';
import '@xterm/xterm/css/xterm.css';

interface TerminalCreateResult {
  id: string;
  cwd: string;
  shell: string;
}

interface TerminalOutputEvent {
  id: string;
  bytes: number[];
}

interface TerminalExitEvent {
  id: string;
  code: number | null;
}

type TerminalStatus = 'starting' | 'running' | 'exited' | 'error';

const TERMINAL_HEIGHT_STORAGE_KEY = 'orcha-writer.terminal.height';
const DEFAULT_TERMINAL_HEIGHT = 260;
const MIN_TERMINAL_HEIGHT = 180;

function maxTerminalHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_TERMINAL_HEIGHT;
  return Math.max(MIN_TERMINAL_HEIGHT + 40, Math.floor(window.innerHeight * 0.7));
}

function clampTerminalHeight(height: number): number {
  return Math.min(maxTerminalHeight(), Math.max(MIN_TERMINAL_HEIGHT, Math.round(height)));
}

function initialTerminalHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_TERMINAL_HEIGHT;
  const storedValue = window.localStorage.getItem(TERMINAL_HEIGHT_STORAGE_KEY);
  if (!storedValue) return DEFAULT_TERMINAL_HEIGHT;
  const stored = Number(storedValue);
  return Number.isFinite(stored) ? clampTerminalHeight(stored) : DEFAULT_TERMINAL_HEIGHT;
}

function terminalTheme(): ITerminalOptions['theme'] {
  const styles = getComputedStyle(document.documentElement);
  return {
    background: styles.getPropertyValue('--bg-code-block').trim() || '#0b111a',
    foreground: styles.getPropertyValue('--text-primary').trim() || '#e6edf7',
    cursor: styles.getPropertyValue('--accent').trim() || '#0a84ff',
    selectionBackground: styles.getPropertyValue('--accent-bg').trim() || '#102a44',
    black: '#0f172a',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#f59e0b',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#e5e7eb',
    brightBlack: '#64748b',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#fbbf24',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#f8fafc',
  };
}

export default function TerminalPanel() {
  const { state, dispatch } = useApp();
  const language = useSettingsStore(s => s.general.language);
  const t = useCallback((value: string, params?: Record<string, string | number>) => (
    translateText(language, value, params)
  ), [language]);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const decoderRef = useRef(new TextDecoder());
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [status, setStatus] = useState<TerminalStatus>('starting');
  const [sessionInfo, setSessionInfo] = useState<TerminalCreateResult | null>(null);
  const [restartKey, setRestartKey] = useState(0);
  const [panelHeight, setPanelHeight] = useState(initialTerminalHeight);

  const closeTerminal = useCallback(() => {
    dispatch({ type: 'SET_TERMINAL_OPEN', payload: false });
  }, [dispatch]);

  const restartTerminal = useCallback(() => {
    const id = sessionIdRef.current;
    if (id) {
      void invoke('terminal_kill', { id });
    }
    setRestartKey(key => key + 1);
  }, []);

  const setClampedPanelHeight = useCallback((height: number) => {
    const nextHeight = clampTerminalHeight(height);
    setPanelHeight(nextHeight);
    try {
      window.localStorage.setItem(TERMINAL_HEIGHT_STORAGE_KEY, String(nextHeight));
    } catch {
      // Ignore storage failures; resizing should still work for this session.
    }
  }, []);

  const startResize = useCallback((clientY: number) => {
    if (dragStateRef.current) return;
    dragStateRef.current = {
      startY: clientY,
      startHeight: panelHeight,
    };
    document.body.classList.add('terminal-resizing');
  }, [panelHeight]);

  const updateResize = useCallback((clientY: number) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    setClampedPanelHeight(dragState.startHeight + dragState.startY - clientY);
  }, [setClampedPanelHeight]);

  const finishResize = useCallback(() => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    document.body.classList.remove('terminal-resizing');
    terminalRef.current?.focus();
  }, []);

  const handleResizePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    startResize(event.clientY);
  }, [startResize]);

  const handleResizeMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    startResize(event.clientY);
  }, [startResize]);

  const handleResizeDoubleClick = useCallback(() => {
    setClampedPanelHeight(DEFAULT_TERMINAL_HEIGHT);
  }, [setClampedPanelHeight]);

  const handleResizeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setClampedPanelHeight(panelHeight + 24);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setClampedPanelHeight(panelHeight - 24);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setClampedPanelHeight(MIN_TERMINAL_HEIGHT);
    } else if (event.key === 'End') {
      event.preventDefault();
      setClampedPanelHeight(maxTerminalHeight());
    }
  }, [panelHeight, setClampedPanelHeight]);

  useEffect(() => {
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      updateResize(event.clientY);
    };
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      updateResize(event.clientY);
    };
    const handleWindowResize = () => {
      setPanelHeight(height => clampTerminalHeight(height));
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', finishResize);
    window.addEventListener('resize', handleWindowResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', finishResize);
      window.removeEventListener('resize', handleWindowResize);
      document.body.classList.remove('terminal-resizing');
    };
  }, [finishResize, updateResize]);

  useEffect(() => {
    if (!state.terminalOpen) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    let disposed = false;
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;
    let fitFrame = 0;
    const fitAddon = new FitAddon();
    const terminal = new XTerm({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      rows: 12,
      scrollback: 5000,
      theme: terminalTheme(),
    });
    terminalRef.current = terminal;
    sessionIdRef.current = null;
    decoderRef.current = new TextDecoder();
    setSessionInfo(null);
    setStatus('starting');

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);
    terminal.writeln(t('正在启动终端...'));

    const fitAndResize = () => {
      window.cancelAnimationFrame(fitFrame);
      fitFrame = window.requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          const id = sessionIdRef.current;
          if (id) {
            void invoke('terminal_resize', { id, cols: terminal.cols, rows: terminal.rows });
          }
        } catch (error) {
          console.warn('Failed to fit terminal:', error);
        }
      });
    };

    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(container);
    fitAndResize();

    const dataDisposable = terminal.onData(data => {
      const id = sessionIdRef.current;
      if (!id) return;
      void invoke('terminal_write', { id, data }).catch(error => {
        console.error('Failed to write terminal data:', error);
      });
    });

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      const id = sessionIdRef.current;
      if (!id) return;
      void invoke('terminal_resize', { id, cols, rows }).catch(error => {
        console.error('Failed to resize terminal:', error);
      });
    });

    async function start() {
      try {
        if (!isTauri()) {
          setStatus('error');
          terminal.writeln(t('内置终端仅在桌面应用中可用'));
          return;
        }

        unlistenOutput = await listen<TerminalOutputEvent>('terminal-output', event => {
          if (event.payload.id !== sessionIdRef.current) return;
          const bytes = new Uint8Array(event.payload.bytes);
          terminal.write(decoderRef.current.decode(bytes, { stream: true }));
        });
        unlistenExit = await listen<TerminalExitEvent>('terminal-exit', event => {
          if (event.payload.id !== sessionIdRef.current) return;
          setStatus('exited');
          const code = event.payload.code;
          terminal.writeln('');
          terminal.writeln(code == null
            ? t('终端进程已退出')
            : t('终端进程已退出，代码 {code}', { code }));
        });

        fitAddon.fit();
        const created = await invoke<TerminalCreateResult>('terminal_create', {
          cwd: state.workspacePath,
          cols: terminal.cols,
          rows: terminal.rows,
        });

        if (disposed) {
          void invoke('terminal_kill', { id: created.id });
          return;
        }

        sessionIdRef.current = created.id;
        setSessionInfo(created);
        setStatus('running');
        terminal.focus();
      } catch (error) {
        console.error('Failed to start terminal:', error);
        setStatus('error');
        terminal.writeln(String(error));
      }
    }

    void start();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(fitFrame);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      unlistenOutput?.();
      unlistenExit?.();
      const id = sessionIdRef.current;
      if (id) {
        void invoke('terminal_kill', { id });
      }
      sessionIdRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [restartKey, state.terminalOpen, state.workspacePath, t]);

  if (!state.terminalOpen) return null;

  const statusText = status === 'running'
    ? sessionInfo?.cwd || t('运行中')
    : status === 'starting'
      ? t('启动中')
      : status === 'exited'
        ? t('已退出')
        : t('启动失败');
  const maxHeight = maxTerminalHeight();

  return (
    <section
      className="terminal-panel"
      aria-label={t('终端')}
      style={{ height: panelHeight }}
    >
      <div
        className="terminal-resize-handle"
        role="separator"
        aria-label={t('调整终端高度')}
        aria-orientation="horizontal"
        aria-valuemin={MIN_TERMINAL_HEIGHT}
        aria-valuemax={maxHeight}
        aria-valuenow={panelHeight}
        tabIndex={0}
        title={t('调整终端高度')}
        onPointerDown={handleResizePointerDown}
        onMouseDown={handleResizeMouseDown}
        onDoubleClick={handleResizeDoubleClick}
        onKeyDown={handleResizeKeyDown}
      />
      <div className="terminal-header">
        <div className="terminal-title">
          <SquareTerminal size={15} />
          <span>{t('终端')}</span>
          {sessionInfo?.shell && <span className="terminal-shell">{sessionInfo.shell}</span>}
        </div>
        <div className="terminal-status" title={statusText}>{statusText}</div>
        <div className="terminal-actions">
          <button
            type="button"
            className="terminal-icon-btn"
            onClick={restartTerminal}
            aria-label={t('重启终端')}
            title={t('重启终端')}
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            className="terminal-icon-btn"
            onClick={closeTerminal}
            aria-label={t('关闭终端')}
            title={t('关闭终端')}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="terminal-body" ref={containerRef} />
    </section>
  );
}
