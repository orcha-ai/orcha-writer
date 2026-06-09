import { Alert, Button, message, Modal, Tooltip } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { confirm as confirmDialog, open } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { subscribeEditorSelection } from '../../../components/Editor';
import { useApp } from '../../../AppContext';
import { useAiStore, useSettingsStore } from '../../../store';
import { getDocumentLanguage, translateText } from '../../../i18n';
import { findUsableAgent, normalizeAIAgents } from '../services/aiAgentService';
import { findCommand, getAgentCommands, getAllAICommands } from '../services/aiCommandService';
import { buildAIContext } from '../services/aiContextBuilder';
import { isAIRequestCancelled, sendAIChatRequest, type AIStreamUpdate } from '../services/aiRequestService';
import { createAIId, nowIso } from '../services/id';
import { useAIChatStore } from '../stores/aiChatStore';
import type {
  AIChatRequest,
  AICommandPreset,
  AIContextSnapshot,
  AIContextStrategy,
  AIMessage,
  AIResultAction,
  AIResultCard,
  EditorBridge,
  EditorSelection,
} from '../types';
import { DEFAULT_AI_SETTINGS } from '../types';
import { AIChatHeader } from './AIChatHeader';
import { AIInputBox, type AIContextMode, type AIInputAttachment, type AIInputContextPreview } from './AIInputBox';
import { ContextBox } from './ContextBox';
import { MessageList } from './MessageList';
import { SelectionAIPopover } from './SelectionAIPopover';
import '../styles.css';

export interface AIChatPanelProps {
  documentId: string;
  documentPath?: string;
  documentTitle?: string;
  editorBridge: EditorBridge;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onOpenSettings?: () => void;
  onOpenAgentManager?: () => void;
  onCreateMarkdownFile?: (content: string) => Promise<void> | void;
  onClose?: () => void;
}

interface ConfirmActionOptions {
  okText?: string;
  cancelText?: string;
  kind?: 'info' | 'warning' | 'error';
}

async function confirmAction(title: string, content: string, options?: ConfirmActionOptions): Promise<boolean> {
  const fallbackOkText = translateText(getDocumentLanguage(), '继续');
  const fallbackCancelText = translateText(getDocumentLanguage(), '取消');
  try {
    return await confirmDialog(content, {
      title,
      kind: options?.kind || 'warning',
      okLabel: options?.okText || fallbackOkText,
      cancelLabel: options?.cancelText || fallbackCancelText,
    });
  } catch {
    return new Promise((resolve) => {
      Modal.confirm({
        title,
        content,
        okText: options?.okText || fallbackOkText,
        cancelText: options?.cancelText || fallbackCancelText,
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }
}

function cardText(card: AIResultCard): string {
  return card.diff?.newText || card.markdown || card.content || '';
}

function resultCardsWithAppliedChange(message: AIMessage, appliedCard: AIResultCard): AIResultCard[] {
  return (message.resultCards || []).map((card) => (
    card.id === appliedCard.id
      ? { ...card, actions: card.actions.filter((item) => item.type !== 'replace_selection') }
      : card
  ));
}

function modelLabel(modelName: string | undefined, providerName: string | undefined, language: unknown): string {
  if (modelName && providerName) return `${providerName} / ${modelName}`;
  if (modelName) return modelName;
  return translateText(language, '本地草稿模式');
}

function getErrorMessage(error: unknown, language: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message || '').trim();
    if (message) return message;
  }
  return translateText(language, 'AI 请求失败');
}

function fileNameFromPath(path: string, language: unknown): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || translateText(language, '未命名.pdf');
}

const EMPTY_MESSAGES: AIMessage[] = [];
const CHAT_SCROLL_BOTTOM_THRESHOLD = 72;

interface BlockAIEventDetail {
  prompt: string;
  commandId?: string;
  resultMode?: AICommandPreset['resultMode'];
  selection?: EditorSelection | null;
}

interface ImportedMarkdown {
  path: string;
  fileName: string;
  content: string;
}

function isNearScrollBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_SCROLL_BOTTOM_THRESHOLD;
}

function scrollChatToBottom(element: HTMLElement): void {
  element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
}

export function AIChatPanel({
  documentId,
  documentPath,
  documentTitle,
  editorBridge,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  onOpenSettings,
  onOpenAgentManager,
  onCreateMarkdownFile,
  onClose,
}: AIChatPanelProps) {
  const { state: appState } = useApp();
  const providers = useAiStore((state) => state.providers);
  const models = useAiStore((state) => state.models);
  const customAgents = useAiStore((state) => state.agents);
  const language = useSettingsStore(s => s.general.language);
  const t = useCallback((value: string, params?: Record<string, string | number>) => (
    translateText(language, value, params)
  ), [language]);

  const conversations = useAIChatStore((state) => state.conversations);
  const loaded = useAIChatStore((state) => state.loaded);
  const load = useAIChatStore((state) => state.load);
  const getOrCreateConversation = useAIChatStore((state) => state.getOrCreateConversation);
  const setConversationAgent = useAIChatStore((state) => state.setConversationAgent);
  const addMessage = useAIChatStore((state) => state.addMessage);
  const updateMessage = useAIChatStore((state) => state.updateMessage);
  const clearConversation = useAIChatStore((state) => state.clearConversation);
  const appendRequestLog = useAIChatStore((state) => state.appendRequestLog);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [deepThinkingEnabled, setDeepThinkingEnabled] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [contextMode, setContextMode] = useState<AIContextMode>('auto');
  const [pendingImportFile, setPendingImportFile] = useState<{ path: string; name: string } | null>(null);
  const [convertingImport, setConvertingImport] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const previousMessageCountRef = useRef(0);
  const previousConversationIdRef = useRef<string | null>(null);
  const shouldFollowResponseRef = useRef(true);
  const suppressSelectionUntilRef = useRef(0);
  const activeRequestRef = useRef<{
    abort: () => void;
    conversationId: string;
    assistantMessageId: string;
  } | null>(null);

  const collapsed = controlledCollapsed ?? internalCollapsed;
  const setCollapsed = useCallback((nextCollapsed: boolean) => {
    if (onCollapsedChange) {
      onCollapsedChange(nextCollapsed);
      return;
    }
    setInternalCollapsed(nextCollapsed);
  }, [onCollapsedChange]);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const conversation = getOrCreateConversation({ documentId, documentPath, documentTitle });
    setConversationId(conversation.id);
  }, [documentId, documentPath, documentTitle, getOrCreateConversation, loaded]);

  useEffect(() => {
    if (appState.viewMode === 'block' || appState.viewMode === 'preview') {
      setSelection(null);
      return undefined;
    }
    return subscribeEditorSelection((nextSelection) => {
      if (Date.now() < suppressSelectionUntilRef.current) {
        setSelection(null);
        return;
      }
      setSelection(nextSelection);
    });
  }, [appState.viewMode]);

  const conversation = useMemo(
    () => conversations.find((item) => item.id === conversationId) || null,
    [conversationId, conversations],
  );
  const messages = conversation?.messages ?? EMPTY_MESSAGES;

  const agents = useMemo(() => normalizeAIAgents(customAgents).map(agent => ({
    ...agent,
    name: translateText(language, agent.name),
    description: agent.description ? translateText(language, agent.description) : agent.description,
    systemPrompt: translateText(language, agent.systemPrompt),
  })), [customAgents, language]);
  const allCommands = useMemo(() => getAllAICommands().map(command => ({
    ...command,
    name: translateText(language, command.name),
    description: command.description ? translateText(language, command.description) : command.description,
    userPromptTemplate: translateText(language, command.userPromptTemplate),
  })), [language]);
  const currentAgent = useMemo(
    () => findUsableAgent(agents, conversation?.currentAgentId),
    [agents, conversation?.currentAgentId],
  );
  const commands = useMemo(() => getAgentCommands(currentAgent, allCommands), [allCommands, currentAgent]);
  const model = useMemo(() => (
    models.find((item) => item.enabled && item.id === (conversation?.modelConfigId || currentAgent.modelConfigId)) ||
    models.find((item) => item.enabled)
  ), [conversation?.modelConfigId, currentAgent.modelConfigId, models]);
  const provider = useMemo(
    () => providers.find((item) => item.enabled && item.id === model?.providerId),
    [model?.providerId, providers],
  );
  const thinkingAvailable = Boolean(model?.thinkingSupported);
  const thinkingBudget = thinkingAvailable ? model?.thinkingBudget : undefined;
  const pendingAttachment = useMemo<AIInputAttachment | null>(() => {
    if (!pendingImportFile) return null;
    return {
      name: pendingImportFile.name,
      description: t('PDF · 文字版提取 · 本地处理'),
    };
  }, [pendingImportFile, t]);

  const resolveInputStrategy = useCallback((
    command: AICommandPreset | undefined,
    hasSelection: boolean,
    explicitStrategy?: AIContextStrategy,
  ): AIContextStrategy => {
    if (explicitStrategy) return explicitStrategy;
    if (contextMode === 'selection') return 'selection_with_cursor';
    if (contextMode === 'document') return 'current_document';
    return command?.contextStrategy || (hasSelection ? 'selection_with_cursor' : 'current_document');
  }, [contextMode]);

  const getContextPreview = useCallback((
    inputValue: string,
    highlightedCommandId: string | null,
  ): AIInputContextPreview => {
    const command = highlightedCommandId ? findCommand(highlightedCommandId, allCommands) : undefined;
    const selectionSnapshot = selection?.text.trim() ? selection : editorBridge.getSelection();
    const selectedLength = selectionSnapshot?.text.trim()
      ? Array.from(selectionSnapshot.text.trim()).length
      : 0;
    const documentLength = Array.from(editorBridge.getDocumentContent()).length;
    const hasSelection = selectedLength > 0;
    const strategy = resolveInputStrategy(command, hasSelection);
    const labels: string[] = [];

    if (inputValue.trim()) labels.push(t('手动输入'));
    if (strategy === 'selection_only' || strategy === 'selection_with_cursor') {
      if (hasSelection) labels.push(`${t('选中文本')} ${t('{count} 字', { count: selectedLength })}`);
      if (strategy === 'selection_with_cursor') labels.push(t('光标附近'));
    }
    if (strategy === 'current_document' || strategy === 'document_summary') {
      labels.push(`${t('当前文档')} ${t('{count} 字', { count: documentLength })}`);
    }

    return {
      labels,
      hasSelection,
      warning: (strategy === 'selection_only' || strategy === 'selection_with_cursor') && !hasSelection
        ? t('需要先选中文本')
        : undefined,
    };
  }, [allCommands, editorBridge, resolveInputStrategy, selection, t]);

  const flashEditorRange = useCallback((range: ReturnType<EditorBridge['insertAtCursor']>) => {
    if (!range) return;
    suppressSelectionUntilRef.current = Date.now() + 1400;
    setSelection(null);
    editorBridge.flashRange(range);
  }, [editorBridge]);

  const focusAIInput = useCallback(() => {
    window.setTimeout(() => {
      const input = document.querySelector<HTMLTextAreaElement>('.ai-input-box textarea');
      input?.focus();
    });
  }, []);

  useEffect(() => {
    setDeepThinkingEnabled(Boolean(model?.thinkingSupported && model.thinkingEnabled));
  }, [model?.id, model?.thinkingEnabled, model?.thinkingSupported]);

  useEffect(() => {
    if (!conversation || conversation.currentAgentId === currentAgent.id) return;
    setConversationAgent(conversation.id, currentAgent.id);
  }, [conversation, currentAgent.id, setConversationAgent]);

  const latestContext = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].contextSnapshot) return messages[index].contextSnapshot;
    }
    return undefined;
  }, [messages]);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;

    const currentConversationId = conversation?.id ?? null;
    const messageCount = messages.length;
    const conversationChanged = previousConversationIdRef.current !== currentConversationId;
    const hasNewMessage = messageCount > previousMessageCountRef.current;

    previousConversationIdRef.current = currentConversationId;
    previousMessageCountRef.current = messageCount;

    if (conversationChanged || hasNewMessage) {
      shouldFollowResponseRef.current = true;
      requestAnimationFrame(() => {
        if (chatScrollRef.current === container) scrollChatToBottom(container);
      });
      return;
    }

    if (messageCount > 0 && shouldFollowResponseRef.current) {
      requestAnimationFrame(() => {
        if (chatScrollRef.current === container && shouldFollowResponseRef.current) {
          scrollChatToBottom(container);
        }
      });
    }
  }, [conversation?.id, messages]);

  const handleChatScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    shouldFollowResponseRef.current = isNearScrollBottom(event.currentTarget);
  }, []);

  const sendWithContext = useCallback(async (
    userInput: string,
    command: AICommandPreset | undefined,
    context: AIContextSnapshot,
    resultMode: AICommandPreset['resultMode'],
    thinking: { enabled: boolean; budget?: number },
  ) => {
    if (!conversation) return;

    const now = nowIso();
    const userMessage: AIMessage = {
      id: createAIId('msg'),
      conversationId: conversation.id,
      role: 'user',
      content: command?.name || userInput,
      agentId: currentAgent.id,
      agentName: currentAgent.name,
      modelConfigId: model?.id,
      deepThinkingEnabled: thinking.enabled,
      thinkingBudget: thinking.budget,
      commandId: command?.id,
      contextSnapshotId: context.id,
      contextSnapshot: context,
      status: 'success',
      createdAt: now,
      updatedAt: now,
    };
    const assistantMessage: AIMessage = {
      id: createAIId('msg'),
      conversationId: conversation.id,
      role: 'assistant',
      content: thinking.enabled ? t('正在深度思考...') : t('正在生成...'),
      agentId: currentAgent.id,
      agentName: currentAgent.name,
      modelConfigId: model?.id,
      deepThinkingEnabled: thinking.enabled,
      thinkingBudget: thinking.budget,
      commandId: command?.id,
      contextSnapshotId: context.id,
      contextSnapshot: context,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    const request: AIChatRequest = {
      conversationId: conversation.id,
      agentId: currentAgent.id,
      modelConfigId: model?.id,
      userInput,
      commandId: command?.id,
      deepThinkingEnabled: thinking.enabled,
      thinkingBudget: thinking.budget,
      context,
      resultMode,
    };
    const startedAt = nowIso();

    addMessage(conversation.id, userMessage);
    addMessage(conversation.id, assistantMessage);
    setSending(true);

    const abortController = new AbortController();
    activeRequestRef.current = {
      abort: () => abortController.abort(),
      conversationId: conversation.id,
      assistantMessageId: assistantMessage.id,
    };
    let latestStreamUpdate: AIStreamUpdate | null = null;
    let streamFlushTimer: number | null = null;
    const flushStreamUpdate = () => {
      streamFlushTimer = null;
      if (!latestStreamUpdate) return;
      updateMessage(conversation.id, assistantMessage.id, {
        content: latestStreamUpdate.content || (thinking.enabled ? '' : t('正在生成...')),
        reasoningContent: latestStreamUpdate.reasoningContent,
        status: 'streaming',
      }, { persist: false });
    };

    try {
      const response = await sendAIChatRequest({
        request,
        agent: currentAgent,
        command,
        model,
        provider,
        abortSignal: abortController.signal,
        onStreamUpdate: (update) => {
          if (abortController.signal.aborted) return;
          latestStreamUpdate = update;
          if (streamFlushTimer !== null) return;
          streamFlushTimer = window.setTimeout(flushStreamUpdate, 80);
        },
      });
      if (streamFlushTimer !== null) {
        window.clearTimeout(streamFlushTimer);
        flushStreamUpdate();
      }
      if (abortController.signal.aborted) return;
      updateMessage(conversation.id, assistantMessage.id, {
        content: response.content,
        reasoningContent: response.reasoningContent,
        resultCards: response.resultCards,
        status: 'success',
      });
      appendRequestLog({
        id: createAIId('log'),
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        agentId: currentAgent.id,
        modelConfigId: model?.id,
        provider: response.provider,
        model: response.model,
        commandId: command?.id,
        contextSources: context.includedSources,
        inputLength: userInput.length,
        outputLength: response.content.length,
        deepThinkingEnabled: thinking.enabled,
        thinkingBudget: thinking.budget,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
        status: 'success',
        startedAt,
        endedAt: nowIso(),
      });
    } catch (error) {
      if (streamFlushTimer !== null) {
        window.clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
      if (abortController.signal.aborted || isAIRequestCancelled(error)) {
        updateMessage(conversation.id, assistantMessage.id, {
          status: 'cancelled',
          errorCode: 'cancelled',
          errorMessage: t('已取消生成'),
          resultCards: undefined,
        });
        appendRequestLog({
          id: createAIId('log'),
          conversationId: conversation.id,
          messageId: assistantMessage.id,
          agentId: currentAgent.id,
          modelConfigId: model?.id,
          provider: provider?.name,
          model: model?.model,
          commandId: command?.id,
          contextSources: context.includedSources,
          inputLength: userInput.length,
          deepThinkingEnabled: thinking.enabled,
          thinkingBudget: thinking.budget,
          status: 'cancelled',
          errorCode: 'cancelled',
          errorMessage: t('已取消生成'),
          startedAt,
          endedAt: nowIso(),
        });
        return;
      }
      const errorMessage = getErrorMessage(error, language);
      updateMessage(conversation.id, assistantMessage.id, {
        content: '',
        status: 'failed',
        errorCode: 'request_failed',
        errorMessage,
        resultCards: [
          {
            id: createAIId('card'),
            type: 'error',
            title: t('请求失败'),
            content: errorMessage,
            actions: [
              { type: 'regenerate', label: t('重新生成'), primary: true },
              { type: 'edit_retry', label: t('编辑后重试') },
              { type: 'open_settings', label: t('打开模型设置') },
              { type: 'copy', label: t('复制错误信息') },
            ],
          },
        ],
      });
      appendRequestLog({
        id: createAIId('log'),
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        agentId: currentAgent.id,
        modelConfigId: model?.id,
        provider: provider?.name,
        model: model?.model,
        commandId: command?.id,
        contextSources: context.includedSources,
        inputLength: userInput.length,
        deepThinkingEnabled: thinking.enabled,
        thinkingBudget: thinking.budget,
        status: 'failed',
        errorCode: 'request_failed',
        errorMessage,
        startedAt,
        endedAt: nowIso(),
      });
    } finally {
      if (streamFlushTimer !== null) {
        window.clearTimeout(streamFlushTimer);
      }
      if (activeRequestRef.current?.assistantMessageId === assistantMessage.id) {
        activeRequestRef.current = null;
        setSending(false);
      }
    }
  }, [addMessage, appendRequestLog, conversation, currentAgent, language, model, provider, t, updateMessage]);

  const cancelCurrentRequest = useCallback(() => {
    const activeRequest = activeRequestRef.current;
    if (!activeRequest) return;
    activeRequest.abort();
    updateMessage(activeRequest.conversationId, activeRequest.assistantMessageId, {
      status: 'cancelled',
      errorCode: 'cancelled',
      errorMessage: t('已取消生成'),
      resultCards: undefined,
    });
    activeRequestRef.current = null;
    setSending(false);
  }, [t, updateMessage]);

  const sendMessage = useCallback(async (
    userInput: string,
    commandId?: string,
    override?: {
      strategy?: AIContextStrategy;
      resultMode?: AICommandPreset['resultMode'];
      selection?: EditorSelection | null;
      deepThinkingEnabled?: boolean;
    },
  ) => {
    if (!conversation) return;
    const command = commandId ? findCommand(commandId, allCommands) : undefined;
    const selectionSnapshot = override?.selection ?? editorBridge.getSelection();
    const hasSelection = Boolean(selectionSnapshot?.text.trim());
    const strategy = resolveInputStrategy(command, hasSelection, override?.strategy);
    const resultMode = override?.resultMode || command?.resultMode || 'markdown';
    const effectiveThinkingEnabled = Boolean(
      model?.thinkingSupported && (override?.deepThinkingEnabled ?? deepThinkingEnabled),
    );
    const effectiveThinkingBudget = effectiveThinkingEnabled ? model?.thinkingBudget : undefined;
    const context = await buildAIContext({
      strategy,
      editor: editorBridge,
      selection: selectionSnapshot,
      documentId,
      documentPath,
      documentTitle,
      manualInput: userInput,
    });

    if ((strategy === 'selection_only' || strategy === 'selection_with_cursor') && !context.selectedText) {
      message.warning(t('请先选中要处理的文本'));
      return;
    }

    await sendWithContext(userInput, command, context, resultMode, {
      enabled: effectiveThinkingEnabled,
      budget: effectiveThinkingBudget,
    });
  }, [
    allCommands,
    conversation,
    deepThinkingEnabled,
    documentId,
    documentPath,
    documentTitle,
    editorBridge,
    model?.thinkingBudget,
    model?.thinkingSupported,
    resolveInputStrategy,
    sendWithContext,
    t,
  ]);

  useEffect(() => {
    const handleBlockAI = (event: Event) => {
      const detail = (event as CustomEvent<BlockAIEventDetail>).detail;
      if (!detail?.prompt) return;
      if (detail.selection?.range) {
        editorBridge.restoreSelection(detail.selection.range);
      }
      setCollapsed(false);
      setSelection(null);
      void sendMessage(detail.prompt, detail.commandId, {
        strategy: detail.selection?.text.trim() ? 'selection_with_cursor' : 'current_document',
        resultMode: detail.resultMode,
        selection: detail.selection,
      });
    };

    window.addEventListener('orcha-block-ai', handleBlockAI);
    return () => window.removeEventListener('orcha-block-ai', handleBlockAI);
  }, [editorBridge, sendMessage]);

  const regenerateFrom = useCallback((assistantMessage: AIMessage) => {
    if (!conversation) return;
    const index = conversation.messages.findIndex((item) => item.id === assistantMessage.id);
    const previousUserMessage = conversation.messages
      .slice(0, index)
      .reverse()
      .find((item) => item.role === 'user');
    if (!previousUserMessage) {
      message.warning(t('没有可重新生成的上一条请求'));
      return;
    }
    void sendMessage(previousUserMessage.content, previousUserMessage.commandId);
  }, [conversation, sendMessage, t]);

  const editRetryFrom = useCallback((assistantMessage: AIMessage) => {
    if (!conversation) return;
    const index = conversation.messages.findIndex((item) => item.id === assistantMessage.id);
    const previousUserMessage = conversation.messages
      .slice(0, index)
      .reverse()
      .find((item) => item.role === 'user');
    if (!previousUserMessage) {
      message.warning(t('没有可重新生成的上一条请求'));
      return;
    }

    setDraftValue(previousUserMessage.content);
    setCollapsed(false);
    focusAIInput();
    message.info(t('已放回输入框，可修改后重试'));
  }, [conversation, focusAIInput, t]);

  const handleRunCommand = useCallback((commandId: string) => {
    const command = findCommand(commandId, allCommands);
    const selectionSnapshot = selection?.text.trim() ? selection : editorBridge.getSelection();
    if (selectionSnapshot?.range && command?.contextStrategy !== 'current_document') {
      editorBridge.restoreSelection(selectionSnapshot.range);
    }
    setSelection(null);
    void sendMessage(command?.userPromptTemplate || command?.name || '', commandId, {
      selection: selectionSnapshot,
    });
  }, [allCommands, editorBridge, selection, sendMessage]);

  const handleRunSelectionCommand = useCallback((commandId: string) => {
    const command = findCommand(commandId, allCommands);
    const selectionSnapshot = selection?.text.trim() ? selection : editorBridge.getSelection();
    if (selectionSnapshot?.range) {
      editorBridge.restoreSelection(selectionSnapshot.range);
    }
    setSelection(null);
    void sendMessage(command?.userPromptTemplate || command?.name || '', commandId, {
      strategy: command?.contextStrategy || 'selection_with_cursor',
      selection: selectionSnapshot,
    });
  }, [allCommands, editorBridge, selection, sendMessage]);

  const handleAttachFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        title: t('上传文件转 Markdown'),
        filters: [{ name: t('文字版 PDF'), extensions: ['pdf'] }],
      });
      if (!selected) return;
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;
      setPendingImportFile({ path, name: fileNameFromPath(path, language) });
      message.success(t('已添加 PDF'));
    } catch (error) {
      console.error('Failed to attach import file:', error);
      message.error(t('选择文件失败'));
    }
  }, [language, t]);

  const handleConvertAttachment = useCallback(async () => {
    if (!conversation || !pendingImportFile || convertingImport) return;
    const confirmed = await confirmAction(
      t('转换为 Markdown？'),
      t('将从 PDF 文本层提取内容，不会上传到云端。扫描件或图片型 PDF 暂时无法识别。'),
      { okText: t('开始转换'), cancelText: t('取消') },
    );
    if (!confirmed) return;

    const now = nowIso();
    const userMessage: AIMessage = {
      id: createAIId('msg'),
      conversationId: conversation.id,
      role: 'user',
      content: t('转换 PDF：{name}', { name: pendingImportFile.name }),
      status: 'success',
      createdAt: now,
      updatedAt: now,
    };
    const assistantMessage: AIMessage = {
      id: createAIId('msg'),
      conversationId: conversation.id,
      role: 'assistant',
      content: t('正在从 {name} 提取 PDF 文本...', { name: pendingImportFile.name }),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    addMessage(conversation.id, userMessage);
    addMessage(conversation.id, assistantMessage);
    setConvertingImport(true);

    try {
      const result = await invoke<ImportedMarkdown>('import_pdf_text_as_markdown', { path: pendingImportFile.path });
      updateMessage(conversation.id, assistantMessage.id, {
        content: t('已从 {name} 提取 Markdown', { name: pendingImportFile.name }),
        status: 'success',
        resultCards: [
          {
            id: createAIId('card'),
            type: 'markdown_result',
            title: result.fileName,
            markdown: result.content,
            actions: [
              { type: 'create_markdown_file', label: t('新建文档'), primary: true },
              { type: 'insert_at_cursor', label: t('插入光标处') },
              { type: 'copy', label: t('复制') },
            ],
          },
        ],
      });
      setPendingImportFile(null);
    } catch (error) {
      const errorMessage = getErrorMessage(error, language);
      updateMessage(conversation.id, assistantMessage.id, {
        content: '',
        status: 'failed',
        errorCode: 'pdf_import_failed',
        errorMessage,
        resultCards: [
          {
            id: createAIId('card'),
            type: 'error',
            title: t('PDF 转换失败'),
            content: errorMessage,
            actions: [{ type: 'copy', label: t('复制错误信息') }],
          },
        ],
      });
    } finally {
      setConvertingImport(false);
    }
  }, [addMessage, conversation, convertingImport, language, pendingImportFile, t, updateMessage]);

  const handleClearConversation = useCallback(async () => {
    if (!conversation || messages.length === 0) return;
    const confirmed = await confirmAction(
      t('清空当前 AI 对话？'),
      t('将清空当前文档的 AI 对话记录，不会影响正文。'),
      { okText: t('清空'), cancelText: t('取消'), kind: 'warning' },
    );
    if (!confirmed) return;
    clearConversation(conversation.id);
  }, [clearConversation, conversation, messages.length, t]);

  const handleResultAction = useCallback(async (action: AIResultAction, card: AIResultCard, sourceMessage: AIMessage) => {
    const text = cardText(card);
    if (action.type === 'regenerate') {
      regenerateFrom(sourceMessage);
      return;
    }
    if (action.type === 'edit_retry') {
      editRetryFrom(sourceMessage);
      return;
    }
    if (action.type === 'open_settings') {
      if (onOpenSettings) {
        onOpenSettings();
      } else {
        message.info(t('设置入口不可用'));
      }
      return;
    }

    if (!text.trim()) {
      message.warning(t('结果为空，无法执行操作'));
      return;
    }

    if (action.type === 'copy') {
      await navigator.clipboard.writeText(text);
      message.success(t('已复制'));
      return;
    }

    if (action.type === 'insert_at_cursor') {
      const range = editorBridge.insertAtCursor(text);
      flashEditorRange(range);
      message.success(t('已插入光标处'));
      return;
    }

    if (action.type === 'append_to_document') {
      const range = editorBridge.appendToDocument(text);
      flashEditorRange(range);
      message.success(t('已追加到文末'));
      return;
    }

    if (action.type === 'create_markdown_file') {
      if (onCreateMarkdownFile) {
        await onCreateMarkdownFile(text);
        message.success(t('已新建文档'));
      } else {
        await navigator.clipboard.writeText(text);
        message.success(t('已复制，可新建文档后粘贴'));
      }
      return;
    }

    if (action.type === 'replace_selection') {
      const currentSelection = editorBridge.getSelection();
      const hasCurrentSelection = Boolean(currentSelection?.text.trim());
      const expectedRange = card.diff?.selectionRange;
      let targetRange = hasCurrentSelection ? currentSelection?.range : expectedRange;

      if (!targetRange) {
        message.warning(t('当前没有可替换的选区'));
        return;
      }

      const changedRange = hasCurrentSelection && currentSelection && expectedRange && (
        expectedRange.from !== currentSelection.range.from ||
        expectedRange.to !== currentSelection.range.to
      );
      if (changedRange) {
        const confirmed = await confirmAction(t('选区已变化'), t('当前选区与生成结果时的选区不同，继续会替换现在选中的文本。'), { cancelText: t('取消'), okText: t('继续') });
        if (!confirmed) return;
        targetRange = currentSelection.range;
      }

      if (!hasCurrentSelection && expectedRange) {
        const originalText = card.diff?.originalText || '';
        const currentText = editorBridge.getTextInRange(expectedRange);
        if (originalText && currentText !== originalText) {
          const confirmed = await confirmAction(t('原选区内容已变化'), t('生成结果对应的原文区域已有变化，继续会按原范围替换当前内容。'), { cancelText: t('取消'), okText: t('继续') });
          if (!confirmed) return;
        }
        editorBridge.restoreSelection(expectedRange);
      }

      if (text.length >= DEFAULT_AI_SETTINGS.largeReplaceConfirmThreshold) {
        const confirmed = await confirmAction(t('确认替换大段内容？'), t('即将替换 {count} 个字符，请确认当前选区无误。', { count: text.length }), { cancelText: t('取消'), okText: t('继续') });
        if (!confirmed) return;
      }

      const range = editorBridge.replaceRange(targetRange, text);
      flashEditorRange(range);
      updateMessage(sourceMessage.conversationId, sourceMessage.id, {
        resultCards: resultCardsWithAppliedChange(sourceMessage, card),
      });
      message.success(t('已应用修改'));
    }
  }, [editRetryFrom, editorBridge, flashEditorRange, onCreateMarkdownFile, onOpenSettings, regenerateFrom, t, updateMessage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        focusAIInput();
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'r') {
        const lastAssistant = messages.slice().reverse().find((item) => item.role === 'assistant');
        if (lastAssistant) regenerateFrom(lastAssistant);
      }
      if (event.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusAIInput, messages, regenerateFrom]);

  const selectionLayout = selection?.rect
    ? (() => {
        const width = 280;
        const margin = 14;
        const minTop = 72;
        const estimatedHeight = 150;
        const rectBottom = selection.rect.top + selection.rect.height;
        const spaceAbove = selection.rect.top - minTop;
        const spaceBelow = window.innerHeight - rectBottom - margin;
        const placement = spaceAbove < estimatedHeight && spaceBelow > spaceAbove ? 'below' as const : 'above' as const;
        const x = Math.min(
          window.innerWidth - margin - width / 2,
          Math.max(margin + width / 2, selection.rect.left + selection.rect.width / 2),
        );
        const y = placement === 'below'
          ? Math.min(window.innerHeight - estimatedHeight - margin, rectBottom + 12)
          : Math.max(minTop, selection.rect.top - 12);

        return { position: { x, y }, placement };
      })()
    : { position: { x: window.innerWidth / 2, y: 120 }, placement: 'below' as const };
  const selectionCommands = commands.filter((command) => command.contextStrategy !== 'current_document');

  if (collapsed) {
    return (
      <aside className="ai-chat-panel is-collapsed">
        <Tooltip title={t('展开 AI 写作')} placement="left">
          <Button
            type="text"
            size="small"
            className="ai-panel-expand"
            icon={<PanelRightOpen size={18} />}
            onClick={() => setCollapsed(false)}
          />
        </Tooltip>
        <span className="ai-collapsed-label">AI</span>
      </aside>
    );
  }

  return (
    <aside className="ai-chat-panel">
      <AIChatHeader
        onOpenSettings={onOpenSettings}
        onClear={conversation && messages.length > 0 ? handleClearConversation : undefined}
        onClose={onClose || (() => setCollapsed(true))}
      />
      {!model && (
        <Alert
          className="ai-model-alert"
          type="info"
          showIcon
          message={t('当前使用本地草稿模式')}
          description={t('添加模型配置后，可把请求服务接入真实模型。')}
        />
      )}
      <ContextBox context={latestContext} />
      <div className="ai-chat-scroll" ref={chatScrollRef} onScroll={handleChatScroll}>
        <MessageList messages={messages} onResultAction={handleResultAction} />
      </div>
      <AIInputBox
        sending={sending}
        disabled={!conversation || convertingImport}
        value={draftValue}
        onChangeValue={setDraftValue}
        modelLabel={modelLabel(model?.model, provider?.name, language)}
        agents={agents}
        currentAgent={currentAgent}
        onChangeAgent={(agentId) => conversation && setConversationAgent(conversation.id, agentId)}
        onOpenAgentManager={onOpenAgentManager || onOpenSettings}
        commands={commands}
        onRunCommand={handleRunCommand}
        onAttachFile={handleAttachFile}
        attachment={pendingAttachment}
        onConvertAttachment={handleConvertAttachment}
        onRemoveAttachment={() => setPendingImportFile(null)}
        thinkingAvailable={thinkingAvailable}
        thinkingEnabled={deepThinkingEnabled}
        thinkingBudget={thinkingBudget}
        onChangeThinking={setDeepThinkingEnabled}
        contextMode={contextMode}
        onChangeContextMode={setContextMode}
        getContextPreview={getContextPreview}
        onCancel={cancelCurrentRequest}
        onSend={(value) => void sendMessage(value)}
      />
      <SelectionAIPopover
        visible={Boolean(
          appState.viewMode !== 'block'
          && appState.viewMode !== 'preview'
          && selection?.text.trim()
          && selectionCommands.length > 0,
        )}
        selectionText={selection?.text || ''}
        position={selectionLayout.position}
        placement={selectionLayout.placement}
        commands={selectionCommands}
        onRunCommand={handleRunSelectionCommand}
        onSubmitCustomPrompt={(prompt) => {
          const selectionSnapshot = selection?.text.trim() ? selection : editorBridge.getSelection();
          if (selectionSnapshot?.range) {
            editorBridge.restoreSelection(selectionSnapshot.range);
          }
          setSelection(null);
          void sendMessage(prompt, undefined, {
            strategy: 'selection_with_cursor',
            resultMode: 'markdown',
            selection: selectionSnapshot,
          });
        }}
      />
    </aside>
  );
}
