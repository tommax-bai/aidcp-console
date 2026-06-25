import { useState, useEffect, useMemo } from 'react';
import { App, Alert, Button, Card, Empty, Form, Input, Modal, Select, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../api/client';
import { useAccounts, useNotificationContacts } from '../api/queries';
import type { PanelNotificationContact } from '../types/api';

// 加入原因 → 中文标签（reason = NotificationItem.kind）。
const REASON_LABEL: Record<string, { text: string; color: string }> = {
  comment: { text: '评论', color: 'blue' },
  mention: { text: '@提及', color: 'geekblue' },
  like: { text: '点赞', color: 'magenta' },
  collect: { text: '收藏', color: 'gold' },
  follow: { text: '关注', color: 'green' },
};
function reasonTag(r: string) {
  const m = REASON_LABEL[r];
  return <Tag color={m?.color}>{m?.text ?? r}</Tag>;
}

/**
 * 通知联系人页（change notification-contact-registry）。
 * - 按账号维度记录给该账号发过通知的人（评论/@/点赞/收藏/关注），机器字段（昵称/原因/次数/时间）只读、
 *   人工字段（微信/标签/备注）可编辑。
 * - 必须先选账号（联系人按账号隔离，不提供全账号合并视图＝PII 隔离）。
 * - 写非乐观——round-trip 后 invalidate 重取真态。诚实口径见顶部 Alert。
 */
export function NotificationContactsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState<string | undefined>(undefined);

  // 默认选中第一个账号（必须先选账号才加载联系人）。
  useEffect(() => {
    if (!accountId && accounts.data?.accounts?.length) {
      setAccountId(accounts.data.accounts[0].accountId);
    }
  }, [accounts.data, accountId]);

  const contacts = useNotificationContacts(accountId);

  const [editing, setEditing] = useState<PanelNotificationContact | null>(null);
  const [wechat, setWechat] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  const openEdit = (row: PanelNotificationContact) => {
    setEditing(row);
    setWechat(row.wechat ?? '');
    setNote(row.note ?? '');
    setTags(row.tags ?? []);
  };

  // 标签建议：当前列表里已用过的标签，方便复用。
  const tagSuggestions = useMemo(() => {
    const s = new Set<string>();
    (contacts.data?.contacts ?? []).forEach((c) => c.tags.forEach((t) => s.add(t)));
    return Array.from(s).map((t) => ({ value: t }));
  }, [contacts.data]);

  const save = useMutation({
    mutationFn: (v: { senderKey: string; wechat: string; note: string; tags: string[] }) =>
      apiPut<{ ok: boolean }>(
        `/api/notification/contacts/${encodeURIComponent(accountId!)}/${encodeURIComponent(v.senderKey)}`,
        { wechat: v.wechat || null, note: v.note || null, tags: v.tags },
      ),
    onSuccess: () => {
      message.success('已保存');
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['notification-contacts', accountId] });
    },
    onError: (e) => {
      const msg = (e as Error).message;
      message.error(msg === 'invalid_value' || msg.startsWith('bad_request') ? '输入有误，未保存' : '保存失败');
    },
  });

  const accountOptions = (accounts.data?.accounts ?? []).map((a) => ({ label: a.label ?? a.accountId, value: a.accountId }));

  const columns: ColumnsType<PanelNotificationContact> = [
    {
      title: '昵称',
      dataIndex: 'nickname',
      render: (n: string | null, row) => (
        <span>
          {n ? <strong>{n}</strong> : <Tag>昵称缺失</Tag>}
          {row.userId ? <Typography.Text type="secondary"> · {row.userId}</Typography.Text> : null}
        </span>
      ),
    },
    {
      title: '加入原因',
      dataIndex: 'firstReason',
      width: 170,
      render: (r: string, row) => (
        <span>
          {reasonTag(r)}
          {row.reasons
            .filter((x) => x !== r)
            .map((x) => (
              <span key={x} style={{ marginLeft: 4 }}>
                {reasonTag(x)}
              </span>
            ))}
        </span>
      ),
    },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (ts: string[]) =>
        ts.length ? (
          ts.map((t) => (
            <Tag key={t} color="processing">
              {t}
            </Tag>
          ))
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '微信',
      dataIndex: 'wechat',
      width: 140,
      render: (w: string | null) => (w ? w : <Typography.Text type="secondary">—</Typography.Text>),
    },
    {
      title: '互动次数',
      dataIndex: 'eventCount',
      width: 100,
      sorter: (a, b) => a.eventCount - b.eventCount,
      render: (n: number) => <span className="tabular-nums">{n}</span>,
    },
    {
      title: '添加时间',
      dataIndex: 'firstSeen',
      width: 180,
      render: (t: number) => (
        <Typography.Text type="secondary" className="tabular-nums">
          {new Date(t).toLocaleString('zh-CN')}
        </Typography.Text>
      ),
    },
    {
      title: '最近时间',
      dataIndex: 'lastSeen',
      width: 180,
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.lastSeen - b.lastSeen,
      render: (t: number) => (
        <Typography.Text type="secondary" className="tabular-nums">
          {new Date(t).toLocaleString('zh-CN')}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      width: 90,
      render: (_: unknown, row) => (
        <Button size="small" onClick={() => openEdit(row)}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <Card
        size="small"
        title="通知联系人"
        extra={
          <Select
            size="small"
            style={{ width: 200 }}
            placeholder="选择账号"
            value={accountId}
            onChange={setAccountId}
            options={accountOptions}
            loading={accounts.isLoading}
          />
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 'var(--aidcp-space-4)' }}
          message="本页记录给该账号发过通知的人（评论 / @ / 点赞 / 收藏 / 关注），均取自通知页。"
          description="仅记录功能上线后巡视扫到的人，不回填历史；「添加时间」为云端首次扫到的时间，上线后第一轮巡视会把存量未读集中记到上线时间附近。联系人按主页ID（取不到则昵称）聚合。"
        />
        <Table<PanelNotificationContact>
          size="small"
          rowKey="senderKey"
          columns={columns}
          dataSource={contacts.data?.contacts ?? []}
          loading={contacts.isLoading}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          locale={{ emptyText: <Empty description={accountId ? '暂无通知联系人' : '请选择账号'} /> }}
        />
      </Card>

      <Modal
        title={editing ? `编辑联系人：${editing.nickname ?? '昵称缺失'}` : ''}
        open={!!editing}
        onCancel={() => setEditing(null)}
        confirmLoading={save.isPending}
        onOk={() => editing && save.mutate({ senderKey: editing.senderKey, wechat, note, tags })}
        okText="保存"
        cancelText="取消"
      >
        {editing ? (
          <Form layout="vertical" requiredMark={false}>
            <Form.Item label="微信" extra="预留字段，手动填写，可留空">
              <Input value={wechat} onChange={(e) => setWechat(e.target.value)} placeholder="手动填写微信号，可留空" />
            </Form.Item>
            <Form.Item label="标签">
              <Select
                mode="tags"
                value={tags}
                onChange={setTags}
                options={tagSuggestions}
                placeholder="输入后回车添加；可复用已有标签"
                tokenSeparators={[',', ' ']}
              />
            </Form.Item>
            <Form.Item label="备注">
              <Input.TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                autoSize={{ minRows: 2, maxRows: 6 }}
                placeholder="可留空"
              />
            </Form.Item>
          </Form>
        ) : null}
      </Modal>
    </div>
  );
}
