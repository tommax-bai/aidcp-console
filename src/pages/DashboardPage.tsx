import { Alert, Button, Card, Col, Empty, List, Row, Statistic, Tag, Typography } from 'antd';
import { useDashboardSummary } from '../api/queries';
import { AccountsTable, AccountTotalsTable, AlertSeverityBadge, DispatchControl } from '../components';
import type { DashboardSummary } from '../types/api';

const METRICS: { key: string; get: (s: DashboardSummary) => number }[] = [
  { key: 'Views', get: (s) => s.totals.view },
  { key: 'Likes', get: (s) => s.totals.like },
  { key: 'Collects', get: (s) => s.totals.collect },
  { key: 'Comments', get: (s) => s.totals.comment },
  { key: 'Follows', get: (s) => s.totals.follow },
  { key: 'Publishes', get: (s) => s.totals.publish },
];

function pct(rate: number | null): string {
  return rate == null ? 'n/a' : `${Math.round(rate * 100)}%`;
}

/** 一行健康判词（5 秒回答"谁需要我"）。 */
function healthLine(s: DashboardSummary): string {
  const total = s.accounts.length;
  const warned = s.accounts.filter((a) => a.riskStatus === 'warned').length;
  const bad = s.accounts.filter((a) => a.riskStatus === 'restricted' || a.riskStatus === 'frozen').length;
  const band = s.likeRate.healthy == null ? '' : s.likeRate.healthy ? 'healthy' : 'out-of-band';
  return `${s.edgesOnline} edges online · ${total} accounts · ${warned} warned · ${bad} restricted/frozen · like-rate ${pct(s.likeRate.rate)} ${band}`;
}

/** Dashboard 首页（design PAGE 3）：今日数据 + 账号状态一览（severity 排序）+ 调度引擎 + 告警 + 真按账号切片。 */
export function DashboardPage() {
  const { data, isLoading, isError, refetch } = useDashboardSummary();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {isError && (
        <Alert
          type="error"
          showIcon
          message="加载 dashboard summary 失败"
          action={
            <Button size="small" onClick={() => void refetch()}>
              retry
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

      <Row gutter={[12, 12]}>
        <Col>
          <Card size="small" loading={isLoading}>
            <Statistic title="Edges online" value={data?.edgesOnline ?? 0} />
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
            <Statistic title="Like-rate (global)" value={pct(data?.likeRate.rate ?? null)} />
            {data?.likeRate.healthy != null && (
              <Tag color={data.likeRate.healthy ? 'green' : 'gold'}>
                {data.likeRate.healthy ? 'healthy 15-35%' : 'out of band'}
              </Tag>
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Per-account status (severity-sorted)">
        {data && data.accounts.length > 0 ? (
          <AccountsTable accounts={data.accounts} loading={isLoading} severitySorted />
        ) : (
          <Empty description={isLoading ? 'loading…' : 'no accounts'} />
        )}
      </Card>

      {/* V1 task 9.6：真按账号今日计数切片（归因已流通，不再「归因待补」）。 */}
      <Card size="small" title="Today by account">
        <AccountTotalsTable rows={data?.totalsByAccount ?? []} loading={isLoading} />
      </Card>

      {/* V1 task 9.5：真未解决告警。 */}
      <Card size="small" title={`Alerts (unresolved · ${data?.alerts.length ?? 0})`}>
        {data && data.alerts.length > 0 ? (
          <List
            size="small"
            dataSource={data.alerts}
            renderItem={(a) => (
              <List.Item>
                <AlertSeverityBadge severity={a.severity} />
                <Typography.Text style={{ marginRight: 8 }}>{a.title}</Typography.Text>
                {a.accountId && (
                  <Typography.Text type="secondary" style={{ marginRight: 8 }}>
                    {a.accountId}
                  </Typography.Text>
                )}
                <Typography.Text type="secondary">{new Date(a.createdAt).toLocaleString()}</Typography.Text>
              </List.Item>
            )}
          />
        ) : (
          <Empty description={isLoading ? 'loading…' : 'no unresolved alerts'} />
        )}
      </Card>
    </div>
  );
}
