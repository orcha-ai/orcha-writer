import type { EditorBridge, EditorRange, EditorSelection } from './editor-bridge';

export type { EditorBridge, EditorRange, EditorSelection, CursorAroundOptions, CursorAroundText } from './editor-bridge';

export type AIContextSource =
  | 'selected_text'
  | 'cursor_around'
  | 'current_document'
  | 'document_meta'
  | 'manual_input';

export type AIContextStrategy =
  | 'selection_only'
  | 'selection_with_cursor'
  | 'current_document'
  | 'document_summary'
  | 'manual_only';

export interface AIAgentConfig {
  id: string;
  code: string;
  name: string;
  description?: string;
  iconText?: string;
  enabled: boolean;
  builtin: boolean;
  sortOrder: number;
  modelConfigId?: string;
  systemPrompt: string;
  commandIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AICommandPreset {
  id: string;
  code: string;
  name: string;
  description?: string;
  iconText?: string;
  agentIds: string[];
  userPromptTemplate: string;
  resultMode: 'markdown' | 'plain_text' | 'diff' | 'table' | 'todo';
  contextStrategy: AIContextStrategy;
  enabled: boolean;
  sortOrder: number;
}

export interface AIContextSnapshot {
  id: string;
  documentId: string;
  documentPath?: string;
  documentTitle?: string;
  selectedText?: string;
  selectedTextLength?: number;
  selectionRange?: EditorRange;
  cursorBeforeText?: string;
  cursorAfterText?: string;
  documentContent?: string;
  documentContentLength?: number;
  includedSources: AIContextSource[];
  createdAt: string;
}

export interface BuildAIContextOptions {
  strategy: AIContextStrategy;
  editor: EditorBridge;
  selection?: EditorSelection | null;
  documentId: string;
  documentPath?: string;
  documentTitle?: string;
  manualInput?: string;
}

export interface AIConversation {
  id: string;
  title: string;
  documentId?: string;
  documentPath?: string;
  currentAgentId: string;
  modelConfigId?: string;
  messages: AIMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface AIMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string;
  agentName?: string;
  modelConfigId?: string;
  deepThinkingEnabled?: boolean;
  thinkingBudget?: number;
  reasoningContent?: string;
  commandId?: string;
  contextSnapshotId?: string;
  contextSnapshot?: AIContextSnapshot;
  resultCards?: AIResultCard[];
  status: 'pending' | 'streaming' | 'success' | 'failed' | 'cancelled';
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIResultCard {
  id: string;
  type: 'markdown_result' | 'diff_result' | 'action_confirm' | 'error';
  title: string;
  content?: string;
  markdown?: string;
  diff?: AIDiffPayload;
  actions: AIResultAction[];
}

export interface AIResultAction {
  type:
    | 'insert_at_cursor'
    | 'replace_selection'
    | 'append_to_document'
    | 'create_markdown_file'
    | 'copy'
    | 'regenerate'
    | 'cancel';
  label: string;
  primary?: boolean;
}

export interface AIDiffPayload {
  originalText: string;
  newText: string;
  selectionRange?: EditorRange;
  applyMode: 'replace_selection' | 'replace_range';
}

export interface AIChatRequest {
  conversationId: string;
  agentId: string;
  modelConfigId?: string;
  userInput: string;
  commandId?: string;
  deepThinkingEnabled?: boolean;
  thinkingBudget?: number;
  context: AIContextSnapshot;
  resultMode: AICommandPreset['resultMode'];
}

export interface AIChatResponse {
  messageId: string;
  content: string;
  reasoningContent?: string;
  resultCards: AIResultCard[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  model?: string;
  provider?: string;
}

export interface AIError {
  code: string;
  message: string;
  retryable: boolean;
  actionText?: string;
}

export interface AIRequestLog {
  id: string;
  conversationId: string;
  messageId: string;
  agentId: string;
  modelConfigId?: string;
  provider?: string;
  model?: string;
  commandId?: string;
  contextSources: AIContextSource[];
  inputLength: number;
  outputLength?: number;
  deepThinkingEnabled?: boolean;
  thinkingBudget?: number;
  inputTokens?: number;
  outputTokens?: number;
  status: 'success' | 'failed' | 'cancelled';
  errorCode?: string;
  errorMessage?: string;
  startedAt: string;
  endedAt?: string;
}

export interface AISettings {
  enabled: boolean;
  defaultAgentId: string;
  defaultModelConfigId?: string;
  showContextBeforeSend: boolean;
  largeReplaceConfirmThreshold: number;
  saveConversationHistory: boolean;
  saveRequestLog: boolean;
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: true,
  defaultAgentId: 'writing_assistant',
  showContextBeforeSend: false,
  largeReplaceConfirmThreshold: 1000,
  saveConversationHistory: true,
  saveRequestLog: true,
};
