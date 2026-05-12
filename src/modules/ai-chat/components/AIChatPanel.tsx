import { Alert, Button, message, Modal, Tooltip } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { subscribeEditorSelection } from '../../../components/Editor';
import { useApp } from '../../../AppContext';
import { useAiStore } from '../../../store';
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
import { AIInputBox } from './AIInputBox';
import { ContextBox } from './ContextBox';
import { MessageList } from './MessageList';
import { SelectionAIPopover } from './SelectionAIPopover';
import '../styles.css';

export interface AIChatPanelProps {
  documentId: string;
  documentPath?: string;
  documentTitle?: string;
  editorBridge: EditorBridge;
  onOpenSettings?: () => void;
  onOpenAgentManager?: () => void;
  onCreateMarkdownFile?: (content: string) => Promise<void> | void;
  onClose?: () => void;
}

function confirmAction(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title,
      content,
      okText: '继续',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
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

function modelLabel(modelName?: string, providerName?: string): string {
  if (modelName && providerName) return `${providerName} / ${modelName}`;
  if (modelName) return modelName;
  return '本地草稿模式';
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message || '').trim();
    if (message) return message;
  }
  return 'AI 请求失败';
}

const EMPTY_MESSAGES: AIMessage[] = [];
const CHAT_SCROLL_BOTTOM_THRESHOLD = 72;

interface BlockAIEventDetail {
  prompt: string;
  commandId?: string;
  resultMode?: AICommandPreset['resultMode'];
  selection?: EditorSelection | null;
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
  onOpenSettings,
  onOpenAgentManager,
  onCreateMarkdownFile,
  onClose,
}: AIChatPanelProps) {
  const { state: appState } = useApp();
  const providers = useAiStore((state) => state.providers);
  const models = useAiStore((state) => state.models);
  const customAgents = useAiStore((state) => state.agents);

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
  const [collapsed, setCollapsed] = useState(false);
  const [deepThinkingEnabled, setDeepThinkingEnabled] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const previousMessageCountRef = useRef(0);
  const previousConversationIdRef = useRef<string | null>(null);
  const shouldFollowResponseRef = useRef(true);
  const activeRequestRef = useRef<{
    abort: () => void;
    conversationId: string;
    assistantMessageId: string;
  } | null>(null);

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
    return subscribeEditorSelection(setSelection);
  }, [appState.viewMode]);

  const conversation = useMemo(
    () => conversations.find((item) => item.id === conversationId) || null,
    [conversationId, conversations],
  );
  const messages = conversation?.messages ?? EMPTY_MESSAGES;

  const agents = useMemo(() => normalizeAIAgents(customAgents), [customAgents]);
  const allCommands = useMemo(() => getAllAICommands(), []);
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
      content: thinking.enabled ? '正在深度思考...' : '正在生成...',
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
        content: latestStreamUpdate.content || (thinking.enabled ? '' : '正在生成...'),
        reasoningContent: latestStreamUpdate.reasoningContent,
        status: 'streaming',
      });
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
          errorMessage: '已取消生成',
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
          errorMessage: '已取消生成',
          startedAt,
          endedAt: nowIso(),
        });
        return;
      }
      const errorMessage = getErrorMessage(error);
      updateMessage(conversation.id, assistantMessage.id, {
        content: '',
        status: 'failed',
        errorCode: 'request_failed',
        errorMessage,
        resultCards: [
          {
            id: createAIId('card'),
            type: 'error',
            title: '请求失败',
            content: errorMessage,
            actions: [{ type: 'regenerate', label: '重新生成', primary: true }],
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
  }, [addMessage, appendRequestLog, conversation, currentAgent, model, provider, updateMessage]);

  const cancelCurrentRequest = useCallback(() => {
    const activeRequest = activeRequestRef.current;
    if (!activeRequest) return;
    activeRequest.abort();
    updateMessage(activeRequest.conversationId, activeRequest.assistantMessageId, {
      status: 'cancelled',
      errorCode: 'cancelled',
      errorMessage: '已取消生成',
      resultCards: undefined,
    });
    activeRequestRef.current = null;
    setSending(false);
  }, [updateMessage]);

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
    const strategy = override?.strategy || command?.contextStrategy || (hasSelection ? 'selection_with_cursor' : 'current_document');
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
      message.warning('请先选中要处理的文本');
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
    sendWithContext,
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
      message.warning('没有可重新生成的上一条请求');
      return;
    }
    void sendMessage(previousUserMessage.content, previousUserMessage.commandId, {
      deepThinkingEnabled: previousUserMessage.deepThinkingEnabled,
    });
  }, [conversation, sendMessage]);

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

  const handleResultAction = useCallback(async (action: AIResultAction, card: AIResultCard, sourceMessage: AIMessage) => {
    const text = cardText(card);
    if (action.type === 'regenerate') {
      regenerateFrom(sourceMessage);
      return;
    }

    if (!text.trim()) {
      message.warning('结果为空，无法执行操作');
      return;
    }

    if (action.type === 'copy') {
      await navigator.clipboard.writeText(text);
      message.success('已复制');
      return;
    }

    if (action.type === 'insert_at_cursor') {
      editorBridge.insertAtCursor(text);
      message.success('已插入光标处');
      return;
    }

    if (action.type === 'append_to_document') {
      editorBridge.appendToDocument(text);
      message.success('已追加到文末');
      return;
    }

    if (action.type === 'create_markdown_file') {
      if (onCreateMarkdownFile) {
        await onCreateMarkdownFile(text);
        message.success('已新建文档');
      } else {
        await navigator.clipboard.writeText(text);
        message.success('已复制，可新建文档后粘贴');
      }
      return;
    }

    if (action.type === 'replace_selection') {
      const currentSelection = editorBridge.getSelection();
      const hasCurrentSelection = Boolean(currentSelection?.text.trim());
      const expectedRange = card.diff?.selectionRange;
      let targetRange = hasCurrentSelection ? currentSelection?.range : expectedRange;

      if (!targetRange) {
        message.warning('当前没有可替换的选区');
        return;
      }

      const changedRange = hasCurrentSelection && currentSelection && expectedRange && (
        expectedRange.from !== currentSelection.range.from ||
        expectedRange.to !== currentSelection.range.to
      );
      if (changedRange) {
        const confirmed = await confirmAction('选区已变化', '当前选区与生成结果时的选区不同，继续会替换现在选中的文本。');
        if (!confirmed) return;
        targetRange = currentSelection.range;
      }

      if (!hasCurrentSelection && expectedRange) {
        const originalText = card.diff?.originalText || '';
        const currentText = editorBridge.getTextInRange(expectedRange);
        if (originalText && currentText !== originalText) {
          const confirmed = await confirmAction('原选区内容已变化', '生成结果对应的原文区域已有变化，继续会按原范围替换当前内容。');
          if (!confirmed) return;
        }
        editorBridge.restoreSelection(expectedRange);
      }

      if (text.length >= DEFAULT_AI_SETTINGS.largeReplaceConfirmThreshold) {
        const confirmed = await confirmAction('确认替换大段内容？', `即将替换 ${text.length} 个字符，请确认当前选区无误。`);
        if (!confirmed) return;
      }

      editorBridge.replaceRange(targetRange, text);
      updateMessage(sourceMessage.conversationId, sourceMessage.id, {
        resultCards: resultCardsWithAppliedChange(sourceMessage, card),
      });
      message.success('已应用修改');
    }
  }, [editorBridge, onCreateMarkdownFile, regenerateFrom, updateMessage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        const input = document.querySelector<HTMLTextAreaElement>('.ai-input-box textarea');
        input?.focus();
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'r') {
        const lastAssistant = messages.slice().reverse().find((item) => item.role === 'assistant');
        if (lastAssistant) regenerateFrom(lastAssistant);
      }
      if (event.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [messages, regenerateFrom]);

  const selectionPosition = selection?.rect
    ? {
        x: Math.min(window.innerWidth - 180, Math.max(180, selection.rect.left + selection.rect.width / 2)),
        y: Math.max(72, selection.rect.top - 12),
      }
    : { x: window.innerWidth / 2, y: 120 };
  const selectionCommands = commands.filter((command) => command.contextStrategy !== 'current_document');

  if (collapsed) {
    return (
      <aside className="ai-chat-panel is-collapsed">
        <Tooltip title="展开 AI 写作" placement="left">
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
        onClear={conversation ? () => clearConversation(conversation.id) : undefined}
        onClose={onClose || (() => setCollapsed(true))}
      />
      {!model && (
        <Alert
          className="ai-model-alert"
          type="info"
          showIcon
          message="当前使用本地草稿模式"
          description="添加模型配置后，可把请求服务接入真实模型。"
        />
      )}
      <ContextBox context={latestContext} />
      <div className="ai-chat-scroll" ref={chatScrollRef} onScroll={handleChatScroll}>
        <MessageList messages={messages} onResultAction={handleResultAction} />
      </div>
      <AIInputBox
        sending={sending}
        disabled={!conversation}
        modelLabel={modelLabel(model?.model, provider?.name)}
        agents={agents}
        currentAgent={currentAgent}
        onChangeAgent={(agentId) => conversation && setConversationAgent(conversation.id, agentId)}
        onOpenAgentManager={onOpenAgentManager || onOpenSettings}
        commands={commands}
        onRunCommand={handleRunCommand}
        thinkingAvailable={thinkingAvailable}
        thinkingEnabled={deepThinkingEnabled}
        thinkingBudget={thinkingBudget}
        onChangeThinking={setDeepThinkingEnabled}
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
        position={selectionPosition}
        commands={selectionCommands}
        onRunCommand={handleRunCommand}
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
