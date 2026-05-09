import { Table, Tag, Switch, Input, Button, Space, Typography } from 'antd';
import { SearchOutlined, UndoOutlined } from '@ant-design/icons';
import { useShortcutStore } from '../../../store';
import type { ShortcutConfig } from '../../../types';
import { useState } from 'react';

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
  const [search, setSearch] = useState('');
  const [recordingId, setRecordingId] = useState<string | null>(null);

  const filtered = shortcuts.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.id.toLowerCase().includes(search.toLowerCase())
  );

  const handleKeyDown = (e: React.KeyboardEvent, shortcut: ShortcutConfig) => {
    e.preventDefault();
    if (e.key === 'Escape') {
      setRecordingId(null);
      return;
    }
    const keys: string[] = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.metaKey) keys.push('Meta');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
      keys.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    }
    const combo = keys.join('+');
    if (!combo || ['Ctrl', 'Meta', 'Alt', 'Shift'].includes(combo)) return;
    updateShortcut(shortcut.id, combo);
    setRecordingId(null);
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 200 },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (c: string) => <Tag>{categoryMap[c] || c}</Tag>,
    },
    {
      title: '快捷键',
      dataIndex: 'keys',
      key: 'keys',
      width: 180,
      render: (keys: string, record: ShortcutConfig) => (
        recordingId === record.id ? (
          <kbd
            tabIndex={0}
            onKeyDown={(e) => handleKeyDown(e, record)}
            onBlur={() => setRecordingId(null)}
            className="shortcut-key recording"
          >
            按下组合键...
          </kbd>
        ) : (
          <span
            onClick={() => setRecordingId(record.id)}
            className="shortcut-key"
          >
            {keys}
          </span>
        )
      ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 80,
      render: (s: string) => s === 'core' ? <Tag color="blue">核心</Tag> : <Tag>插件</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (v: boolean, record: ShortcutConfig) => (
        <Switch size="small" checked={v} onChange={() => toggleShortcut(record.id)} />
      ),
    },
    {
      title: '操作',
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
          恢复
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="搜索快捷键"
          prefix={<SearchOutlined />}
          style={{ width: 240 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Button icon={<UndoOutlined />} onClick={resetAll}>
          恢复所有默认
        </Button>
      </Space>

      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        点击快捷键单元格可重新设置快捷键。点击后按下组合键即可。
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
