import { Alert } from 'antd';

/**
 * 归因待补 banner：由 API 显式 flag 驱动（**非由值是否存在驱动**），
 * 防把全局数字冒充按账号（design §3.2 / cloud interaction-attribution）。
 */
export function AttributionPendingBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <Alert
      type="info"
      banner
      showIcon
      message="all accounts / attribution pending（按账号切片归因落地于 V1）"
    />
  );
}
