import { Table, Tag, Switch, Input, Button, Space, Typography } from 'antd';
import { SearchOutlined, UndoOutlined } from '@ant-design/icons';
import { useSettingsStore, useShortcutStore } from '../../../store';
import type { ShortcutConfig } from '../../../types';
import { useCallback, useEffect, useState } from 'react';
import { translateText } from '../../../i18n';
import {
  doubleShortcutKey,
  doubleShortcutValue,
  isDoubleKeyShortcut,
  isPlainKeyPress,
  isShortcutModifier,
  normalizeShortcutKey,
} from '../../../utils/keyboardShortcuts';

const { Text } = Typography;

const categoryMap: Record<string, string> = {
  file: '文件',
  edit: '编辑',
  markdown: 'Markdown',
  view: '视图',
  export: '导出',
  ai: 'AI',
  plugin: '插件',
  system: '系统',
};

export default function ShortcutsPage() {
  const { shortcuts, toggleShortcut, updateShortcut, resetAll, resetShortcut } = useShortcutStore();
  const language = useSettingsStore(s => s.general.language);
  const [search, setSearch] = useState('');
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [pendingDoubleKey, setPendingDoubleKey] = useState<{ shortcutId: string; key: string; at: number } | null>(null);
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);

  const filtered = shortcuts.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.id.toLowerCase().includes(search.toLowerCase())
  );

  const clearRecording = useCallback(() => {
    setRecordingId(null);
    setPendingDoubleKey(null);
  }, []);

  const canRecordDoubleShortcut = useCallback((shortcut: ShortcutConfig) => (
    shortcut.id === 'app.globalFileSearch'
    || isDoubleKeyShortcut(shortcut.keys)
    || Boolean(shortcut.defaultKeys && isDoubleKeyShortcut(shortcut.defaultKeys))
  ), []);

  const formatShortcutKeys = (keys: string) => {
    const doubleKey = doubleShortcutKey(keys);
    if (!doubleKey) return keys || '-';
    return `${t('双击')} ${doubleKey}`;
  };

  const handleKeyDown = useCallback((event: KeyboardEvent | React.KeyboardEvent, shortcut: ShortcutConfig) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      clearRecording();
      return;
    }

    const key = normalizeShortcutKey(event.key);
    if (canRecordDoubleShortcut(shortcut) && isPlainKeyPress(event)) {
      const now = Date.now();
      if (pendingDoubleKey?.shortcutId === shortcut.id && pendingDoubleKey.key === key && now - pendingDoubleKey.at <= 700) {
        updateShortcut(shortcut.id, doubleShortcutValue(key));
        clearRecording();
        return;
      }

      setPendingDoubleKey({ shortcutId: shortcut.id, key, at: now });
      return;
    }

    const keys: string[] = [];
    if (event.ctrlKey) keys.push('Ctrl');
    if (event.metaKey) keys.push('Meta');
    if (event.altKey) keys.push('Alt');
    if (event.shiftKey) keys.push('Shift');
    if (!isShortcutModifier(key)) {
      keys.push(key);
    }
    const combo = keys.join('+');
    if (!combo || ['Ctrl', 'Meta', 'Alt', 'Shift'].includes(combo)) return;
    updateShortcut(shortcut.id, combo);
    clearRecording();
  }, [canRecordDoubleShortcut, clearRecording, pendingDoubleKey, updateShortcut]);

  useEffect(() => {
    if (!recordingId) return undefined;
    const shortcut = shortcuts.find(item => item.id === recordingId);
    if (!shortcut) return undefined;

    const handler = (event: KeyboardEvent) => handleKeyDown(event, shortcut);
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [handleKeyDown, recordingId, shortcuts]);

  const columns = [
    { title: t('名称'), dataIndex: 'name', key: 'name', width: 200, render: (name: string) => t(name) },
    {
      title: t('分类'),
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (c: string) => <Tag>{t(categoryMap[c] || c)}</Tag>,
    },
    {
      title: t('快捷键'),
      dataIndex: 'keys',
      key: 'keys',
      width: 180,
      render: (keys: string, record: ShortcutConfig) => (
        recordingId === record.id ? (
          <kbd
            tabIndex={0}
            onBlur={clearRecording}
            className="shortcut-key recording"
            autoFocus
          >
            {pendingDoubleKey?.shortcutId === record.id
              ? t('再次按下 {key}...', { key: pendingDoubleKey.key })
              : canRecordDoubleShortcut(record)
                ? t('按下组合键，或连续按两次同一个键...')
                : t('按下组合键...')}
          </kbd>
        ) : (
          <span
            onClick={() => {
              setRecordingId(record.id);
              setPendingDoubleKey(null);
            }}
            className="shortcut-key"
          >
            {formatShortcutKeys(keys)}
          </span>
        )
      ),
    },
    {
      title: t('来源'),
      dataIndex: 'source',
      key: 'source',
      width: 80,
      render: (s: string) => s === 'core' ? <Tag color="blue">{t('核心')}</Tag> : <Tag>{t('插件')}</Tag>,
    },
    {
      title: t('状态'),
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (v: boolean, record: ShortcutConfig) => (
        <Switch size="small" checked={v} onChange={() => toggleShortcut(record.id)} />
      ),
    },
    {
      title: t('操作'),
      key: 'actions',
      width: 100,
      render: (_: unknown, record: ShortcutConfig) => (
        <Button
          size="small"
          icon={<UndoOutlined />}
          type="text"
          disabled={!record.defaultKeys || record.keys === record.defaultKeys}
          onClick={() => resetShortcut(record.id)}
        >
          {t('恢复')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder={t('搜索快捷键')}
          prefix={<SearchOutlined />}
          style={{ width: 240 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Button icon={<UndoOutlined />} onClick={resetAll}>
          {t('恢复所有默认')}
        </Button>
      </Space>

      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        {t('点击快捷键单元格可重新设置快捷键。点击后按下组合键即可。')} {t('双击快捷键请连续按两次同一个键。')}
      </Text>

      <Table
        columns={columns}
        dataSource={filtered}
        rowKey="id"
        pagination={false}
        size="small"
      />
    </div>
  );
}
