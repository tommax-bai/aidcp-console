import { Card } from 'antd';
import { useAccounts } from '../api/queries';
import { AttributionPendingBanner, AccountsTable } from '../components';

/** 账号列表（design PAGE 4a）：accounts ⨝ risk_state，两个独立徽标 status/tier。 */
export function AccountsPage() {
  const { data, isLoading } = useAccounts();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <AttributionPendingBanner show />
      <Card size="small" title="Accounts">
        <AccountsTable accounts={data?.accounts ?? []} loading={isLoading} />
      </Card>
    </div>
  );
}
