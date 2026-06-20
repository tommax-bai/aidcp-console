import { Alert, Button, Card, Col, Empty, Row, Statistic } from 'antd';
import { useDashboardSummary } from '../api/queries';
import { AttributionPendingBanner } from '../components';

/**
 * Dashboard 首页（design PAGE 3）。task 1 后端仅 edgesOnline 骨架；
 * 今日数据 / 账号状态一览 / like-rate 待 task 5。归因待补 banner 由 API flag 驱动（默认 true）。
 */
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

      <Row gutter={12}>
        <Col>
          <Card size="small" loading={isLoading}>
            <Statistic title="Edges online" value={data?.edgesOnline ?? 0} />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Per-account status">
        <Empty description="账号状态一览 + 今日数据待 task 5 只读接口接入（两个独立徽标 status/tier 在此渲染）" />
      </Card>
      <Card size="small" title="Alerts">
        <Empty description="alerts land in V1" />
      </Card>
    </div>
  );
}
