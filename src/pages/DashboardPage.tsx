import { Alert, Button, Card, Col, Empty, List, Popconfirm, Row, Statistic, Tag, Typography } from 'antd';
import { useDashboardSummary, useResolveAlert } from '../api/queries';
import { AccountsTable, AccountTotalsTable, AlertSeverityBadge, DispatchControl, ProfileLink } from '../components';
import { makeAccountNamer } from '../types/accountDisplay';
import type { DashboardSummary } from '../types/api';

const METRICS: { key: string; get: (s: DashboardSummary) => number }[] = [
  { key: '浏览', get: (s) => s.totals.view },
  { key: '点赞', get: (s) => s.totals.like },
  { key: '收藏', get: (s) => s.totals.collect },
  { key: '评论', get: (s) => s.totals.comment },
  { key: '关注', get: (s) => s.totals.follow },
  { key: '发布', get: (s) => s.totals.publish },
];

function pct(rate: number | null): string {
  return rate == null ? '暂无' : `${Math.round(rate * 100)}%`;
}

/** 一行健康判词（5 秒回答"谁需要我"）。 */
function healthLine(s: DashboardSummary): string {
  const total = s.accounts.length;
  const warned = s.accounts.filter((a) => a.riskStatus === 'warned').length;
  const bad = s.accounts.filter((a) => a.riskStatus === 'restricted' || a.riskStatus === 'frozen').length;
  const band = s.likeRate.healthy == null ? '' : s.likeRate.healthy ? '健康' : '超出区间';
  return `${s.edgesOnline} 个边缘端在线 · ${total} 个账号 · ${warned} 个预警 · ${bad} 个受限/冻结 · 点赞率 ${pct(s.likeRate.rate)} ${band}`;
}

/** 数据看板首页（design PAGE 3）：今日数据 + 账号状态一览（按级别排序）+ 调度引擎 + 告警 + 真按账号切片。 */
export function DashboardPage() {
  const { data, isLoading, isError, refetch } = useDashboardSummary();
  const resolveAlert = useResolveAlert();
  // 告警条目账号名走统一诚实回落（真名→运营名→ID）：告警只带 accountId，真名从同份汇总的账号列表 join。
  const nameOf = makeAccountNamer(data?.accounts ?? []);

  return (
    <div className="page-stack">
      {isError && (
        <Alert
          type="error"
          showIcon
          message="加载数据看板汇总失败"
          action={
            <Button size="small" onClick={() => void refetch()}>
              重试
            </Button>
          }
        />
      )}

      <Card size="small">
        <Row align="middle" gutter={16}>
          <Col flex="auto">{data && <Typography.Text>{healthLine(data)}</Typography.Text>}</Col>
          {/* V1 task 10.2：全局调度引擎启停（接 9.4 /dispatch；非乐观、回报真实在线 edge 数）。 */}
          <Col>
            <DispatchControl active={data?.dispatchActive ?? null} />
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col>
          <Card size="small" loading={isLoading}>
            <Statistic title="在线边缘端" value={data?.edgesOnline ?? 0} />
          </Card>
        </Col>
        {METRICS.map((m) => (
          <Col key={m.key}>
            <Card size="small" loading={isLoading}>
              <Statistic title={m.key} value={data ? m.get(data) : 0} />
            </Card>
          </Col>
        ))}
        <Col>
          <Card size="small" loading={isLoading}>
            <Statistic title="点赞率（全局）" value={pct(data?.likeRate.rate ?? null)} />
            {data?.likeRate.healthy != null && (
              <Tag color={data.likeRate.healthy ? 'green' : 'gold'}>
                {data.likeRate.healthy ? '健康 15-35%' : '超出区间'}
              </Tag>
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" title="各账号状态（按级别排序）">
        {data && data.accounts.length > 0 ? (
          <AccountsTable accounts={data.accounts} loading={isLoading} severitySorted />
        ) : (
          <Empty description={isLoading ? '加载中…' : '暂无账号'} />
        )}
      </Card>

      {/* V1 task 9.6：真按账号今日计数切片（归因已流通，不再「归因待补」）。 */}
      <Card size="small" title="按账号·今日">
        <AccountTotalsTable rows={data?.totalsByAccount ?? []} accounts={data?.accounts ?? []} loading={isLoading} />
      </Card>

      {/* V1 task 9.5：真未解决告警。 */}
      <Card size="small" title={`告警（未解决 · ${data?.alerts.length ?? 0}）`}>
        {data && data.alerts.length > 0 ? (
          <List
            size="small"
            dataSource={data.alerts}
            renderItem={(a) => (
              <List.Item
                actions={[
                  <Popconfirm
                    key="resolve"
                    title="标记该告警为已解决？"
                    description="仅从未解决列表移除，不影响账号风控状态或边缘暂停。"
                    okText="解决"
                    cancelText="取消"
                    onConfirm={() => resolveAlert.mutate(a.id)}
                  >
                    <Button
                      type="link"
                      size="small"
                      loading={resolveAlert.isPending && resolveAlert.variables === a.id}
                    >
                      解决
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <AlertSeverityBadge severity={a.severity} />
                <Typography.Text style={{ marginRight: 8 }}>{a.title}</Typography.Text>
                {a.accountId && (
                  <Typography.Text type="secondary" style={{ marginRight: 8 }}>
                    <ProfileLink userId={a.accountId}>{nameOf(a.accountId)}</ProfileLink>
                  </Typography.Text>
                )}
                <Typography.Text type="secondary">{new Date(a.createdAt).toLocaleString()}</Typography.Text>
              </List.Item>
            )}
          />
        ) : (
          <Empty description={isLoading ? '加载中…' : '暂无未解决告警'} />
        )}
      </Card>
    </div>
  );
}
