import { Button, Tooltip } from 'antd';
import { PanelRightClose, RotateCcw, Settings } from 'lucide-react';

interface AIChatHeaderProps {
  onOpenSettings?: () => void;
  onClear?: () => void;
  onClose?: () => void;
}

export function AIChatHeader({ onOpenSettings, onClear, onClose }: AIChatHeaderProps) {
  return (
    <div className="ai-chat-header">
      <div>
        <div className="ai-chat-title">AI 写作</div>
        <div className="ai-chat-subtitle">面向当前 Markdown 文档</div>
      </div>
      <div className="ai-chat-header-actions">
        <Tooltip title="清空会话">
          <Button type="text" size="small" icon={<RotateCcw size={16} />} onClick={onClear} />
        </Tooltip>
        <Tooltip title="AI 设置">
          <Button type="text" size="small" icon={<Settings size={16} />} onClick={onOpenSettings} />
        </Tooltip>
        {onClose && (
          <Tooltip title="收起 AI 面板">
            <Button type="text" size="small" icon={<PanelRightClose size={16} />} onClick={onClose} />
          </Tooltip>
        )}
      </div>
    </div>
  );
}
