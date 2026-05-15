import { Button, Tooltip } from 'antd';
import { PanelRightClose, Settings, Trash2 } from 'lucide-react';
import { useSettingsStore } from '../../../store';
import { translateText } from '../../../i18n';

interface AIChatHeaderProps {
  onOpenSettings?: () => void;
  onClear?: () => void;
  onClose?: () => void;
}

export function AIChatHeader({ onOpenSettings, onClear, onClose }: AIChatHeaderProps) {
  const language = useSettingsStore(s => s.general.language);
  const t = (value: string) => translateText(language, value);

  return (
    <div className="ai-chat-header">
      <div>
        <div className="ai-chat-title">{t('AI 写作')}</div>
        <div className="ai-chat-subtitle">{t('面向当前 Markdown 文档')}</div>
      </div>
      <div className="ai-chat-header-actions">
        <Tooltip title={t('清空会话')}>
          <Button type="text" size="small" icon={<Trash2 size={16} />} disabled={!onClear} onClick={onClear} />
        </Tooltip>
        <Tooltip title={t('AI 设置')}>
          <Button type="text" size="small" icon={<Settings size={16} />} onClick={onOpenSettings} />
        </Tooltip>
        {onClose && (
          <Tooltip title={t('收起 AI 面板')}>
            <Button type="text" size="small" icon={<PanelRightClose size={16} />} onClick={onClose} />
          </Tooltip>
        )}
      </div>
    </div>
  );
}
