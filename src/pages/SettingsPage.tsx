import { Card, Empty } from 'antd';

/** 设置页：飞书集成 / 全局策略默认值（用户与权限 RBAC 为 V3）。 */
export function SettingsPage() {
  return (
    <div className="page-stack">
      <Card size="small" title="设置">
        <Empty description="飞书集成 / 全局配额档位默认值（RBAC 为 V3）" />
      </Card>
    </div>
  );
}
