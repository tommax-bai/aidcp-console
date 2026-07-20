import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AutoComplete, Input, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RiskStatusBadge } from './RiskStatusBadge';
import { QuotaTierBadge } from './QuotaTierBadge';
import { ProfileLink } from './ProfileLink';
import type { PanelAccount } from '../types/api';
import { OPERATOR_STATUS_LABEL, labelOf, type RiskStatus } from '../types/aidcp-enums';
import { accountDisplayName } from '../types/accountDisplay';

const SEVERITY_ORDER: Record<RiskStatus, number> = { frozen: 0, restricted: 1, warned: 2, normal: 3 };

function severityRank(a: PanelAccount): number {
  return a.riskStatus ? SEVERITY_ORDER[a.riskStatus] : 4;
}

const dash = <Typography.Text type="secondary">—</Typography.Text>;

// 平台展示（拆分不同平台）。platform 为自由字符串（cloud accounts.platform 事实源）。
const PLATFORM_LABEL: Record<string, string> = {
  xiaohongshu: '小红书',
  facebook: 'Facebook',
  wechat_channels: '视频号',
};
const PLATFORM_COLOR: Record<string, string> = {
  xiaohongshu: 'magenta',
  facebook: 'blue',
  wechat_channels: 'green',
};

function platformTag(platform: string) {
  return <Tag color={PLATFORM_COLOR[platform] ?? 'default'}>{labelOf(PLATFORM_LABEL, platform)}</Tag>;
}

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
    width: 96,
    filters: [
      { text: '小红书', value: 'xiaohongshu' },
      { text: 'Facebook', value: 'facebook' },
      { text: '视频号', value: 'wechat_channels' },
    ],
    onFilter: (value, r) => r.platform === value,
    render: (p: string) => platformTag(p),
  },
  {
    title: '账号',
    key: 'account',
    // 账号名主标识：约 7 个字宽即可，超出省略号截断（避免换行的表格设计标准），过长悬停看全名。
    width: 120,
    ellipsis: { showTitle: false },
    // 账号名可点：仅小红书账号跳其站外主页（accountId = 登录派生的 xhs userid）；其它平台回落纯文本，绝不出死链。
    render: (_, r) => {
      const name = accountDisplayName(r);
      const content = <span className={r.displayNameSource === 'operator_alias' ? 'account-name-manual' : undefined}>{name}</span>;
      return r.platform === 'xiaohongshu' ? (
        <ProfileLink userId={r.accountId}>{content}</ProfileLink>
      ) : (
        <span title={name}>{content}</span>
      );
    },
  },
  {
    title: '人设',
    key: 'persona',
    width: 76,
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
    width: 68,
    // 两个独立徽标之一：风控 STATUS（暖色实底）
    render: (v: RiskStatus | null) => (v ? <RiskStatusBadge status={v} /> : dash),
  },
  {
    // 列头即消歧（原「配额档位」→「档位」，徽标不再带「档位：」前缀；避免换行的表格设计标准）
    title: '档位',
    key: 'tier',
    width: 68,
    // 两个独立徽标之二：风控 QUOTA-TIER 冷色描边（与 status 永不合并）
    render: (_, r) => (r.riskQuotaLevel ? <QuotaTierBadge tier={r.riskQuotaLevel} /> : dash),
  },
  { title: '信号', dataIndex: 'signalCount', width: 56, render: (v: number | null) => v ?? dash },
];

export function AccountsTable({
  accounts,
  loading,
  severitySorted = false,
  operatorStatusControl,
  riskStatusControl,
  quotaTierControl,
  platformAddon,
  runtimeControl,
  onEditGroup,
  onEditContact,
}: {
  accounts: PanelAccount[];
  loading?: boolean;
  severitySorted?: boolean;
  /** 账号页把动作归入对应事实列；只读视图不传，保留原徽标。 */
  operatorStatusControl?: (account: PanelAccount) => ReactNode;
  riskStatusControl?: (account: PanelAccount) => ReactNode;
  quotaTierControl?: (account: PanelAccount) => ReactNode;
  /** 平台专属配置入口附着平台标签，不创建通用操作列。 */
  platformAddon?: (account: PanelAccount) => ReactNode;
  /** 视频号账号的具名运行控制列。 */
  runtimeControl?: (account: PanelAccount) => ReactNode;
  /**
   * 可选：分组标签就地编辑保存回调（change editable-account-group-label）。
   * 传入 →「分组」列点击即变输入框、回车/失焦保存（trim 后空 = 清空，回 null）；
   * 不传 →「分组」列保持纯文本（只读视图如仪表盘不受影响）。
   */
  onEditGroup?: (accountId: string, groupLabel: string | null) => void;
  /**
   * 可选：关联联系方式就地编辑保存回调（change account-group-chat-injection）。
   * 传入 →「联系方式」列点击即变多行文本框、失焦保存（**verbatim，不 trim 内容**；全空白=清空，回 null）；
   * 不传 → 该列只读（只读视图不受影响）。联系评论时该联系方式注入评论。
   */
  onEditContact?: (accountId: string, contactInfo: string | null) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // 联系方式就地编辑：独立状态，绝不与分组编辑共用 editingId（否则同行两列会一起进编辑态）。
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [draftContact, setDraftContact] = useState('');
  const rows = severitySorted ? [...accounts].sort((a, b) => severityRank(a) - severityRank(b)) : accounts;

  // 跨账号「同联系方式」检测（change account-group-chat-injection）：同一串非空联系方式配到多个账号 = 引流指纹，给告警提示。
  const contactCounts = new Map<string, number>();
  for (const a of accounts) {
    if (a.contactInfo) contactCounts.set(a.contactInfo, (contactCounts.get(a.contactInfo) ?? 0) + 1);
  }
  const isDupContact = (c: string | null): boolean => !!c && (contactCounts.get(c) ?? 0) > 1;

  const beginEditContact = (r: PanelAccount) => {
    setEditingContactId(r.accountId);
    setDraftContact(r.contactInfo ?? '');
  };
  // 非乐观 + verbatim：仅值变化才下发；全空白 → 清空（null），否则原样（不 trim 内容，保留 emoji/换行/首尾空白）。
  const commitContact = (r: PanelAccount) => {
    if (editingContactId !== r.accountId) return;
    setEditingContactId(null);
    const prev = r.contactInfo ?? '';
    if (draftContact !== prev) onEditContact?.(r.accountId, draftContact.trim() === '' ? null : draftContact);
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

  const baseCols: ColumnsType<PanelAccount> = columns.map((column) => {
    const dataIndex = (column as { dataIndex?: string }).dataIndex;
    const key = (column as { key?: string }).key;
    if (dataIndex === 'groupLabel') return groupColumn;
    if (dataIndex === 'platform' && platformAddon) {
      return { ...column, render: (platform: string, account: PanelAccount) => (
        <Space size={2} wrap={false}>{platformTag(platform)}{platformAddon(account)}</Space>
      ) };
    }
    if (dataIndex === 'operatorStatus' && operatorStatusControl) {
      return { ...column, render: (_: unknown, account: PanelAccount) => operatorStatusControl(account) };
    }
    if (dataIndex === 'riskStatus' && riskStatusControl) {
      return { ...column, render: (_: unknown, account: PanelAccount) => riskStatusControl(account) };
    }
    if (key === 'tier' && quotaTierControl) {
      return { ...column, render: (_: unknown, account: PanelAccount) => quotaTierControl(account) };
    }
    return column;
  });

  // 「联系方式」列：传 onEditContact → 点击即编辑（多行文本框，verbatim）；否则只读（read-only 零回归，不加列）。
  const contactColumn: ColumnsType<PanelAccount>[number] | null = onEditContact
    ? {
        title: '联系方式',
        key: 'contactInfo',
        width: 104,
        render: (_, r) =>
          editingContactId === r.accountId ? (
            <Input.TextArea
              size="small"
              autoFocus
              autoSize={{ minRows: 2, maxRows: 8 }}
              value={draftContact}
              onChange={(e) => setDraftContact(e.target.value)}
              onBlur={() => commitContact(r)}
              placeholder="粘贴联系方式（原样保存，含 emoji/换行）；留空清除"
              style={{ minWidth: 240 }}
            />
          ) : r.contactInfo ? (
            // 只展示标签、不展示联系方式正文（原文可能含 emoji/换行/长文，列宽收窄后不再内联预览）。
            <div className="editable-cell" onClick={() => beginEditContact(r)} title="点击编辑联系方式">
              <Space size={4} wrap>
                <Tag color="green">已配</Tag>
                {isDupContact(r.contactInfo) && <Tag color="warning">复用</Tag>}
              </Space>
            </div>
          ) : (
            // 未配置：给一个可点的「点击配置」标签（替代裸破折号），点击即进编辑态。
            <div className="editable-cell" onClick={() => beginEditContact(r)} title="点击设置联系方式">
              <Tag color="blue" style={{ cursor: 'pointer' }}>点击配置</Tag>
            </div>
          ),
      }
    : null;

  const withContactColumn: ColumnsType<PanelAccount> = contactColumn ? [...baseCols, contactColumn] : baseCols;
  const runtimeColumn: ColumnsType<PanelAccount>[number] | null = runtimeControl
    ? { title: '运行控制', key: 'runtimeControl', width: 92, render: (_, account) => runtimeControl(account) }
    : null;
  const cols: ColumnsType<PanelAccount> = [
    ...withContactColumn,
    ...(runtimeColumn ? [runtimeColumn] : []),
    viewsColumn,
  ];
  return (
    <Table
      size="small"
      bordered
      rowKey="accountId"
      loading={loading}
      pagination={false}
      columns={cols}
      dataSource={rows}
      // 列多于视口时整表横向滚动；账号页不再创建通用“操作”列。
      scroll={{ x: 'max-content' }}
    />
  );
}
