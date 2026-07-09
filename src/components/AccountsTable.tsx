import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AutoComplete, Input, Space, Table, Tag, Typography } from 'antd';
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

// 平台展示（拆分不同平台）。platform 为自由字符串（cloud accounts.platform 事实源）：xiaohongshu / facebook。
const PLATFORM_LABEL: Record<string, string> = { xiaohongshu: '小红书', facebook: 'Facebook' };
const PLATFORM_COLOR: Record<string, string> = { xiaohongshu: 'magenta', facebook: 'blue' };

const viewsColumn: ColumnsType<PanelAccount>[number] = {
  // #17：站内深链——一键跳到该账号在其它页的视图，带 ?account=<id> 深链（各页读 URL 预置账号筛选）。
  // 与「账号名」的站外小红书主页 ProfileLink 互不影响：那是外链，这是站内导航。
  title: '站内视图',
  key: 'views',
  width: 172,
  render: (_, r) => {
    const acc = encodeURIComponent(r.accountId);
    // 站内导航做成「胶囊按钮」而非裸文本链接：静息即有描边+浅底、悬停高亮，一眼可点（近黑品牌不变）。
    return (
      <Space size={4} style={{ whiteSpace: 'nowrap' }}>
        <Link className="table-link-chip" to={`/content?account=${acc}`}>内容</Link>
        <Link className="table-link-chip" to={`/usage?account=${acc}`}>用量</Link>
        <Link className="table-link-chip" to={`/notification-contacts?account=${acc}`}>联系人</Link>
      </Space>
    );
  },
};

const columns: ColumnsType<PanelAccount> = [
  {
    title: '平台',
    dataIndex: 'platform',
    width: 92,
    filters: [
      { text: '小红书', value: 'xiaohongshu' },
      { text: 'Facebook', value: 'facebook' },
    ],
    onFilter: (value, r) => r.platform === value,
    render: (p: string) => <Tag color={PLATFORM_COLOR[p] ?? 'default'}>{PLATFORM_LABEL[p] ?? p}</Tag>,
  },
  {
    title: '账号',
    key: 'account',
    // 账号名是主标识、原为无宽度弹性列被右侧诸列挤到折行；给固定宽度 + 省略号截断（避免换行的表格设计标准），过长悬停看全名。
    width: 200,
    ellipsis: { showTitle: false },
    // 账号名可点：仅小红书账号跳其站外主页（accountId = 登录派生的 xhs userid）；其它平台回落纯文本，绝不出死链。
    render: (_, r) => {
      const name = accountDisplayName(r.nickname, r.label, r.accountId);
      return r.platform === 'xiaohongshu' ? (
        <ProfileLink userId={r.accountId}>{name}</ProfileLink>
      ) : (
        <span title={name}>{name}</span>
      );
    },
  },
  {
    title: '人设',
    key: 'persona',
    width: 84,
    // 标签去掉冗余「人设」后缀（列头已是「人设」；避免换行的表格设计标准）：
    // 未绑（非 default）→「需设置」橙标 + 跳转人设页；已绑 → 绿标「已绑」；default 豁免 → 中性「默认」。
    render: (_, r) =>
      r.needsPersonaSetup ? (
        <Link to="/persona">
          <Tag color="warning">需设置</Tag>
        </Link>
      ) : r.personaBound ? (
        <Tag color="green">已绑</Tag>
      ) : (
        <Tag>默认</Tag>
      ),
  },
  { title: '分组', dataIndex: 'groupLabel', render: (v: string | null) => v ?? dash },
  {
    // 列头「状态」= 运营开关（运行中 / 运营已暂停），与验证码暂停、风控态相互独立。
    title: '状态',
    dataIndex: 'operatorStatus',
    width: 90,
    // 运营暂停态，区别于验证码暂停（不共用一个含糊 paused 徽标）
    render: (v: 'active' | 'paused') =>
      v === 'paused' ? <Tag>{OPERATOR_STATUS_LABEL.paused}</Tag> : <Tag color="green">{OPERATOR_STATUS_LABEL.active}</Tag>,
  },
  {
    // 列头即消歧（原「风控状态」→「风控」，徽标不再带「状态：」前缀；避免换行的表格设计标准）
    title: '风控',
    dataIndex: 'riskStatus',
    width: 96,
    // 两个独立徽标之一：风控 STATUS（暖色实底）
    render: (v: RiskStatus | null) => (v ? <RiskStatusBadge status={v} /> : dash),
  },
  {
    // 列头即消歧（原「配额档位」→「档位」，徽标不再带「档位：」前缀；避免换行的表格设计标准）
    title: '档位',
    key: 'tier',
    width: 88,
    // 两个独立徽标之二：风控 QUOTA-TIER 冷色描边（与 status 永不合并）
    render: (_, r) => (r.riskQuotaLevel ? <QuotaTierBadge tier={r.riskQuotaLevel} /> : dash),
  },
  { title: '信号', dataIndex: 'signalCount', width: 76, render: (v: number | null) => v ?? dash },
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

  // 已有分组备选（去重 + 排序）：供就地编辑下拉「选已存在的分组」，同时仍可自由输入新名（AutoComplete）。
  const groupOptions = Array.from(
    new Set(accounts.map((a) => a.groupLabel?.trim()).filter((g): g is string => !!g)),
  )
    .sort((a, b) => a.localeCompare(b, 'zh'))
    .map((g) => ({ value: g }));

  const beginEdit = (r: PanelAccount) => {
    setEditingId(r.accountId);
    setDraft(r.groupLabel ?? '');
  };
  // 非乐观：仅当值变化才下发（trim 后空 = 清空 → null）；提交即退出编辑，回车+失焦+选项点击的 double-commit 由 editingId 守卫幂等。
  const commitGroup = (r: PanelAccount, raw: string) => {
    if (editingId !== r.accountId) return;
    setEditingId(null);
    const next = raw.trim();
    const prev = r.groupLabel ?? '';
    if (next !== prev) onEditGroup?.(r.accountId, next === '' ? null : next);
  };
  const commit = (r: PanelAccount) => commitGroup(r, draft);

  // 「分组」列：传 onEditGroup → 点击即编辑（复用通知联系人页 .editable-cell 模式）；否则纯文本（read-only 零回归）。
  const groupColumn: ColumnsType<PanelAccount>[number] = onEditGroup
    ? {
        title: '分组',
        key: 'groupLabel',
        width: 80,
        render: (_, r) =>
          editingId === r.accountId ? (
            // 点击即下拉选「已存在分组」，也可直接键入新名；选项点击→即刻提交，回车/失焦兜底提交。
            <AutoComplete
              size="small"
              autoFocus
              value={draft}
              options={groupOptions}
              // 输入即过滤备选（大小写不敏感 contains）；无匹配则只保留自由输入。
              filterOption={(input, option) =>
                (option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())
              }
              // 下拉不强制与窄列同宽，保证分组名可读（列已收窄到 80）。
              popupMatchSelectWidth={false}
              onChange={(v) => setDraft(v.slice(0, 64))}
              onSelect={(v: string) => commitGroup(r, v)}
              onBlur={() => commit(r)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(r);
              }}
              placeholder="选择或输入分组名，留空清除"
              style={{ width: '100%', fontSize: 12 }}
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
    : { title: '分组', dataIndex: 'groupLabel', width: 80, render: (v: string | null) => v ?? dash };

  const baseCols: ColumnsType<PanelAccount> = columns.map((c) =>
    (c as { dataIndex?: string }).dataIndex === 'groupLabel' ? groupColumn : c,
  );

  // 「群聊引流」列：传 onEditGroupChat → 点击即编辑（多行文本框，verbatim）；否则只读（read-only 零回归，不加列）。
  const groupChatColumn: ColumnsType<PanelAccount>[number] | null = onEditGroupChat
    ? {
        title: '群聊引流',
        key: 'groupChatInfo',
        width: 104,
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
            // 只展示标签、不展示群聊引流码正文（原文可能含 emoji/换行/长文，列宽收窄后不再内联预览）。
            <div className="editable-cell" onClick={() => beginEditChat(r)} title="点击编辑群聊引流码">
              <Space size={4} wrap>
                <Tag color="green">已配</Tag>
                {isDupCode(r.groupChatInfo) && <Tag color="warning">多账号同码</Tag>}
              </Space>
            </div>
          ) : (
            // 未配置：给一个可点的「点击配置」标签（替代裸破折号），点击即进编辑态。
            <div className="editable-cell" onClick={() => beginEditChat(r)} title="点击设置群聊引流码">
              <Tag color="blue" style={{ cursor: 'pointer' }}>点击配置</Tag>
            </div>
          ),
      }
    : null;

  const withGroupChat: ColumnsType<PanelAccount> = groupChatColumn ? [...baseCols, groupChatColumn] : baseCols;
  const cols: ColumnsType<PanelAccount> = actionsColumn
    ? [...withGroupChat, viewsColumn, { title: '操作', key: 'actions', render: (_, r) => actionsColumn(r) }]
    : [...withGroupChat, viewsColumn];
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
