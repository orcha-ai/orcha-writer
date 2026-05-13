import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AiModelConfig, AiProviderConfig } from '../../../types';
import { getDocumentLanguage, translateText } from '../../../i18n';
import { buildPrompt } from './aiPromptBuilder';
import { createAIId } from './id';
import type {
  AIAgentConfig,
  AIChatRequest,
  AIChatResponse,
  AICommandPreset,
  AIResultAction,
  AIResultCard,
} from '../types';

export interface SendAIChatOptions {
  request: AIChatRequest;
  agent: AIAgentConfig;
  command?: AICommandPreset;
  model?: AiModelConfig;
  provider?: AiProviderConfig;
  onStreamUpdate?: (update: AIStreamUpdate) => void;
  abortSignal?: AbortSignal;
}

interface NativeAIChatResponse {
  content: string;
  reasoningContent?: string;
  model?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

interface NativeAIChatStreamEvent {
  streamId: string;
  contentDelta?: string;
  reasoningDelta?: string;
}

export interface AIStreamUpdate {
  content: string;
  reasoningContent?: string;
  contentDelta?: string;
  reasoningDelta?: string;
}

export const AI_REQUEST_CANCELLED_MESSAGE = 'AI 请求已取消';

export function isAIRequestCancelled(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  const message = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : '';
  return message.includes(AI_REQUEST_CANCELLED_MESSAGE);
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error(AI_REQUEST_CANCELLED_MESSAGE);
  }
}

function commonResultActions(language: unknown): AIResultAction[] {
  return [
    { type: 'insert_at_cursor', label: translateText(language, '插入光标处'), primary: true },
    { type: 'create_markdown_file', label: translateText(language, '新建文档') },
    { type: 'copy', label: translateText(language, '复制') },
    { type: 'regenerate', label: translateText(language, '重新生成') },
  ];
}

function diffResultActions(language: unknown): AIResultAction[] {
  return [
    { type: 'replace_selection', label: translateText(language, '应用修改'), primary: true },
    { type: 'copy', label: translateText(language, '复制') },
    { type: 'regenerate', label: translateText(language, '重新生成') },
  ];
}

function normalizeWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function localRewrite(originalText: string, command?: AICommandPreset): string {
  const language = getDocumentLanguage();
  const text = normalizeWhitespace(originalText);
  if (!text) return translateText(language, '请先选中文本，或输入要处理的内容。');

  if (command?.id === 'fix_heading_level') {
    return text
      .split('\n')
      .map((line) => line.replace(/^(#{1,6})([^\s#])/g, '$1 $2'))
      .join('\n');
  }

  if (command?.id === 'translate_to_zh' || command?.id === 'translate_to_en') {
    return `> ${translateText(language, '当前是本地草稿模式，配置可用模型后会生成真实译文。')}\n\n${text}`;
  }

  if (command?.id === 'block_convert_to_list') {
    return text
      .split(/\n|。|；|;|、/)
      .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((line) => `- ${line}`)
      .join('\n') || `- ${translateText(language, '补充列表项')}`;
  }

  if (command?.id === 'block_shorten') {
    return text.length > 160 ? `${text.slice(0, 154).trim()}...` : text;
  }

  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/([。！？!?])\s+/g, '$1\n')
    .trim();
}

function localMarkdownDraft(options: SendAIChatOptions): string {
  const language = getDocumentLanguage();
  const { request, command, model, provider } = options;
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);
  const context = request.context;
  const selected = context.selectedText?.trim();
  const documentContent = context.documentContent?.trim();
  const source = selected || documentContent || request.userInput;
  const thinking = request.deepThinkingEnabled ? t('（深度思考）') : '';
  const modelLine = model && provider
    ? isTauriRuntime()
      ? `> ${t('已读取模型配置：{provider} / {model}{thinking}。当前模型或供应商未启用，先生成本地草稿。', { provider: provider.name, model: model.model, thinking })}`
      : `> ${t('已读取模型配置：{provider} / {model}{thinking}。当前不是 Tauri 运行环境，无法调用本地请求通道，先生成本地草稿。', { provider: provider.name, model: model.model, thinking })}`
    : `> ${t('当前没有可用模型配置，先生成本地草稿，方便验证编辑器工作流。')}`;

  if (request.resultMode === 'todo') {
    const lines = source
      .split('\n')
      .map((line) => line.replace(/^[-*#\s]+/, '').trim())
      .filter((line) => line.length > 0)
      .slice(0, 6);
    const todos = lines.length > 0 ? lines.map((line) => `- [ ] ${line}`).join('\n') : `- [ ] ${t('补充待办事项')}`;
    return `${modelLine}\n\n${todos}`;
  }

  if (request.resultMode === 'table') {
    return `${modelLine}\n\n| ${t('项目')} | ${t('内容')} |\n| --- | --- |\n| ${t('来源')} | ${selected ? t('选中文本') : t('当前输入')} |\n| ${t('摘要')} | ${normalizeWhitespace(source).slice(0, 120) || t('暂无内容')} |`;
  }

  if (command?.id === 'generate_readme') {
    return `${modelLine}\n\n# ${context.documentTitle?.replace(/\.md$/i, '') || t('项目 README')}\n\n## ${t('简介')}\n\n${normalizeWhitespace(source).slice(0, 240) || t('在这里补充项目简介。')}\n\n## ${t('使用')}\n\n~~~bash\n# ${t('在这里补充使用命令')}\n~~~\n\n## ${t('配置')}\n\n- ${t('根据项目需要补充配置说明。')}\n\n## ${t('常见问题')}\n\n- ${t('在这里记录常见问题和解决方案。')}`;
  }

  if (command?.id === 'block_generate_next') {
    return `${modelLine}\n\n${normalizeWhitespace(source).slice(0, 220) || t('继续补充当前主题。')}\n\n- ${t('下一步可以展开一个更具体的观点。')}\n- ${t('保持和上一个块一致的写作语气。')}`;
  }

  if (command?.id === 'summarize_document') {
    return `${modelLine}\n\n## ${t('摘要')}\n\n${normalizeWhitespace(source).slice(0, 360) || t('当前文档暂无可摘要内容。')}\n\n## ${t('重点')}\n\n- ${t('继续完善核心观点。')}\n- ${t('保持 Markdown 结构清晰。')}`;
  }

  return `${modelLine}\n\n${normalizeWhitespace(source) || t('请输入要让 AI 处理的问题。')}`;
}

function makeResultCards(options: SendAIChatOptions, content: string): AIResultCard[] {
  const language = getDocumentLanguage();
  const { request, command } = options;
  const originalText = request.context.selectedText || '';

  if (request.resultMode === 'diff') {
    const newText = content.trim() || localRewrite(originalText || request.userInput, command);
    return [
      {
        id: createAIId('card'),
        type: 'diff_result',
        title: command?.name || translateText(language, '修改建议'),
        diff: {
          originalText,
          newText,
          selectionRange: request.context.selectionRange,
          applyMode: 'replace_selection',
        },
        actions: diffResultActions(language),
      },
    ];
  }

  return [
    {
      id: createAIId('card'),
      type: 'markdown_result',
      title: command?.name || translateText(language, 'AI 结果'),
      markdown: content,
      actions: commonResultActions(language),
    },
  ];
}

function requiresCredential(providerType: AiProviderConfig['type']): boolean {
  return providerType === 'openai-compatible' || providerType === 'anthropic';
}

function canUseNativeProvider(model: AiModelConfig | undefined, provider: AiProviderConfig | undefined): model is AiModelConfig {
  return Boolean(model && provider?.enabled);
}

function canUseStreamingProvider(provider: AiProviderConfig): boolean {
  return provider.type === 'openai-compatible' || provider.type === 'custom';
}

async function sendNativeAIChat(options: SendAIChatOptions): Promise<AIChatResponse> {
  const language = getDocumentLanguage();
  const t = (value: string) => translateText(language, value);
  const { request, agent, command, model, provider } = options;
  throwIfCancelled(options.abortSignal);
  if (!model || !provider) throw new Error(t('模型配置不可用'));
  if (!provider.baseUrl?.trim()) throw new Error(t('模型供应商请求地址未配置，请在 AI 模型设置里填写请求地址'));
  if (requiresCredential(provider.type) && !provider.credentialRef?.trim()) {
    throw new Error(t('模型凭据未配置，请在 AI 模型设置里填写凭据引用或 API Key'));
  }
  const thinkingSupported = Boolean(model.thinkingSupported);

  const prompt = buildPrompt({
    agent,
    command,
    context: request.context,
    userInput: request.userInput,
  });
  const nativeRequest = {
    providerType: provider.type,
    apiUrl: provider.baseUrl,
    credentialRef: provider.credentialRef?.trim() || undefined,
    model: model.model,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    temperature: model.temperature,
    topP: model.topP,
    maxTokens: model.maxTokens,
    enableThinking: thinkingSupported ? request.deepThinkingEnabled : undefined,
    thinkingBudget: thinkingSupported && request.deepThinkingEnabled ? request.thinkingBudget : undefined,
  };
  let response: NativeAIChatResponse;

  if (canUseStreamingProvider(provider)) {
    const streamId = createAIId('stream');
    let content = '';
    let reasoningContent = '';
    const cancelStream = () => {
      void invoke('ai_cancel_chat_stream', { streamId });
    };
    options.abortSignal?.addEventListener('abort', cancelStream, { once: true });
    const unlisten = await listen<NativeAIChatStreamEvent>('ai-chat-stream', (event) => {
      if (event.payload.streamId !== streamId) return;
      if (options.abortSignal?.aborted) return;
      const contentDelta = event.payload.contentDelta || '';
      const reasoningDelta = event.payload.reasoningDelta || '';
      if (contentDelta) content += contentDelta;
      if (reasoningDelta) reasoningContent += reasoningDelta;
      options.onStreamUpdate?.({
        content,
        reasoningContent: reasoningContent || undefined,
        contentDelta: contentDelta || undefined,
        reasoningDelta: reasoningDelta || undefined,
      });
    });

    try {
      throwIfCancelled(options.abortSignal);
      response = await invoke<NativeAIChatResponse>('ai_send_chat_stream', {
        request: {
          ...nativeRequest,
          streamId,
        },
      });
      throwIfCancelled(options.abortSignal);
      options.onStreamUpdate?.({
        content: response.content,
        reasoningContent: response.reasoningContent,
      });
    } finally {
      options.abortSignal?.removeEventListener('abort', cancelStream);
      unlisten();
    }
  } else {
    throwIfCancelled(options.abortSignal);
    response = await invoke<NativeAIChatResponse>('ai_send_chat', {
      request: nativeRequest,
    });
    throwIfCancelled(options.abortSignal);
  }

  return {
    messageId: createAIId('msg'),
    content: response.content,
    reasoningContent: response.reasoningContent,
    resultCards: response.content.trim() ? makeResultCards(options, response.content) : [],
    usage: response.usage,
    model: response.model || model.model,
    provider: provider.name,
  };
}

export async function sendAIChatRequest(options: SendAIChatOptions): Promise<AIChatResponse> {
  const { request, agent, command, model, provider } = options;
  throwIfCancelled(options.abortSignal);
  if (canUseNativeProvider(model, provider) && isTauriRuntime()) {
    return sendNativeAIChat(options);
  }

  const prompt = buildPrompt({
    agent,
    command,
    context: request.context,
    userInput: request.userInput,
  });

  await new Promise((resolve) => window.setTimeout(resolve, 420));
  throwIfCancelled(options.abortSignal);

  const promptLength = prompt.system.length + prompt.user.length;
  const content = localMarkdownDraft(options);
  const resultCards = makeResultCards(options, content);

  return {
    messageId: createAIId('msg'),
    content,
    resultCards,
    usage: {
      inputTokens: Math.ceil(promptLength / 4),
      outputTokens: Math.ceil(content.length / 4),
      totalTokens: Math.ceil((promptLength + content.length) / 4),
    },
    model: options.model?.model,
    provider: options.provider?.name,
  };
}
