import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../AppContext';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { setSearchQuery, SearchQuery, getSearchQuery } from '@codemirror/search';
import { getActiveEditorView } from './Editor';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countMatches(text: string, query: string): number {
  if (!query) return 0;
  const regex = new RegExp(escapeRegExp(query), 'gi');
  let count = 0;
  while (regex.exec(text)) count += 1;
  return count;
}

function findMatches(text: string, query: string): Array<{ from: number; to: number }> {
  if (!query) return [];
  const regex = new RegExp(escapeRegExp(query), 'gi');
  const matches: Array<{ from: number; to: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push({ from: match.index, to: match.index + match[0].length });
  }
  return matches;
}

export default function SearchPanel() {
  const { state, dispatch } = useApp();
  const [query, setQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.searchOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [state.searchOpen]);

  // Sync search query with CodeMirror and global state
  useEffect(() => {
    dispatch({ type: 'SET_SEARCH_QUERY', payload: query });
    dispatch({ type: 'SET_SEARCH_MATCH_INDEX', payload: 0 });

    let retries = 0;
    const timer = setInterval(() => {
      const view = getActiveEditorView();
      if (!view) {
        retries++;
        if (retries > 10) {
          const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
          setMatchCount(activeTab ? countMatches(activeTab.content, query) : 0);
          clearInterval(timer);
        }
        return;
      }
      clearInterval(timer);

      if (!query) {
        view.dispatch({
          effects: setSearchQuery.of(
            new (SearchQuery as any)({ search: '', caseSensitive: false, regexp: false, valid: false }),
          ),
        });
        setMatchCount(0);
        return;
      }

      view.dispatch({
        effects: setSearchQuery.of(
          new (SearchQuery as any)({ search: query, caseSensitive: false, regexp: false, valid: true }),
        ),
      });

      try {
        const text = view.state.doc.toString();
        setMatchCount(countMatches(text, query));
      } catch {
        setMatchCount(0);
      }
    }, 50);

    return () => clearInterval(timer);
  }, [dispatch, query, state.activeTabId, state.tabs]);

  const scrollToMark = useCallback((index: number) => {
    const marks = document.querySelectorAll('mark.search-highlight');
    if (marks.length === 0) return;
    const idx = ((index % marks.length) + marks.length) % marks.length;
    marks[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const handleNext = useCallback(() => {
    if (state.viewMode === 'preview') {
      // Preview mode: use DOM marks
      const nextIndex = matchCount > 0 ? (state.searchMatchIndex + 1) % matchCount : state.searchMatchIndex + 1;
      dispatch({ type: 'SET_SEARCH_MATCH_INDEX', payload: nextIndex });
      setTimeout(() => scrollToMark(nextIndex), 50);
      return;
    }

    const view = getActiveEditorView();
    if (view) {
      const q = getSearchQuery(view.state);
      if (q.valid && q.search) {
        const to = view.state.selection.main.to;
        const text = view.state.doc.toString();
        const escaped = escapeRegExp(q.search);
        const regex = new RegExp(escaped, 'gi');
        regex.lastIndex = to;
        const match = regex.exec(text);
        if (match) {
          view.dispatch({
            selection: { anchor: match.index, head: match.index + match[0].length },
            scrollIntoView: true,
          });
        } else {
          regex.lastIndex = 0;
          const wrapMatch = regex.exec(text);
          if (wrapMatch) {
            view.dispatch({
              selection: { anchor: wrapMatch.index, head: wrapMatch.index + wrapMatch[0].length },
              scrollIntoView: true,
            });
          }
        }
        if (matchCount > 0) {
          dispatch({ type: 'SET_SEARCH_MATCH_INDEX', payload: (state.searchMatchIndex + 1) % matchCount });
        }
      }
    }
  }, [dispatch, matchCount, state.viewMode, state.searchMatchIndex, scrollToMark]);

  const handlePrev = useCallback(() => {
    if (state.viewMode === 'preview') {
      // Preview mode: use DOM marks
      const nextIndex = matchCount > 0 ? (state.searchMatchIndex - 1 + matchCount) % matchCount : Math.max(0, state.searchMatchIndex - 1);
      dispatch({ type: 'SET_SEARCH_MATCH_INDEX', payload: nextIndex });
      setTimeout(() => scrollToMark(nextIndex), 50);
      return;
    }

    const view = getActiveEditorView();
    if (view) {
      const q = getSearchQuery(view.state);
      if (q.valid && q.search) {
        const from = view.state.selection.main.from;
        const text = view.state.doc.toString();
        const escaped = escapeRegExp(q.search);
        const regex = new RegExp(escaped, 'gi');
        const matches: { index: number; length: number }[] = [];
        let m;
        while ((m = regex.exec(text)) !== null) {
          matches.push({ index: m.index, length: m[0].length });
        }
        if (matches.length === 0) return;
        let prevIdx = -1;
        for (let i = matches.length - 1; i >= 0; i--) {
          if (matches[i].index < from) {
            prevIdx = i;
            break;
          }
        }
        if (prevIdx === -1) prevIdx = matches.length - 1;
        const match = matches[prevIdx];
        view.dispatch({
          selection: { anchor: match.index, head: match.index + match.length },
          scrollIntoView: true,
        });
        if (matchCount > 0) {
          dispatch({ type: 'SET_SEARCH_MATCH_INDEX', payload: (state.searchMatchIndex - 1 + matchCount) % matchCount });
        }
      }
    }
  }, [dispatch, matchCount, state.viewMode, state.searchMatchIndex, scrollToMark]);

  const handleReplaceCurrent = useCallback(() => {
    if (!query) return;
    const view = getActiveEditorView();
    const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);

    if (view) {
      const text = view.state.doc.toString();
      const matches = findMatches(text, query);
      if (matches.length === 0) return;

      const selection = view.state.selection.main;
      const selectedText = view.state.sliceDoc(selection.from, selection.to);
      const current = !selection.empty && selectedText.toLowerCase() === query.toLowerCase()
        ? { from: selection.from, to: selection.to }
        : matches.find(match => match.from >= selection.to) ?? matches[0];

      view.focus();
      const nextText = text.slice(0, current.from) + replaceText + text.slice(current.to);
      view.dispatch({
        changes: { from: current.from, to: current.to, insert: replaceText },
        selection: { anchor: current.from, head: current.from + replaceText.length },
        scrollIntoView: true,
      });
      setMatchCount(countMatches(nextText, query));
      return;
    }

    if (!activeTab) return;
    const regex = new RegExp(escapeRegExp(query), 'i');
    const nextContent = activeTab.content.replace(regex, () => replaceText);
    if (nextContent !== activeTab.content) {
      dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: nextContent } });
      setMatchCount(countMatches(nextContent, query));
    }
  }, [dispatch, query, replaceText, state.activeTabId, state.tabs]);

  const handleReplaceAll = useCallback(() => {
    if (!query) return;
    const view = getActiveEditorView();
    const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);

    if (view) {
      const text = view.state.doc.toString();
      const replacedCount = countMatches(text, query);
      if (replacedCount === 0) return;
      const nextText = text.replace(new RegExp(escapeRegExp(query), 'gi'), () => replaceText);
      view.focus();
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextText },
        scrollIntoView: true,
      });
      setMatchCount(0);
      dispatch({ type: 'SET_SEARCH_MATCH_INDEX', payload: 0 });
      return;
    }

    if (!activeTab) return;
    const replacedCount = countMatches(activeTab.content, query);
    if (replacedCount === 0) return;
    const nextContent = activeTab.content.replace(new RegExp(escapeRegExp(query), 'gi'), () => replaceText);
    dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: nextContent } });
    setMatchCount(0);
    dispatch({ type: 'SET_SEARCH_MATCH_INDEX', payload: 0 });
  }, [dispatch, query, replaceText, state.activeTabId, state.tabs]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!state.searchOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dispatch({ type: 'CLOSE_SEARCH' });
      }
      if (e.key === 'Enter' && state.replaceOpen && e.altKey) {
        handleReplaceCurrent();
      } else if (e.key === 'Enter' && e.shiftKey) {
        handlePrev();
      } else if (e.key === 'Enter') {
        handleNext();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.searchOpen, state.replaceOpen, dispatch, handleNext, handlePrev, handleReplaceCurrent]);

  if (!state.searchOpen) return null;

  return (
    <div className={`search-panel ${state.replaceOpen ? 'replace-open' : ''}`}>
      <div className="search-row">
        <Search size={14} style={{ opacity: 0.5 }} />
        <input
          ref={inputRef}
          className="search-input"
          placeholder="搜索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="search-count">
          {matchCount > 0 ? `${state.searchMatchIndex + 1} / ${matchCount}` : '0 / 0'}
        </span>
        <button className="toolbar-btn" onClick={handlePrev} title="上一个" disabled={matchCount === 0}>
          <ChevronUp size={14} />
        </button>
        <button className="toolbar-btn" onClick={handleNext} title="下一个" disabled={matchCount === 0}>
          <ChevronDown size={14} />
        </button>
        <button
          className={`search-mode-btn ${state.replaceOpen ? 'active' : ''}`}
          onClick={() => dispatch({ type: 'TOGGLE_REPLACE' })}
          title="切换替换"
        >
          替换
        </button>
        <button
          className="search-close"
          onClick={() => {
            dispatch({ type: 'CLOSE_SEARCH' });
            setQuery('');
            dispatch({ type: 'SET_SEARCH_QUERY', payload: '' });
          }}
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>
      {state.replaceOpen && (
        <div className="search-row replace-row">
          <span className="search-row-spacer" />
          <input
            className="search-input"
            placeholder="替换为..."
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
          />
          <button className="search-action-btn" onClick={handleReplaceCurrent} disabled={!query || matchCount === 0}>
            替换
          </button>
          <button className="search-action-btn" onClick={handleReplaceAll} disabled={!query || matchCount === 0}>
            全部
          </button>
        </div>
      )}
    </div>
  );
}
