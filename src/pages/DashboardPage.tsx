import { Alert, Button, Card, Col, Empty, Row, Statistic, Tag, Typography } from 'antd';
import { useDashboardSummary } from '../api/queries';
import { AttributionPendingBanner, AccountsTable } from '../components';
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

/** Dashboard 首页（design PAGE 3）：今日数据 + 账号状态一览（severity 排序）。 */
export function DashboardPage() {
  const { data, isLoading, isError, refetch } = useDashboardSummary();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <AttributionPendingBanner show={data?.attributionPending ?? true} />

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

      {data && <Typography.Text>{healthLine(data)}</Typography.Text>}

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

      <Card size="small" title="Alerts">
        <Empty description="alerts land in V1" />
      </Card>
    </div>
  );
}
