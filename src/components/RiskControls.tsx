import { useState } from 'react';
import { App, Dropdown, Input, Modal, Space, Tag, Tooltip } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../api/client';
import type { PanelAccount } from '../types/api';
import {
  RISK_QUOTA_LEVELS,
  RISK_QUOTA_LABEL,
  RISK_STATUS_LABEL,
  labelOf,
} from '../types/aidcp-enums';
import { QuotaTierBadge } from './QuotaTierBadge';
import { RiskStatusBadge } from './RiskStatusBadge';

/**
 * 当前驱动 target（change risk-target-follows-active-session）。
 *
 * 归属跟随「当次会话」：哪个客户端此刻握手，账号就归那个 target（分时、合法），而不是静态占位后
 * 永久固定。因此这里只做**纯信息展示**——告诉运营「现在是哪套云端在驱动这个账号」，null=当前无
 * 活跃会话。**绝不据此禁用任何风控写操作**：风控状态 / 配额档是账号级配置，任何后台都能改，跨进程
 * 写的安全由 cloud 侧「每 target 单写者锁 + 带当前会话 target 谓词的条件写」保证，不靠 UI 禁用。
 */
export function driverTargetLabel(account: PanelAccount): string {
  return account.currentDriverTarget ? `${account.currentDriverTarget} 驱动中` : '当前无活跃会话';
}

export function driverTargetHint(account: PanelAccount): string {
  return account.currentDriverTarget
    ? `当前由 ${account.currentDriverTarget} 的会话驱动这个账号。风控写操作是账号级配置，任何后台都能改。`
    : '当前没有任何会话在驱动这个账号。';
}

/** 当前驱动 target 的只读展示：纯信息，不做任何写禁用。 */
function DriverTargetTag({ account }: { account: PanelAccount }) {
  const driving = account.currentDriverTarget ?? null;
  return (
    <Tooltip title={driverTargetHint(account)}>
      <Tag
        data-testid="risk-driver-target"
        style={{ marginInlineEnd: 0, opacity: driving ? 1 : 0.55 }}
      >
        {driverTargetLabel(account)}
      </Tag>
    </Tooltip>
  );
}

/**
 * 风控写控件（V1 task 10.1）：status 迁移（枚举种类）与 quota-tier 是**两个独立控件**。
 * 非乐观——round-trip 后才显示真态；status 迁移被状态机拒绝时渲染 refused（区别于成功）。
 * operator_override_recover 走 Modal 强制填审计理由。
 *
 * 归属跟随当次会话后，风控写不再按归属禁用（账号级配置）。行上额外展示「当前驱动 target」纯信息。
 */
export function RiskStatusControl({ account }: { account: PanelAccount }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reason, setReason] = useState('');

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['accounts'] });

  const status = useMutation({
    mutationFn: (v: { kind: string; reason?: string }) =>
      apiPost<{ changed: boolean; state: { status: string } }>(
        `/api/accounts/${account.accountId}/risk/status`,
        v,
      ),
    onSuccess: (res) => {
      // refused 可辨：状态机拒绝（changed=false）渲染「已拒绝」，绝不当成功
      const label = labelOf(RISK_STATUS_LABEL, res.state.status);
      if (res.changed) message.success(`风控状态已改为 ${label}`);
      else message.warning(`已拒绝（仍为 ${label}）`);
      invalidate();
    },
    onError: () => message.error('风控状态修改失败'),
  });

  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'manual_restrict', label: '受限' },
              { key: 'manual_freeze', label: '冻结', danger: true },
              { key: 'operator_override_recover', label: '强制恢复（特权覆盖）…' },
            ],
            onClick: ({ key }) => {
              if (status.isPending) return;
              if (key === 'operator_override_recover') {
                setOverrideOpen(true);
                return;
              }
              status.mutate({ kind: key });
            },
          }}
        >
          <button
            type="button"
            aria-label={`调整风控：${account.riskStatus ? labelOf(RISK_STATUS_LABEL, account.riskStatus) : '未上报'}`}
            className="editable-cell"
            disabled={status.isPending}
            style={{ display: 'inline-flex', border: 0, padding: 0, background: 'transparent', cursor: status.isPending ? 'wait' : 'pointer' }}
          >
            {account.riskStatus ? <RiskStatusBadge status={account.riskStatus} /> : <Tag>未上报</Tag>}
          </button>
        </Dropdown>
        <DriverTargetTag account={account} />
      </span>
      <Modal
        title="强制恢复 — 绕过风控恢复时间窗（特权操作）"
        open={overrideOpen}
        onOk={() => {
          status.mutate({ kind: 'operator_override_recover', reason });
          setOverrideOpen(false);
          setReason('');
        }}
        onCancel={() => setOverrideOpen(false)}
        okButtonProps={{ disabled: !reason.trim(), danger: true }}
        okText="强制恢复"
        cancelText="取消"
      >
        <Input.TextArea
          placeholder="审计理由（必填）— 这是绕过风控时间门控的特权操作"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
        />
      </Modal>
    </>
  );
}

export function QuotaTierControl({ account }: { account: PanelAccount }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const quota = useMutation({
    mutationFn: (level: string) =>
      apiPost<{ state: { quotaLevel: string } }>(`/api/accounts/${account.accountId}/risk/quota`, { level }),
    onSuccess: (res) => {
      const label = labelOf(RISK_QUOTA_LABEL, res.state.quotaLevel);
      message.success(`配额档位已改为 ${label}`);
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: () => message.error('配额档位修改失败'),
  });

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: RISK_QUOTA_LEVELS.map((level) => ({
          key: level,
          label: labelOf(RISK_QUOTA_LABEL, level),
        })),
        selectedKeys: account.riskQuotaLevel ? [account.riskQuotaLevel] : [],
        onClick: ({ key }) => {
          if (!quota.isPending && key !== account.riskQuotaLevel) quota.mutate(key);
        },
      }}
    >
      <button
        type="button"
        aria-label={`调整档位：${account.riskQuotaLevel ? labelOf(RISK_QUOTA_LABEL, account.riskQuotaLevel) : '未配置'}`}
        className="editable-cell"
        disabled={quota.isPending}
        style={{ display: 'inline-flex', border: 0, padding: 0, background: 'transparent', cursor: quota.isPending ? 'wait' : 'pointer' }}
      >
        {account.riskQuotaLevel ? <QuotaTierBadge tier={account.riskQuotaLevel} /> : <Tag>未配置</Tag>}
      </button>
    </Dropdown>
  );
}

export function RiskControls({ account }: { account: PanelAccount }) {
  return (
    <Space size={4}>
      <RiskStatusControl account={account} />
      <QuotaTierControl account={account} />
    </Space>
  );
}
