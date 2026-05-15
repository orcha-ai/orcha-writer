import { create } from 'zustand';
import { readConfig, writeConfig } from '../../../config';
import { DEFAULT_AGENT_ID } from '../constants/builtinAgents';
import { createAIId, nowIso } from '../services/id';
import type { AIConversation, AIMessage, AIRequestLog } from '../types';
import { getDocumentLanguage, translateText } from '../../../i18n';

interface ConversationTarget {
  documentId?: string;
  documentPath?: string;
  documentTitle?: string;
}

interface AIChatState {
  conversations: AIConversation[];
  requestLogs: AIRequestLog[];
  activeConversationId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  save: () => Promise<void>;
  getOrCreateConversation: (target: ConversationTarget) => AIConversation;
  setConversationAgent: (conversationId: string, agentId: string) => void;
  addMessage: (conversationId: string, message: AIMessage) => void;
  updateMessage: (conversationId: string, messageId: string, partial: Partial<AIMessage>, options?: { persist?: boolean }) => void;
  clearConversation: (conversationId: string) => void;
  appendRequestLog: (log: AIRequestLog) => void;
}

const CONVERSATIONS_CONFIG_KEY = 'ai-chat-conversations';
const REQUEST_LOGS_CONFIG_KEY = 'ai-request-logs';

function createConversation(target: ConversationTarget): AIConversation {
  const now = nowIso();
  return {
    id: createAIId('conv'),
    title: target.documentTitle || translateText(getDocumentLanguage(), 'AI 对话'),
    documentId: target.documentId,
    documentPath: target.documentPath,
    currentAgentId: DEFAULT_AGENT_ID,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export const useAIChatStore = create<AIChatState>((set, get) => ({
  conversations: [],
  requestLogs: [],
  activeConversationId: null,
  loaded: false,

  load: async () => {
    const conversations = await readConfig<AIConversation[]>(CONVERSATIONS_CONFIG_KEY, []);
    const requestLogs = await readConfig<AIRequestLog[]>(REQUEST_LOGS_CONFIG_KEY, []);
    set({ conversations, requestLogs, loaded: true });
  },

  save: async () => {
    const state = get();
    await writeConfig(CONVERSATIONS_CONFIG_KEY, state.conversations);
    await writeConfig(REQUEST_LOGS_CONFIG_KEY, state.requestLogs.slice(-500));
  },

  getOrCreateConversation: (target) => {
    const existing = get().conversations.find((conversation) => (
      target.documentId
        ? conversation.documentId === target.documentId
        : conversation.documentPath === target.documentPath
    ));

    if (existing) {
      if (get().activeConversationId !== existing.id) {
        set({ activeConversationId: existing.id });
      }
      return existing;
    }

    const conversation = createConversation(target);
    set((state) => ({
      conversations: [...state.conversations, conversation],
      activeConversationId: conversation.id,
    }));
    void get().save();
    return conversation;
  },

  setConversationAgent: (conversationId, agentId) => {
    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId
          ? { ...conversation, currentAgentId: agentId, updatedAt: nowIso() }
          : conversation
      )),
    }));
    void get().save();
  },

  addMessage: (conversationId, message) => {
    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId
          ? { ...conversation, messages: [...conversation.messages, message], updatedAt: nowIso() }
          : conversation
      )),
    }));
    void get().save();
  },

  updateMessage: (conversationId, messageId, partial, options) => {
    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message) => (
                message.id === messageId
                  ? { ...message, ...partial, updatedAt: nowIso() }
                  : message
              )),
              updatedAt: nowIso(),
            }
          : conversation
      )),
    }));
    if (options?.persist !== false) {
      void get().save();
    }
  },

  clearConversation: (conversationId) => {
    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId
          ? { ...conversation, messages: [], updatedAt: nowIso() }
          : conversation
      )),
    }));
    void get().save();
  },

  appendRequestLog: (log) => {
    set((state) => ({
      requestLogs: [...state.requestLogs, log].slice(-500),
    }));
    void get().save();
  },
}));
