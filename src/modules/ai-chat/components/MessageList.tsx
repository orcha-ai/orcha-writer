import { Empty } from 'antd';
import { MessageBubble } from './MessageBubble';
import type { AIMessage, AIResultAction, AIResultCard } from '../types';
import { useSettingsStore } from '../../../store';
import { translateText } from '../../../i18n';

interface MessageListProps {
  messages: AIMessage[];
  onResultAction: (action: AIResultAction, card: AIResultCard, message: AIMessage) => void;
}

export function MessageList({ messages, onResultAction }: MessageListProps) {
  const language = useSettingsStore(s => s.general.language);
  const t = (value: string) => translateText(language, value);

  if (messages.length === 0) {
    return (
      <div className="ai-message-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('还没有 AI 消息')} />
      </div>
    );
  }

  return (
    <div className="ai-message-list">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} onResultAction={onResultAction} />
      ))}
    </div>
  );
}
