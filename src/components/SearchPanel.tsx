import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../AppContext';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { setSearchQuery, SearchQuery, getSearchQuery } from '@codemirror/search';
import { getActiveEditorView } from './Editor';

export default function SearchPanel() {
  const { state, dispatch } = useApp();
  const [query, setQuery] = useState('');
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
        if (retries > 10) clearInterval(timer);
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

      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      view.dispatch({
        effects: setSearchQuery.of(
          new (SearchQuery as any)({ search: escaped, caseSensitive: false, regexp: false, valid: true }),
        ),
      });

      try {
        const regex = new RegExp(escaped, 'gi');
        const text = view.state.doc.toString();
        let count = 0;
        while (regex.exec(text)) count++;
        setMatchCount(count);
      } catch {
        setMatchCount(0);
      }
    }, 50);

    return () => clearInterval(timer);
  }, [query, state.activeTabId]);

  const scrollToMark = useCallback((index: number) => {
    const marks = document.querySelectorAll('mark.search-highlight');
    if (marks.length === 0) return;
    const idx = ((index % marks.length) + marks.length) % marks.length;
    marks[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const handleNext = useCallback(() => {
    if (state.viewMode === 'preview') {
      // Preview mode: use DOM marks
      dispatch({ type: 'SET_SEARCH_MATCH_INDEX', payload: state.searchMatchIndex + 1 });
      setTimeout(() => scrollToMark(state.searchMatchIndex + 1), 50);
      return;
    }

    const view = getActiveEditorView();
    if (view) {
      const q = getSearchQuery(view.state);
      if (q.valid && q.search) {
        const to = view.state.selection.main.to;
        const text = view.state.doc.toString();
        const escaped = q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      }
    }
  }, [state.viewMode, state.searchMatchIndex, scrollToMark]);

  const handlePrev = useCallback(() => {
    if (state.viewMode === 'preview') {
      // Preview mode: use DOM marks
      dispatch({ type: 'SET_SEARCH_MATCH_INDEX', payload: Math.max(0, state.searchMatchIndex - 1) });
      setTimeout(() => scrollToMark(state.searchMatchIndex - 1), 50);
      return;
    }

    const view = getActiveEditorView();
    if (view) {
      const q = getSearchQuery(view.state);
      if (q.valid && q.search) {
        const from = view.state.selection.main.from;
        const text = view.state.doc.toString();
        const escaped = q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      }
    }
  }, [state.viewMode, state.searchMatchIndex, scrollToMark]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!state.searchOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dispatch({ type: 'TOGGLE_SEARCH' });
      }
      if (e.key === 'Enter' && e.shiftKey) {
        handlePrev();
      } else if (e.key === 'Enter') {
        handleNext();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.searchOpen, dispatch, handleNext, handlePrev]);

  if (!state.searchOpen) return null;

  return (
    <div className="search-panel">
      <Search size={14} style={{ opacity: 0.5 }} />
      <input
        ref={inputRef}
        className="search-input"
        placeholder="搜索..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matchCount > 0 && (
        <>
          <span className="search-count">
            {state.searchMatchIndex + 1} / {matchCount}
          </span>
          <button className="toolbar-btn" onClick={handlePrev} title="上一个">
            <ChevronUp size={14} />
          </button>
          <button className="toolbar-btn" onClick={handleNext} title="下一个">
            <ChevronDown size={14} />
          </button>
        </>
      )}
      <button className="search-close" onClick={() => { dispatch({ type: 'TOGGLE_SEARCH' }); setQuery(''); dispatch({ type: 'SET_SEARCH_QUERY', payload: '' }); }}>
        <X size={14} />
      </button>
    </div>
  );
}
