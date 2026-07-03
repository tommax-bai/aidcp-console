import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App, Alert, Card, Empty, Input, Select, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../api/client';
import { useAccounts, useNotificationContacts } from '../api/queries';
import { ProfileLink } from '../components';
import { QueryError } from '../components/QueryGate';
import type { PanelNotificationContact } from '../types/api';
import { accountDisplayName, makeAccountNamer } from '../types/accountDisplay';

/** 账号筛选哨兵：选「全部账号」时不带 accountId（全账号合并视图）。 */
const ALL_ACCOUNTS = '__all__';

/** 单次拉取上限（取后端 listContacts 硬上限）：触顶则诚实提示，绝不把截断当完整呈现。 */
const CONTACTS_LIMIT = 1000;

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

/** 可就地编辑的人工字段。 */
type EditField = 'wechat' | 'note' | 'tags';
/** 行主键（与 Table rowKey 同口径）：账号 + senderKey，全账号视图下区分同一人不同账号两行。 */
const rowKeyOf = (r: PanelNotificationContact) => `${r.accountId}::${r.senderKey}`;

/**
 * 通知联系人页（change notification-contact-registry）。
 * - 按账号维度记录给该账号发过通知的人（评论/@/点赞/收藏/关注），机器字段（昵称/原因/次数/时间）只读、
 *   人工字段（微信/标签/备注）就地编辑：点击单元格即进入编辑，失焦（点到外部）即保存，无独立编辑弹窗。
 * - 默认「全部账号」合并视图（每行带账号列），可在右上切到单个账号；人工字段写入按行账号路由隔离。
 * - 乐观改缓存（就地编辑立即反映）→ 失败回滚 + 报错、落定后 invalidate 重取服务端真态；仅在值确有变化时才落库。
 */
export function NotificationContactsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const accounts = useAccounts();
  // 默认「全部账号」：全账号合并视图，每行带归属账号。可在右上切到单个账号。
  // #17：账号筛选进 URL query（?account=<id>），可分享/刷新保持；全部账号时删除该参数（其它 query 保留）。
  const [searchParams, setSearchParams] = useSearchParams();
  const accountId = searchParams.get('account') ?? ALL_ACCOUNTS;
  const setAccountId = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (id && id !== ALL_ACCOUNTS) next.set('account', id);
    else next.delete('account');
    setSearchParams(next);
  };
  const effectiveAccountId = accountId === ALL_ACCOUNTS ? undefined : accountId;
  const allAccountsView = effectiveAccountId === undefined;

  const contacts = useNotificationContacts(effectiveAccountId, CONTACTS_LIMIT);
  const namer = makeAccountNamer(accounts.data?.accounts ?? []);
  // 返回条数触顶＝可能被截断（按最近时间排序，旧的会被裁掉）；诚实提示，勿把截断当完整。
  const capped = (contacts.data?.contacts?.length ?? 0) >= CONTACTS_LIMIT;

  // 就地编辑态：当前编辑的单元格（行 + 字段）+ 该单元格的草稿值。
  const [edit, setEdit] = useState<{ rowKey: string; field: EditField } | null>(null);
  const [draft, setDraft] = useState(''); // 微信 / 备注 的文本草稿
  const [draftTags, setDraftTags] = useState<string[]>([]); // 标签草稿

  const isEditing = (row: PanelNotificationContact, field: EditField) =>
    edit?.rowKey === rowKeyOf(row) && edit.field === field;

  const beginEdit = (row: PanelNotificationContact, field: EditField) => {
    setEdit({ rowKey: rowKeyOf(row), field });
    if (field === 'tags') setDraftTags(row.tags ?? []);
    else setDraft(((field === 'wechat' ? row.wechat : row.note) ?? '').toString());
  };

  // 标签建议：当前列表里已用过的标签，方便复用。
  const tagSuggestions = useMemo(() => {
    const s = new Set<string>();
    (contacts.data?.contacts ?? []).forEach((c) => c.tags.forEach((t) => s.add(t)));
    return Array.from(s).map((t) => ({ value: t }));
  }, [contacts.data]);

  const save = useMutation({
    // 写入按行账号路由（全账号视图下每行账号不同），accountId 取自被编辑行。
    mutationFn: (v: { accountId: string; senderKey: string; wechat: string; note: string; tags: string[] }) =>
      apiPut<{ ok: boolean }>(
        `/api/notification/contacts/${encodeURIComponent(v.accountId)}/${encodeURIComponent(v.senderKey)}`,
        { wechat: v.wechat || null, note: v.note || null, tags: v.tags },
      ),
    // 乐观改本地缓存：就地编辑立即反映到表格 → 同一行其它字段的后续保存能读到最新兄弟值。
    // 每格保存都是「整对象 PUT」，若沿用旧的非乐观（写后要等 refetch 才更新表格），连改两格时
    // 后一次会用渲染时快照里的旧兄弟值覆盖前一次刚存的字段（静默回退）。乐观补丁关掉这个竞态。
    // 失败照常回滚 + 报错（不静默假成功）；onSettled 无论成败都 invalidate 重取服务端真态对账。
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['notification-contacts'] });
      const prev = qc.getQueriesData<{ contacts: PanelNotificationContact[] }>({
        queryKey: ['notification-contacts'],
      });
      qc.setQueriesData<{ contacts: PanelNotificationContact[] }>(
        { queryKey: ['notification-contacts'] },
        (old) =>
          old
            ? {
                ...old,
                contacts: old.contacts.map((c) =>
                  c.accountId === v.accountId && c.senderKey === v.senderKey
                    ? { ...c, wechat: v.wechat || null, note: v.note || null, tags: v.tags }
                    : c,
                ),
              }
            : old,
      );
      return { prev };
    },
    onSuccess: () => {
      message.success('已保存');
    },
    onError: (e, _v, ctx) => {
      ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data)); // 回滚乐观补丁
      const msg = (e as Error).message;
      message.error(msg === 'invalid_value' || msg.startsWith('bad_request') ? '输入有误，未保存' : '保存失败');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['notification-contacts'] });
    },
  });

  // 失焦即存：仅当值确有变化才落库；被编辑字段随同行其它人工字段一并 PUT（后端整对象写）。
  const commit = (row: PanelNotificationContact) => {
    if (!edit) return;
    const field = edit.field;
    setEdit(null);
    if (field === 'tags') {
      const prev = row.tags ?? [];
      const unchanged = prev.length === draftTags.length && prev.every((t, i) => t === draftTags[i]);
      if (unchanged) return;
      save.mutate({
        accountId: row.accountId,
        senderKey: row.senderKey,
        wechat: row.wechat ?? '',
        note: row.note ?? '',
        tags: draftTags,
      });
      return;
    }
    const value = draft.trim();
    const prev = ((field === 'wechat' ? row.wechat : row.note) ?? '').trim();
    if (value === prev) return;
    save.mutate({
      accountId: row.accountId,
      senderKey: row.senderKey,
      wechat: field === 'wechat' ? value : (row.wechat ?? ''),
      note: field === 'note' ? value : (row.note ?? ''),
      tags: row.tags ?? [],
    });
  };

  const accountOptions = [
    { label: '全部账号', value: ALL_ACCOUNTS },
    ...(accounts.data?.accounts ?? []).map((a) => ({
      label: accountDisplayName(a.nickname, a.label, a.accountId),
      value: a.accountId,
    })),
  ];

  // 全账号视图下前置「账号」列，标明每行联系人归属（单账号视图不显示）。
  const accountColumn: ColumnsType<PanelNotificationContact>[number] = {
    title: '账号',
    dataIndex: 'accountId',
    width: 140,
    render: (id: string) => <span>{namer(id)}</span>,
  };

  const columns: ColumnsType<PanelNotificationContact> = [
    {
      title: '昵称',
      dataIndex: 'nickname',
      // 联系人昵称可点：跳转其小红书主页（userId = 通知行解析出的主页 id）。无 userId 时回落纯文本，绝不渲染死链。
      render: (n: string | null, row) => (
        <ProfileLink userId={row.userId}>
          {n ? <strong>{n}</strong> : <Tag>昵称缺失</Tag>}
          {row.userId ? <Typography.Text type="secondary"> · {row.userId}</Typography.Text> : null}
        </ProfileLink>
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
      // 就地编辑：点击进入 tags 选择，失焦保存。
      title: '标签',
      dataIndex: 'tags',
      width: 240,
      render: (ts: string[], row) =>
        isEditing(row, 'tags') ? (
          <Select
            size="small"
            mode="tags"
            autoFocus
            defaultOpen
            style={{ width: '100%', minWidth: 180 }}
            value={draftTags}
            onChange={setDraftTags}
            onBlur={() => commit(row)}
            options={tagSuggestions}
            tokenSeparators={[',', ' ']}
            placeholder="输入后回车添加；可复用已有标签"
          />
        ) : (
          <div className="editable-cell" onClick={() => beginEdit(row, 'tags')} title="点击编辑">
            {ts.length ? (
              ts.map((t) => (
                <Tag key={t} color="processing">
                  {t}
                </Tag>
              ))
            ) : (
              <Typography.Text type="secondary">—</Typography.Text>
            )}
          </div>
        ),
    },
    {
      // 就地编辑：点击进入输入框，回车或失焦保存。
      title: '微信',
      dataIndex: 'wechat',
      width: 160,
      render: (w: string | null, row) =>
        isEditing(row, 'wechat') ? (
          <Input
            size="small"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(row)}
            onPressEnter={() => commit(row)}
            placeholder="微信号，可留空"
          />
        ) : (
          <div className="editable-cell" onClick={() => beginEdit(row, 'wechat')} title="点击编辑">
            {w ? w : <Typography.Text type="secondary">—</Typography.Text>}
          </div>
        ),
    },
    {
      // 就地编辑：点击进入多行输入，失焦保存（回车换行、不触发保存）。
      title: '备注',
      dataIndex: 'note',
      render: (nt: string | null, row) =>
        isEditing(row, 'note') ? (
          <Input.TextArea
            size="small"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(row)}
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder="备注，可留空"
          />
        ) : (
          <div className="editable-cell" onClick={() => beginEdit(row, 'note')} title="点击编辑">
            {nt ? nt : <Typography.Text type="secondary">—</Typography.Text>}
          </div>
        ),
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
          message="本页记录给各账号发过通知的人（评论 / @ / 点赞 / 收藏 / 关注），均取自通知页。默认全部账号，可在右上切到单个账号。「微信 / 标签 / 备注」可直接点击单元格就地编辑，点到外部即保存。"
          description="仅记录功能上线后巡视扫到的人，不回填历史；「添加时间」为云端首次扫到的时间，上线后第一轮巡视会把存量未读集中记到上线时间附近。联系人按账号 + 主页ID（取不到则昵称）聚合。"
        />
        {capped ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 'var(--aidcp-space-4)' }}
            message={`联系人较多，仅显示按时间最近的 ${CONTACTS_LIMIT} 位${allAccountsView ? '（全部账号合计）' : ''}，更早的未列出；如需完整列表请切到单个账号查看。`}
          />
        ) : null}
        <Table<PanelNotificationContact>
          size="small"
          rowKey={rowKeyOf}
          columns={allAccountsView ? [accountColumn, ...columns] : columns}
          dataSource={contacts.data?.contacts ?? []}
          loading={contacts.isLoading}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          locale={{
            emptyText: contacts.isError ? (
              <QueryError title="加载通知联系人失败" onRetry={() => contacts.refetch()} />
            ) : (
              <Empty description="暂无通知联系人" />
            ),
          }}
        />
      </Card>
    </div>
  );
}
