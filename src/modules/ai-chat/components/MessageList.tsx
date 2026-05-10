import { Empty } from 'antd';
import { MessageBubble } from './MessageBubble';
import type { AIMessage, AIResultAction, AIResultCard } from '../types';

interface MessageListProps {
  messages: AIMessage[];
  onResultAction: (action: AIResultAction, card: AIResultCard, message: AIMessage) => void;
}

export function MessageList({ messages, onResultAction }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="ai-message-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有 AI 消息" />
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
