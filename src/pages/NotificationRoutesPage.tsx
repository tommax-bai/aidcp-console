import { useMemo } from 'react';
import { App, Alert, Card, Select, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../api/client';
import { useAccounts, useApprovalPolicies, useNotificationRoutes, useBotChats } from '../api/queries';
import { QueryError } from '../components/QueryGate';
import type {
  GroupPublishApprovalDelivery,
  GroupPublishApprovalPolicy,
  PanelGroupRoute,
  PanelBotChat,
} from '../types/api';

/**
 * 通知路由页（change feishu-per-team-notification-routing）。
 * - 账号按分组标签 `group_label` 归团队；每个团队映射到一个飞书群（可为对外共享的客户外部群）。
 * - 账号的「评论 / @」入站通知按此路由到对应群；未映射 / 映射不到 → 落默认群（绝不静默丢）。
 * - 目标只能从「机器人当前所在群」里选（opaque chat_id，非枚举）——杜绝手贴 raw chat_id 贴错群（→ 跨客户 PII 泄漏）。
 * - 来源会话优先；无来源会话时按账号团队群，再回落默认群。
 */

interface RouteRow {
  groupLabel: string;
  accountCount: number;
  chatId: string | null;
  route: PanelGroupRoute | null;
  delivery: GroupPublishApprovalDelivery;
  activeAccountCount: number;
  reachableAccountCount: number;
}

function chatOptionLabel(c: PanelBotChat): string {
  const name = c.name?.trim() || c.chatId;
  return `${name}${c.isDefault ? '（默认群）' : ''}`;
}

/** 群的人类可读名（有真实群名用名，否则回落 chatId）。 */
function chatDisplayName(chatId: string | null, chats: PanelBotChat[]): string {
  if (!chatId) return '（未设置）';
  return chats.find((c) => c.chatId === chatId)?.name?.trim() || chatId;
}

export function NotificationRoutesPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const routes = useNotificationRoutes();
  const botChats = useBotChats();
  const approvalPolicies = useApprovalPolicies();

  // 非乐观：round-trip 后拉真态，诚实文案（对齐 group-label 编辑）。
  const save = useMutation({
    mutationFn: (v: { groupLabel: string; chatId: string | null }) =>
      apiPut<{ route: PanelGroupRoute | null }>('/api/notification/routes', { groupLabel: v.groupLabel, chatId: v.chatId }),
    onSuccess: (res) => {
      message.success(res.route ? `已映射到目标群` : '已清除映射（该团队通知落默认群）');
      void qc.invalidateQueries({ queryKey: ['notification', 'routes'] });
    },
    onError: () => message.error('保存失败，请重试'),
  });

  const saveDelivery = useMutation({
    mutationFn: (v: { groupLabel: string; delivery: GroupPublishApprovalDelivery }) =>
      apiPut<{ policy: GroupPublishApprovalPolicy }>('/api/approval-policies/group-publish', v),
    onSuccess: (res) => {
      message.success(res.policy.delivery === 'client_only' ? '已设置为仅客户端审核' : '已恢复客户端 + 飞书双入口');
      void qc.invalidateQueries({ queryKey: ['approval-policies'] });
    },
    onError: () => message.error('稿件审核入口保存失败，当前真态未改变'),
  });

  const rows = useMemo<RouteRow[]>(() => {
    const routeByLabel = new Map<string, PanelGroupRoute>();
    for (const r of routes.data?.routes ?? []) routeByLabel.set(r.groupLabel, r);
    const policyByLabel = new Map<string, GroupPublishApprovalPolicy>();
    for (const policy of approvalPolicies.data?.groups ?? []) policyByLabel.set(policy.groupLabel, policy);
    // 团队键来源：账号的非空 group_label（统计账号数）∪ 已存在的路由键（含无账号的历史遗留，供清理）。
    const counts = new Map<string, number>();
    for (const a of accounts.data?.accounts ?? []) {
      const key = (a.groupLabel ?? '').trim();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const labels = new Set<string>([...counts.keys(), ...routeByLabel.keys(), ...policyByLabel.keys()]);
    return [...labels]
      .sort((a, b) => a.localeCompare(b))
      .map((groupLabel) => {
        const route = routeByLabel.get(groupLabel) ?? null;
        const policy = policyByLabel.get(groupLabel);
        return {
          groupLabel,
          accountCount: counts.get(groupLabel) ?? 0,
          chatId: route?.chatId ?? null,
          route,
          delivery: policy?.delivery ?? 'client_and_feishu',
          activeAccountCount: policy?.activeAccountCount ?? 0,
          reachableAccountCount: policy?.reachableAccountCount ?? 0,
        };
      });
  }, [accounts.data, routes.data, approvalPolicies.data]);

  if (routes.isError) return <QueryError title="通知路由加载失败" onRetry={() => void routes.refetch()} />;

  const chats = botChats.data?.chats ?? [];
  const optionsFor = (currentChatId: string | null) => {
    const opts = chats.map((c) => ({ label: chatOptionLabel(c), value: c.chatId }));
    // 当前映射的群已不在机器人所在群清单里（机器人退群 / 群失效）→ 显式列出"未知群"，让运营看到并可清除。
    if (currentChatId && !chats.some((c) => c.chatId === currentChatId)) {
      opts.unshift({ label: `⚠️ 未知群（${currentChatId}）`, value: currentChatId });
    }
    return opts;
  };

  const columns: ColumnsType<RouteRow> = [
    {
      title: '团队（分组标签）',
      dataIndex: 'groupLabel',
      render: (label: string, row) => (
        <span>
          <Tag color="blue">{label}</Tag>
          {row.accountCount === 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              （无账号 · 可清理）
            </Typography.Text>
          )}
        </span>
      ),
    },
    { title: '账号数', dataIndex: 'accountCount', width: 90 },
    {
      title: '目标飞书群',
      dataIndex: 'chatId',
      width: 340,
      render: (chatId: string | null, row) => (
        <div>
          <Select
            size="small"
            allowClear
            showSearch
            style={{ width: '100%', minWidth: 260 }}
            placeholder="未配置 · 落默认群"
            value={chatId ?? undefined}
            options={optionsFor(chatId)}
            optionFilterProp="label"
            loading={botChats.isLoading}
            disabled={save.isPending}
            onChange={(val) => save.mutate({ groupLabel: row.groupLabel, chatId: (val as string | undefined) ?? null })}
          />
          {chatId && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }} copyable={{ text: chatId }}>
              {chatId}
            </Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: '稿件审核入口',
      dataIndex: 'delivery',
      width: 275,
      render: (delivery: GroupPublishApprovalDelivery, row) => {
        const incomplete = row.reachableAccountCount < row.activeAccountCount;
        return (
          <div>
            <Select<GroupPublishApprovalDelivery>
              aria-label={`分组 ${row.groupLabel} 稿件审核入口`}
              size="small"
              style={{ width: 210 }}
              value={delivery}
              disabled={saveDelivery.isPending || approvalPolicies.isLoading}
              options={[
                { value: 'client_and_feishu', label: '客户端 + 飞书' },
                { value: 'client_only', label: '仅客户端' },
              ]}
              onChange={(value) => saveDelivery.mutate({ groupLabel: row.groupLabel, delivery: value })}
            />
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                客户端可审批 {row.reachableAccountCount}/{row.activeAccountCount} 个活跃账号
              </Typography.Text>
            </div>
            {delivery === 'client_only' && incomplete && (
              <Typography.Text type="danger" style={{ fontSize: 11 }}>
                未覆盖账号仍会回退发送飞书卡
              </Typography.Text>
            )}
          </div>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'chatId',
      width: 130,
      render: (chatId: string | null) =>
        chatId ? <Tag color="green">已映射</Tag> : <Tag>落默认群</Tag>,
    },
  ];

  const defaultChatId = botChats.data?.defaultChatId ?? null;
  const defaultGroupName = chatDisplayName(defaultChatId, chats);
  const namesUnavailable = botChats.data?.source === 'store';

  return (
    <Card
      title="通知路由：按团队分发飞书通知"
      extra={<Typography.Text type="secondary">账号 → 分组标签 → 飞书群</Typography.Text>}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={
          <span>
            每个团队的账号「评论 / @」通知投到对应群；未映射的落<strong>默认群：{defaultChatId ? defaultGroupName : '（未设置默认群）'}</strong>、绝不丢。
          </span>
        }
        description="团队键来自账号页的「分组标签」。飞书命令产生的卡优先回命令来源会话；无来源会话的通知、审批卡与账号告警按团队群路由，未命中再落默认群。选择「仅客户端」只抑制客户归属可证账号的无来源稿件按钮卡，不影响评论免审通知、结果、失败、告警或命令回执。"
      />
      {approvalPolicies.isError && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="稿件审核入口策略暂不可用"
          description="路由配置仍可编辑；Cloud 会保守保留飞书稿件审批卡，不会产生隐藏待审稿。"
        />
      )}
      {namesUnavailable && chats.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="暂时无法获取真实群名，正显示群 ID"
          description="请在飞书开发者后台为应用添加「获取群列表」权限 im:chat:readonly，群名即会自动显示（无需改配置）。"
        />
      )}
      {botChats.data && chats.length === 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="机器人当前不在任何群"
          description="请先把机器人拉进目标群（对外共享 / 外部群需先开启对外共享能力），否则无法选择投递目标。"
        />
      )}
      <Table<RouteRow>
        rowKey="groupLabel"
        size="small"
        loading={accounts.isLoading || routes.isLoading || approvalPolicies.isLoading}
        dataSource={rows}
        columns={columns}
        pagination={false}
        locale={{ emptyText: '暂无分组标签。请先在账号页给账号设置「分组标签」以按团队归组。' }}
      />
    </Card>
  );
}
