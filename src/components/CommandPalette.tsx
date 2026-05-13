import { useEffect, useMemo, useRef, useState } from 'react';
import { filterCommands, getAppCommands } from '../commands';
import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import { translateText } from '../i18n';

export default function CommandPalette() {
  const { state, dispatch } = useApp();
  const language = useSettingsStore(s => s.general.language);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = (value: string) => translateText(language, value);

  const commands = useMemo(() => {
    const availableCommands = getAppCommands(language).filter(command => !command.requiresDocument || Boolean(state.activeTabId));
    return filterCommands(availableCommands, query);
  }, [language, query, state.activeTabId]);

  useEffect(() => {
    if (!state.commandPaletteOpen) return;
    setQuery('');
    setActiveIndex(0);
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, [state.commandPaletteOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!state.commandPaletteOpen) return null;

  const close = () => dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: false });

  const runCommand = (id: string) => {
    close();
    window.dispatchEvent(new CustomEvent('orcha-command', { detail: id }));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => Math.min(index + 1, Math.max(commands.length - 1, 0)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(index - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const command = commands[activeIndex];
      if (command) runCommand(command.id);
    }
  };

  return (
    <div className="command-palette-backdrop" onMouseDown={close}>
      <div className="command-palette" onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          placeholder={t('输入命令...')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="command-palette-list">
          {commands.length === 0 ? (
            <div className="command-empty">{t('没有匹配的命令')}</div>
          ) : commands.map((command, index) => (
            <button
              key={command.id}
              type="button"
              className={`command-palette-item ${index === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runCommand(command.id)}
            >
              <span className="command-title">{command.title}</span>
              <span className="command-category">{command.category}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
