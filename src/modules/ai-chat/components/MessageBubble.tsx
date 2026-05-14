import { Spin, Tag } from 'antd';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ResultCard } from './ResultCard';
import type { AIMessage, AIResultAction, AIResultCard } from '../types';
import { useSettingsStore } from '../../../store';
import { translateText } from '../../../i18n';

interface MessageBubbleProps {
  message: AIMessage;
  onResultAction: (action: AIResultAction, card: AIResultCard, message: AIMessage) => void;
}

function ThinkingProcess({ message, language }: { message: AIMessage; language: unknown }) {
  const t = (value: string) => translateText(language, value);
  const reasoningContent = message.reasoningContent?.trim();
  const isThinking = message.status === 'pending' || message.status === 'streaming';
  const [expanded, setExpanded] = useState(isThinking);
  const className = [
    'ai-thinking-process',
    isThinking ? 'is-pending' : '',
    expanded ? 'is-expanded' : 'is-collapsed',
    !reasoningContent ? 'is-empty' : '',
  ].filter(Boolean).join(' ');

  useEffect(() => {
    setExpanded(isThinking);
  }, [isThinking, message.id]);

  if (message.role !== 'assistant') return null;
  if (!message.deepThinkingEnabled) return null;
  if (message.status === 'failed' && !reasoningContent) return null;

  const statusText = isThinking
    ? t('思考中')
    : reasoningContent
      ? t('已完成')
      : t('无内容');

  return (
    <div className={className}>
      <button
        type="button"
        className="ai-thinking-process-head"
        onClick={() => !isThinking && setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {isThinking ? <Spin size="small" /> : expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{t('思考过程')}</span>
        <span className="ai-thinking-process-status">{statusText}</span>
      </button>
      {expanded && (
        <div className="ai-thinking-process-body">
          {reasoningContent ? (
            <pre>{reasoningContent}</pre>
          ) : (
            <div className="ai-thinking-process-empty">
              {isThinking ? t('正在等待模型返回思考内容...') : t('模型没有返回可展示的思考过程。')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MessageBubble({ message, onResultAction }: MessageBubbleProps) {
  const language = useSettingsStore(s => s.general.language);
  const t = (value: string) => translateText(language, value);
  const isUser = message.role === 'user';
  const hasResultCards = Boolean(message.resultCards?.length);
  const hasContent = Boolean(message.content.trim() || message.errorMessage);
  const isThinkingOnlyPending = !isUser && message.deepThinkingEnabled && message.status === 'pending';
  const shouldShowContent = (
    isUser ||
    (message.status === 'pending' && !isThinkingOnlyPending) ||
    message.status === 'failed' ||
    (!isThinkingOnlyPending && !hasResultCards && hasContent)
  );

  return (
    <div className={`ai-message ${isUser ? 'user' : 'assistant'}`}>
      <div className="ai-message-meta">
        <span>{isUser ? t('你') : 'AI'}</span>
        {message.agentName && <Tag bordered={false}>{message.agentName}</Tag>}
        {(message.status === 'pending' || message.status === 'streaming') && !message.deepThinkingEnabled && <Spin size="small" />}
        {message.status === 'failed' && <Tag color="red">{t('失败')}</Tag>}
        {message.status === 'cancelled' && <Tag color="default">{t('已取消')}</Tag>}
      </div>
      <ThinkingProcess message={message} language={language} />
      {shouldShowContent && (
        <div className="ai-message-content">
          {message.content}
          {message.errorMessage && <div className="ai-message-error">{message.errorMessage}</div>}
        </div>
      )}
      {message.resultCards?.map((card) => (
        <ResultCard
          key={card.id}
          card={card}
          onAction={(action, currentCard) => onResultAction(action, currentCard, message)}
        />
      ))}
    </div>
  );
}
