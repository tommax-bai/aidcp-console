import { useMemo } from 'react';
import { App, Alert, Card, Select, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../api/client';
import { useAccounts, useNotificationRoutes, useBotChats } from '../api/queries';
import { QueryError } from '../components/QueryGate';
import type { PanelGroupRoute, PanelBotChat } from '../types/api';

/**
 * 通知路由页（change feishu-per-team-notification-routing）。
 * - 账号按分组标签 `group_label` 归团队；每个团队映射到一个飞书群（可为对外共享的客户外部群）。
 * - 账号的「评论 / @」入站通知按此路由到对应群；未映射 / 映射不到 → 落默认群（绝不静默丢）。
 * - 目标只能从「机器人当前所在群」里选（opaque chat_id，非枚举）——杜绝手贴 raw chat_id 贴错群（→ 跨客户 PII 泄漏）。
 * - 审批卡 / 运维告警 / 命令回执仍走默认（管理）群，不受本页路由影响。
 */

interface RouteRow {
  groupLabel: string;
  accountCount: number;
  chatId: string | null;
  route: PanelGroupRoute | null;
}

function chatOptionLabel(c: PanelBotChat): string {
  const name = c.chatName?.trim() || c.chatId;
  return `${name}${c.isDefault ? '（默认群）' : ''}`;
}

export function NotificationRoutesPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const routes = useNotificationRoutes();
  const botChats = useBotChats();

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

  const rows = useMemo<RouteRow[]>(() => {
    const routeByLabel = new Map<string, PanelGroupRoute>();
    for (const r of routes.data?.routes ?? []) routeByLabel.set(r.groupLabel, r);
    // 团队键来源：账号的非空 group_label（统计账号数）∪ 已存在的路由键（含无账号的历史遗留，供清理）。
    const counts = new Map<string, number>();
    for (const a of accounts.data?.accounts ?? []) {
      const key = (a.groupLabel ?? '').trim();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const labels = new Set<string>([...counts.keys(), ...routeByLabel.keys()]);
    return [...labels]
      .sort((a, b) => a.localeCompare(b))
      .map((groupLabel) => {
        const route = routeByLabel.get(groupLabel) ?? null;
        return { groupLabel, accountCount: counts.get(groupLabel) ?? 0, chatId: route?.chatId ?? null, route };
      });
  }, [accounts.data, routes.data]);

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
      width: 320,
      render: (chatId: string | null, row) => (
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
      ),
    },
    {
      title: '状态',
      dataIndex: 'chatId',
      width: 130,
      render: (chatId: string | null) =>
        chatId ? <Tag color="green">已映射</Tag> : <Tag>落默认群</Tag>,
    },
  ];

  return (
    <Card
      title="通知路由：按团队分发飞书通知"
      extra={<Typography.Text type="secondary">账号 → 分组标签 → 飞书群</Typography.Text>}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="每个团队的账号「评论 / @」通知投到对应群；未映射的落默认群、绝不丢。"
        description="团队键来自账号的「分组标签」（在账号页编辑）。目标只能从机器人当前所在群里选——请先把机器人拉进该群。审批卡 / 运维告警 / 命令回执仍走默认（管理）群，不受此页影响。"
      />
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
        loading={accounts.isLoading || routes.isLoading}
        dataSource={rows}
        columns={columns}
        pagination={false}
        locale={{ emptyText: '暂无分组标签。请先在账号页给账号设置「分组标签」以按团队归组。' }}
      />
    </Card>
  );
}
