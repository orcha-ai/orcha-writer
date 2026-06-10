import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../AppContext';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { setSearchQuery, SearchQuery, getSearchQuery } from '@codemirror/search';
import { getActiveEditorView } from './Editor';
import { useSettingsStore } from '../store';
import { translateText } from '../i18n';
import { effectiveViewModeForDocument } from '../utils/documentCapabilities';

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

interface BlockSearchMatch {
  textarea: HTMLTextAreaElement;
  from: number;
  to: number;
}

const BLOCK_SEARCH_ACTIVE_CLASS = 'is-search-active';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function refreshBlockTextareaLayout(textarea: HTMLTextAreaElement): void {
  textarea.style.height = '0px';
  textarea.style.height = `${Math.max(30, textarea.scrollHeight)}px`;
}

function getBlockTextareas(): HTMLTextAreaElement[] {
  const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>('.block-editor-shell .block-textarea'));
  textareas.forEach(refreshBlockTextareaLayout);
  return textareas;
}

function findBlockSearchMatches(query: string): BlockSearchMatch[] {
  if (!query) return [];
  return getBlockTextareas().flatMap((textarea) => (
    findMatches(textarea.value, query).map(match => ({
      textarea,
      from: match.from,
      to: match.to,
    }))
  ));
}

function clearBlockSearchActive(): void {
  document.querySelectorAll(`.block-row.${BLOCK_SEARCH_ACTIVE_CLASS}`).forEach((row) => {
    row.classList.remove(BLOCK_SEARCH_ACTIVE_CLASS);
  });
}

function markBlockSearchMatch(match: BlockSearchMatch): void {
  clearBlockSearchActive();
  match.textarea.closest('.block-row')?.classList.add(BLOCK_SEARCH_ACTIVE_CLASS);
}

function measureTextareaOffsetTop(textarea: HTMLTextAreaElement, offset: number): number {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const marker = document.createElement('span');
  const properties = [
    'boxSizing',
    'width',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'textAlign',
    'textTransform',
    'wordSpacing',
    'wordBreak',
    'tabSize',
  ] as const;

  properties.forEach((property) => {
    mirror.style[property] = style[property];
  });
  mirror.style.position = 'fixed';
  mirror.style.left = '-10000px';
  mirror.style.top = '0';
  mirror.style.height = 'auto';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.overflow = 'hidden';
  mirror.textContent = textarea.value.slice(0, offset);
  marker.textContent = '\u200b';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

function scrollBlockSearchMatchIntoView(match: BlockSearchMatch, behavior: ScrollBehavior): void {
  refreshBlockTextareaLayout(match.textarea);
  const scroller = match.textarea.closest('.block-document-scroll') as HTMLElement | null;
  if (!scroller) {
    match.textarea.scrollIntoView({ behavior, block: 'center' });
    return;
  }

  const scrollerRect = scroller.getBoundingClientRect();
  const textareaRect = match.textarea.getBoundingClientRect();
  const textareaTop = textareaRect.top - scrollerRect.top + scroller.scrollTop;
  const style = window.getComputedStyle(match.textarea);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.6 || 22;
  const measuredTop = measureTextareaOffsetTop(match.textarea, match.from);
  const matchOffsetTop = clamp(measuredTop, 0, Math.max(0, match.textarea.scrollHeight - lineHeight));
  const matchTop = textareaTop + matchOffsetTop;
  const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const targetTop = clamp(matchTop - scroller.clientHeight * 0.38, 0, maxTop);
  scroller.scrollTo({ top: targetTop, behavior });
}

function activateBlockSearchMatch(match: BlockSearchMatch): void {
  markBlockSearchMatch(match);
  const row = match.textarea.closest('.block-row');
  row?.scrollIntoView({ behavior: 'auto', block: 'nearest' });
  scrollBlockSearchMatchIntoView(match, 'auto');
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      scrollBlockSearchMatchIntoView(match, 'auto');
    });
  });
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(textarea, value);
  else textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export default function SearchPanel() {
  const { state, dispatch } = useApp();
  const language = useSettingsStore(s => s.general.language);
  const t = (value: string) => translateText(language, value);
  const [query, setQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const blockNavigationStartedRef = useRef(false);
  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
  const effectiveViewMode = effectiveViewModeForDocument(activeTab, state.viewMode);

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
    blockNavigationStartedRef.current = false;
    clearBlockSearchActive();

    if (effectiveViewMode === 'block') {
      const frame = window.requestAnimationFrame(() => {
        const blockMatchCount = findBlockSearchMatches(query).length;
        setMatchCount(blockMatchCount || (activeTab ? countMatches(activeTab.content, query) : 0));
      });
      return () => window.cancelAnimationFrame(frame);
    }

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
            new SearchQuery({ search: '', caseSensitive: false, regexp: false }),
          ),
        });
        setMatchCount(0);
        return;
      }

      view.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({ search: query, caseSensitive: false, regexp: false }),
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
  }, [activeTab, dispatch, effectiveViewMode, query, state.activeTabId, state.tabs]);

  useEffect(() => {
    if (state.searchOpen && effectiveViewMode === 'block') return;
    clearBlockSearchActive();
  }, [effectiveViewMode, state.searchOpen]);

  const scrollToMark = useCallback((index: number) => {
    const marks = document.querySelectorAll('mark.search-highlight');
    if (marks.length === 0) return;
    const idx = ((index % marks.length) + marks.length) % marks.length;
    marks[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const handleNext = useCallback(() => {
    if (effectiveViewMode === 'block') {
      const matches = findBlockSearchMatches(query);
      if (matches.length === 0) return;
      const nextIndex = blockNavigationStartedRef.current
        ? (state.searchMatchIndex + 1) % matches.length
        : 0;
      blockNavigationStartedRef.current = true;
      dispatch({ type: 'SET_SEARCH_MATCH_INDEX', payload: nextIndex });
      activateBlockSearchMatch(matches[nextIndex]);
      return;
    }

    if (effectiveViewMode === 'preview') {
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
  }, [dispatch, effectiveViewMode, matchCount, query, state.searchMatchIndex, scrollToMark]);

  const handlePrev = useCallback(() => {
    if (effectiveViewMode === 'block') {
      const matches = findBlockSearchMatches(query);
      if (matches.length === 0) return;
      const nextIndex = blockNavigationStartedRef.current
        ? (state.searchMatchIndex - 1 + matches.length) % matches.length
        : matches.length - 1;
      blockNavigationStartedRef.current = true;
      dispatch({ type: 'SET_SEARCH_MATCH_INDEX', payload: nextIndex });
      activateBlockSearchMatch(matches[nextIndex]);
      return;
    }

    if (effectiveViewMode === 'preview') {
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
  }, [dispatch, effectiveViewMode, matchCount, query, state.searchMatchIndex, scrollToMark]);

  const handleReplaceCurrent = useCallback(() => {
    if (!query) return;
    if (effectiveViewMode === 'block') {
      const matches = findBlockSearchMatches(query);
      if (matches.length === 0) return;
      const index = Math.min(state.searchMatchIndex, matches.length - 1);
      const match = matches[index] || matches[0];
      const value = match.textarea.value;
      const nextValue = value.slice(0, match.from) + replaceText + value.slice(match.to);
      setTextareaValue(match.textarea, nextValue);
      window.requestAnimationFrame(() => {
        const nextCount = findBlockSearchMatches(query).length;
        setMatchCount(nextCount);
        const nextIndex = Math.min(index, Math.max(0, nextCount - 1));
        dispatch({ type: 'SET_SEARCH_MATCH_INDEX', payload: nextIndex });
        const nextMatch = findBlockSearchMatches(query)[nextIndex];
        if (nextMatch) activateBlockSearchMatch(nextMatch);
      });
      return;
    }

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
  }, [dispatch, effectiveViewMode, query, replaceText, state.activeTabId, state.searchMatchIndex, state.tabs]);

  const handleReplaceAll = useCallback(() => {
    if (!query) return;
    if (effectiveViewMode === 'block') {
      const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
      if (!activeTab) return;
      const replacedCount = countMatches(activeTab.content, query);
      if (replacedCount === 0) return;
      const nextContent = activeTab.content.replace(new RegExp(escapeRegExp(query), 'gi'), () => replaceText);
      dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: nextContent } });
      setMatchCount(0);
      dispatch({ type: 'SET_SEARCH_MATCH_INDEX', payload: 0 });
      return;
    }

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
  }, [dispatch, effectiveViewMode, query, replaceText, state.activeTabId, state.tabs]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!state.searchOpen) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const inSearchPanel = Boolean(target?.closest('.search-panel'));
      if (e.key === 'Escape') {
        dispatch({ type: 'CLOSE_SEARCH' });
      }
      if (!inSearchPanel) return;
      if (e.key === 'Enter' && state.replaceOpen && e.altKey) {
        e.preventDefault();
        handleReplaceCurrent();
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'Enter') {
        e.preventDefault();
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
          placeholder={t('搜索...')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="search-count">
          {matchCount > 0 ? `${state.searchMatchIndex + 1} / ${matchCount}` : '0 / 0'}
        </span>
        <button className="toolbar-btn" onClick={handlePrev} title={t('上一个')} disabled={matchCount === 0}>
          <ChevronUp size={14} />
        </button>
        <button className="toolbar-btn" onClick={handleNext} title={t('下一个')} disabled={matchCount === 0}>
          <ChevronDown size={14} />
        </button>
        <button
          className={`search-mode-btn ${state.replaceOpen ? 'active' : ''}`}
          onClick={() => dispatch({ type: 'TOGGLE_REPLACE' })}
          title={t('切换替换')}
        >
          {t('替换')}
        </button>
        <button
          className="search-close"
          onClick={() => {
            dispatch({ type: 'CLOSE_SEARCH' });
            setQuery('');
            dispatch({ type: 'SET_SEARCH_QUERY', payload: '' });
          }}
          title={t('关闭')}
        >
          <X size={14} />
        </button>
      </div>
      {state.replaceOpen && (
        <div className="search-row replace-row">
          <span className="search-row-spacer" />
          <input
            className="search-input"
            placeholder={t('替换为...')}
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
          />
          <button className="search-action-btn" onClick={handleReplaceCurrent} disabled={!query || matchCount === 0}>
            {t('替换')}
          </button>
          <button className="search-action-btn" onClick={handleReplaceAll} disabled={!query || matchCount === 0}>
            {t('全部')}
          </button>
        </div>
      )}
    </div>
  );
}
