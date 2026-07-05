import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, App, Button, Card, DatePicker, Empty, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import dayjs, { type Dayjs } from 'dayjs';
import { useLlmUsage, useAccounts, useRefreshLlmUsagePrices } from '../api/queries';
import { ProfileLink } from '../components';
import { QueryError } from '../components/QueryGate';
import { makeAccountNamer } from '../types/accountDisplay';
import type { LlmUsageRow } from '../types/api';
import { roleLabel } from '../types/usageLabels';

const { RangePicker } = DatePicker;

/** 把 UTC epoch ms 显式按北京时间（+08:00）格式化，不依赖浏览器本地时区（design D4）。 */
function fmtBeijing(ms: number): string {
  const d = new Date(ms + 8 * 3600 * 1000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const fmtNum = (n: number): string => n.toLocaleString('zh-CN');

const fmtCost = (amount: number, currency: string): string => {
  const text = amount.toLocaleString('zh-CN', {
    minimumFractionDigits: amount >= 1 ? 2 : 4,
    maximumFractionDigits: amount >= 1 ? 2 : 4,
  });
  return currency === 'CNY' ? `¥${text}` : `${currency} ${text}`;
};

const providerLabel: Record<string, { text: string; color: string }> = {
  dashscope: { text: '百炼', color: 'blue' },
  volcengine: { text: '火山', color: 'volcano' },
  unknown: { text: '未知', color: 'default' },
};

const billingCredentialLabel: Record<string, string> = {
  aliyun: '阿里云账单凭据',
  dashscope: '阿里云账单凭据',
  volcengine: '火山账单凭据',
};

function providerTag(provider: string) {
  return providerLabel[provider] ?? { text: provider, color: 'default' };
}

function distinct(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

/**
 * token 用量统计页（change llm-token-usage-stats）。
 * 维度：日期 / 账号 / 角色 / 模型 / token 量。表格 + 每 10 分钟单条总量曲线（受筛选器约束）。
 * 账号今天单值 default（单租户）；多账号上线后自动按真实账号拆分。
 */
export function TokenUsagePage() {
  const { message } = App.useApp();
  // 默认窗：近 24 小时（曲线 144 桶）。
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().subtract(24, 'hour'), dayjs()]);
  // #17：账号筛选进 URL query（?account=<id>），可分享/刷新保持；清空/全部时删除该参数（其它 query 保留）。
  const [searchParams, setSearchParams] = useSearchParams();
  const accountId = searchParams.get('account') ?? undefined;
  const setAccountId = (id: string | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('account', id);
    else next.delete('account');
    setSearchParams(next);
  };
  const [role, setRole] = useState<string | undefined>();
  const [model, setModel] = useState<string | undefined>();

  // 账号展示名走统一诚实回落（真名→运营名→ID）：用量行只带 accountId，真名从账号列表 join 取。
  const { data: accountsData } = useAccounts();
  const nameOf = makeAccountNamer(accountsData?.accounts ?? []);

  const fromMs = range[0]?.valueOf();
  const toMs = range[1]?.valueOf();

  // 选项用「同窗、不带账号/角色/模型过滤」的查询，使下拉选项稳定（不被当前选中收窄）。
  // 无过滤时与下方展示查询同 key，react-query 自动去重不多打一次。
  const optionsQuery = useLlmUsage({ fromMs, toMs });
  const displayQuery = useLlmUsage({ fromMs, toMs, accountId, role, model });
  const refreshPrices = useRefreshLlmUsagePrices();

  const optionRows = optionsQuery.data?.rows ?? [];
  const accountOptions = useMemo(
    () => distinct(optionRows.map((r) => r.accountId)).map((id) => ({ value: id, label: nameOf(id) })),
    [optionRows, accountsData],
  );
  const roleOptions = useMemo(
    () => distinct(optionRows.map((r) => r.role)).map((t) => ({ value: t, label: roleLabel(t) })),
    [optionRows],
  );
  const modelOptions = useMemo(
    () => distinct(optionRows.map((r) => r.model)).map((m) => ({ value: m, label: m })),
    [optionRows],
  );

  const rows = displayQuery.data?.rows ?? [];
  const buckets = displayQuery.data?.buckets ?? [];
  const clampedToDays = displayQuery.data?.window.clampedToDays ?? null;

  const chartOption: EChartsOption = useMemo(
    () => ({
      tooltip: { trigger: 'axis' },
      grid: { left: 56, right: 20, top: 24, bottom: 64 },
      xAxis: {
        type: 'category',
        data: buckets.map((b) => fmtBeijing(b.bucketMs)),
        axisLabel: { rotate: 45, fontSize: 11 },
      },
      yAxis: { type: 'value', name: 'token' },
      series: [
        {
          name: '总 token',
          type: 'line',
          smooth: true,
          showSymbol: false,
          areaStyle: {},
          data: buckets.map((b) => b.totalTokens),
        },
      ],
    }),
    [buckets],
  );

  const columns: ColumnsType<LlmUsageRow> = [
    { title: '日期', dataIndex: 'day', width: 110 },
    {
      title: '账号',
      dataIndex: 'accountId',
      width: 150,
      // 账号名可点：跳转其小红书主页（v = accountId = xhs userid）。非真实 id 回落纯文本。
      render: (v: string) => <ProfileLink userId={v}>{nameOf(v)}</ProfileLink>,
    },
    {
      title: '角色',
      dataIndex: 'role',
      render: (v: string) => <Tag>{roleLabel(v)}</Tag>,
    },
    {
      title: '模型',
      dataIndex: 'model',
      width: 260,
      render: (_: string, r: LlmUsageRow) => {
        const p = providerTag(r.provider);
        return (
          <Space size={4} wrap>
            <Tag color={p.color}>{p.text}</Tag>
            <Typography.Text className="tabular-nums">{r.model}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '输入 token',
      dataIndex: 'promptTokens',
      align: 'right' as const,
      render: (v: number) => fmtNum(v),
    },
    {
      title: '输出 token',
      dataIndex: 'completionTokens',
      align: 'right' as const,
      render: (v: number) => fmtNum(v),
    },
    {
      title: '总 token',
      dataIndex: 'totalTokens',
      align: 'right' as const,
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.totalTokens - b.totalTokens,
      render: (v: number) => <Typography.Text strong>{fmtNum(v)}</Typography.Text>,
    },
    {
      title: '预估成本',
      dataIndex: 'costEstimate',
      align: 'right' as const,
      width: 130,
      render: (_: LlmUsageRow['costEstimate'], r: LlmUsageRow) => {
        const cost = r.costEstimate;
        if (!cost) {
          return (
            <Tooltip title="还没有该厂商/模型的账单反推定价，点击“更新厂商模型定价”获取后再估算">
              <Typography.Text type="secondary">待账单</Typography.Text>
            </Tooltip>
          );
        }
        const basis = cost.pricingBasis === 'input_output_tokens' ? '输入/输出 token' : '总 token';
        const synced = cost.syncedAtMs ? `；同步：${fmtBeijing(cost.syncedAtMs)}` : '';
        return (
          <Tooltip title={`账单来源：${cost.source}；账期：${cost.sourceDate}；口径：${basis}${synced}`}>
            <Typography.Text strong>{fmtCost(cost.amount, cost.currency)}</Typography.Text>
          </Tooltip>
        );
      },
    },
    {
      title: '调用次数',
      dataIndex: 'calls',
      align: 'right' as const,
      sorter: (a, b) => a.calls - b.calls,
      render: (_: number, r: LlmUsageRow) => {
        const failed = r.calls - r.okCalls;
        return (
          <span>
            {fmtNum(r.calls)}
            {failed > 0 ? <Typography.Text type="danger">（失败 {fmtNum(failed)}）</Typography.Text> : null}
          </span>
        );
      },
    },
  ];

  const handleRefreshPrices = () => {
    refreshPrices.mutate(undefined, {
      onSuccess: (result) => {
        const missingLabels = Array.from(new Set(result.missingCredentials.map((key) => billingCredentialLabel[key] ?? key)));
        const missing = missingLabels.length ? `；缺少凭据：${missingLabels.join('、')}` : '';
        const skipped = result.skipped.length ? `；跳过 ${result.skipped.length} 个模型日` : '';
        message.success(`厂商模型定价已更新：写入 ${result.written} 条，检查 ${result.targetCount} 个模型日${skipped}${missing}`);
      },
      onError: () => message.error('更新厂商模型定价失败'),
    });
  };

  return (
    <div className="page-stack">
      <Card size="small" title="筛选">
        <Space wrap>
          <RangePicker
            showTime
            value={range}
            onChange={(v) => {
              if (v && v[0] && v[1]) setRange([v[0], v[1]]);
            }}
            allowClear={false}
          />
          <Select
            allowClear
            placeholder="账号（全部）"
            style={{ width: 200 }}
            value={accountId}
            onChange={setAccountId}
            options={accountOptions}
          />
          <Select
            allowClear
            placeholder="角色（全部）"
            style={{ width: 180 }}
            value={role}
            onChange={setRole}
            options={roleOptions}
          />
          <Select
            allowClear
            placeholder="模型（全部）"
            style={{ width: 180 }}
            value={model}
            onChange={setModel}
            options={modelOptions}
          />
          <Tooltip title="按需查询 T-1/T-2 账单，反推出厂商/模型 token 收费标准；没有新样本时沿用历史价格">
            <Button icon={<SyncOutlined />} loading={refreshPrices.isPending} onClick={handleRefreshPrices}>
              更新厂商模型定价
            </Button>
          </Tooltip>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          账号维度当前为单租户（仅「默认账号」）；多账号上线后将按真实账号拆分。曲线时间轴为北京时间。
        </Typography.Paragraph>
        {clampedToDays != null ? (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 8 }}
            message={`所选区间超过 ${clampedToDays} 天上限，已收窄到最近 ${clampedToDays} 天。`}
          />
        ) : null}
      </Card>

      <Card size="small" title="token 消耗曲线（每 10 分钟 · 总量）">
        {buckets.length > 0 ? (
          <ReactECharts option={chartOption} style={{ height: 320 }} notMerge />
        ) : displayQuery.isError ? (
          <QueryError title="加载 token 用量失败" onRetry={() => displayQuery.refetch()} />
        ) : (
          <Empty description={displayQuery.isLoading ? '加载中…' : '该时间段暂无数据'} />
        )}
      </Card>

      <Card size="small" title="token 消耗明细（日期 / 账号 / 角色 / 模型）">
        {rows.length > 0 ? (
          <Table
            size="small"
            bordered
            rowKey={(r) => `${r.day}|${r.accountId}|${r.role}|${r.provider}|${r.model}`}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            columns={columns}
            dataSource={rows}
            loading={displayQuery.isLoading}
            scroll={{ x: 1180 }}
          />
        ) : displayQuery.isError ? (
          <QueryError title="加载 token 用量失败" onRetry={() => displayQuery.refetch()} />
        ) : (
          <Empty description={displayQuery.isLoading ? '加载中…' : '该时间段暂无数据'} />
        )}
      </Card>
    </div>
  );
}
