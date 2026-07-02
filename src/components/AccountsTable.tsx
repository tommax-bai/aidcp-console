import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Input, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RiskStatusBadge } from './RiskStatusBadge';
import { QuotaTierBadge } from './QuotaTierBadge';
import { ProfileLink } from './ProfileLink';
import type { PanelAccount } from '../types/api';
import { OPERATOR_STATUS_LABEL, type RiskStatus } from '../types/aidcp-enums';
import { accountDisplayName } from '../types/accountDisplay';

const SEVERITY_ORDER: Record<RiskStatus, number> = { frozen: 0, restricted: 1, warned: 2, normal: 3 };

function severityRank(a: PanelAccount): number {
  return a.riskStatus ? SEVERITY_ORDER[a.riskStatus] : 4;
}

const dash = <Typography.Text type="secondary">—</Typography.Text>;

const columns: ColumnsType<PanelAccount> = [
  {
    title: '账号',
    key: 'account',
    // 账号名可点：跳转其小红书主页（accountId = 登录派生的 xhs userid）。非真实 id 回落纯文本。
    render: (_, r) => (
      <ProfileLink userId={r.accountId}>{accountDisplayName(r.nickname, r.label, r.accountId)}</ProfileLink>
    ),
  },
  {
    title: '人设',
    key: 'persona',
    // 未绑人设（非 default）→「需设置人设」红标 + 跳转人设页；已绑 → 绿标；default 豁免 → 中性「默认人设」。
    render: (_, r) =>
      r.needsPersonaSetup ? (
        <Link to="/persona">
          <Tag color="warning">需设置人设</Tag>
        </Link>
      ) : r.personaBound ? (
        <Tag color="green">已绑人设</Tag>
      ) : (
        <Tag>默认人设</Tag>
      ),
  },
  { title: '分组', dataIndex: 'groupLabel', render: (v: string | null) => v ?? dash },
  {
    title: '运营',
    dataIndex: 'operatorStatus',
    // 运营暂停态，区别于验证码暂停（不共用一个含糊 paused 徽标）
    render: (v: 'active' | 'paused') =>
      v === 'paused' ? <Tag>{OPERATOR_STATUS_LABEL.paused}</Tag> : <Tag color="green">{OPERATOR_STATUS_LABEL.active}</Tag>,
  },
  {
    title: '风控状态',
    dataIndex: 'riskStatus',
    // 两个独立徽标之一：风控 STATUS
    render: (v: RiskStatus | null) => (v ? <RiskStatusBadge status={v} /> : dash),
  },
  {
    title: '配额档位',
    key: 'tier',
    // 两个独立徽标之二：风控 QUOTA-TIER（与 status 永不合并）
    render: (_, r) => (r.riskQuotaLevel ? <QuotaTierBadge tier={r.riskQuotaLevel} /> : dash),
  },
  { title: '信号数', dataIndex: 'signalCount', render: (v: number | null) => v ?? dash },
];

export function AccountsTable({
  accounts,
  loading,
  severitySorted = false,
  actionsColumn,
  onEditGroup,
  onEditGroupChat,
}: {
  accounts: PanelAccount[];
  loading?: boolean;
  severitySorted?: boolean;
  /** 可选操作列（如 pause/resume 按钮）；只读视图不传。 */
  actionsColumn?: (account: PanelAccount) => ReactNode;
  /**
   * 可选：分组标签就地编辑保存回调（change editable-account-group-label）。
   * 传入 →「分组」列点击即变输入框、回车/失焦保存（trim 后空 = 清空，回 null）；
   * 不传 →「分组」列保持纯文本（只读视图如仪表盘不受影响）。
   */
  onEditGroup?: (accountId: string, groupLabel: string | null) => void;
  /**
   * 可选：关联群聊引流码就地编辑保存回调（change account-group-chat-injection）。
   * 传入 →「群聊引流」列点击即变多行文本框、失焦保存（**verbatim，不 trim 内容**；全空白=清空，回 null）；
   * 不传 → 该列只读（只读视图不受影响）。/comment group:on 时该码注入评论。
   */
  onEditGroupChat?: (accountId: string, groupChatInfo: string | null) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // 群聊引流码就地编辑：独立状态，绝不与分组编辑共用 editingId（否则同行两列会一起进编辑态）。
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [draftChat, setDraftChat] = useState('');
  const rows = severitySorted ? [...accounts].sort((a, b) => severityRank(a) - severityRank(b)) : accounts;

  // 跨账号「同码」检测（change account-group-chat-injection）：同一串非空码配到多个账号 = 引流指纹，给告警提示。
  const codeCounts = new Map<string, number>();
  for (const a of accounts) {
    if (a.groupChatInfo) codeCounts.set(a.groupChatInfo, (codeCounts.get(a.groupChatInfo) ?? 0) + 1);
  }
  const isDupCode = (c: string | null): boolean => !!c && (codeCounts.get(c) ?? 0) > 1;
  const codePreview = (c: string): string => {
    const oneLine = c.replace(/\s+/g, ' ').trim();
    return oneLine.length > 16 ? `${oneLine.slice(0, 16)}…` : oneLine;
  };

  const beginEditChat = (r: PanelAccount) => {
    setEditingChatId(r.accountId);
    setDraftChat(r.groupChatInfo ?? '');
  };
  // 非乐观 + verbatim：仅值变化才下发；全空白 → 清空（null），否则原样（不 trim 内容，保留 emoji/换行/首尾空白）。
  const commitChat = (r: PanelAccount) => {
    if (editingChatId !== r.accountId) return;
    setEditingChatId(null);
    const prev = r.groupChatInfo ?? '';
    if (draftChat !== prev) onEditGroupChat?.(r.accountId, draftChat.trim() === '' ? null : draftChat);
  };

  const beginEdit = (r: PanelAccount) => {
    setEditingId(r.accountId);
    setDraft(r.groupLabel ?? '');
  };
  // 非乐观：仅当值变化才下发（trim 后空 = 清空 → null）；提交即退出编辑，回车+失焦的 double-commit 由 editingId 守卫幂等。
  const commit = (r: PanelAccount) => {
    if (editingId !== r.accountId) return;
    setEditingId(null);
    const next = draft.trim();
    const prev = r.groupLabel ?? '';
    if (next !== prev) onEditGroup?.(r.accountId, next === '' ? null : next);
  };

  // 「分组」列：传 onEditGroup → 点击即编辑（复用通知联系人页 .editable-cell 模式）；否则纯文本（read-only 零回归）。
  const groupColumn: ColumnsType<PanelAccount>[number] = onEditGroup
    ? {
        title: '分组',
        key: 'groupLabel',
        render: (_, r) =>
          editingId === r.accountId ? (
            <Input
              size="small"
              autoFocus
              value={draft}
              maxLength={64}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(r)}
              onPressEnter={() => commit(r)}
              placeholder="分组名，留空清除"
              style={{ fontSize: 12 }}
            />
          ) : (
            <div className="editable-cell" onClick={() => beginEdit(r)} title="点击编辑">
              {r.groupLabel ? (
                <Typography.Text style={{ fontSize: 12 }}>{r.groupLabel}</Typography.Text>
              ) : (
                dash
              )}
            </div>
          ),
      }
    : { title: '分组', dataIndex: 'groupLabel', render: (v: string | null) => v ?? dash };

  const baseCols: ColumnsType<PanelAccount> = columns.map((c) =>
    (c as { dataIndex?: string }).dataIndex === 'groupLabel' ? groupColumn : c,
  );

  // 「群聊引流」列：传 onEditGroupChat → 点击即编辑（多行文本框，verbatim）；否则只读（read-only 零回归，不加列）。
  const groupChatColumn: ColumnsType<PanelAccount>[number] | null = onEditGroupChat
    ? {
        title: '群聊引流',
        key: 'groupChatInfo',
        render: (_, r) =>
          editingChatId === r.accountId ? (
            <Input.TextArea
              size="small"
              autoFocus
              autoSize={{ minRows: 2, maxRows: 8 }}
              value={draftChat}
              onChange={(e) => setDraftChat(e.target.value)}
              onBlur={() => commitChat(r)}
              placeholder="粘贴群聊引流码（原样保存，含 emoji/换行）；留空清除"
              style={{ minWidth: 240 }}
            />
          ) : r.groupChatInfo ? (
            <div className="editable-cell" onClick={() => beginEditChat(r)} title="点击编辑群聊引流码">
              <Space size={4} wrap>
                <Tag color="green">已配</Tag>
                {isDupCode(r.groupChatInfo) && <Tag color="warning">多账号同码</Tag>}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {codePreview(r.groupChatInfo)}
                </Typography.Text>
              </Space>
            </div>
          ) : (
            <div className="editable-cell" onClick={() => beginEditChat(r)} title="点击设置群聊引流码">
              {dash}
            </div>
          ),
      }
    : null;

  const withGroupChat: ColumnsType<PanelAccount> = groupChatColumn ? [...baseCols, groupChatColumn] : baseCols;
  const cols: ColumnsType<PanelAccount> = actionsColumn
    ? [...withGroupChat, { title: '操作', key: 'actions', render: (_, r) => actionsColumn(r) }]
    : withGroupChat;
  return (
    <Table
      size="small"
      bordered
      rowKey="accountId"
      loading={loading}
      pagination={false}
      columns={cols}
      dataSource={rows}
    />
  );
}
