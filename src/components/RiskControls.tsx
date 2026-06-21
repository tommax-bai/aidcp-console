import { useState } from 'react';
import { App, Button, Dropdown, Input, Modal, Select, Space } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../api/client';
import type { PanelAccount } from '../types/api';
import {
  RISK_QUOTA_LEVELS,
  RISK_QUOTA_LABEL,
  RISK_STATUS_LABEL,
  type RiskQuotaLevel,
  type RiskStatus,
} from '../types/aidcp-enums';

/**
 * 风控写控件（V1 task 10.1）：status 迁移（枚举种类）与 quota-tier 是**两个独立控件**。
 * 非乐观——round-trip 后才显示真态；status 迁移被状态机拒绝时渲染 refused（区别于成功）。
 * operator_override_recover 走 Modal 强制填审计理由。
 */
export function RiskControls({ account }: { account: PanelAccount }) {
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
      const label = RISK_STATUS_LABEL[res.state.status as RiskStatus] ?? res.state.status;
      if (res.changed) message.success(`风控状态已改为 ${label}`);
      else message.warning(`已拒绝（仍为 ${label}）`);
      invalidate();
    },
    onError: () => message.error('风控状态修改失败'),
  });

  const quota = useMutation({
    mutationFn: (level: string) =>
      apiPost<{ state: { quotaLevel: string } }>(`/api/accounts/${account.accountId}/risk/quota`, { level }),
    onSuccess: (res) => {
      const label = RISK_QUOTA_LABEL[res.state.quotaLevel as RiskQuotaLevel] ?? res.state.quotaLevel;
      message.success(`配额档位已改为 ${label}`);
      invalidate();
    },
    onError: () => message.error('配额档位修改失败'),
  });

  return (
    <Space size={4}>
      <Dropdown
        menu={{
          items: [
            { key: 'manual_restrict', label: '受限' },
            { key: 'manual_freeze', label: '冻结', danger: true },
            { key: 'operator_override_recover', label: '强制恢复（特权覆盖）…' },
          ],
          onClick: ({ key }) => {
            if (key === 'operator_override_recover') {
              setOverrideOpen(true);
              return;
            }
            status.mutate({ kind: key });
          },
        }}
      >
        <Button size="small" loading={status.isPending}>
          风控 ▾
        </Button>
      </Dropdown>
      <Select
        size="small"
        style={{ width: 120 }}
        value={account.riskQuotaLevel ?? undefined}
        placeholder="配额档位"
        loading={quota.isPending}
        onChange={(v) => quota.mutate(v)}
        options={RISK_QUOTA_LEVELS.map((l) => ({ label: `档位：${RISK_QUOTA_LABEL[l]}`, value: l }))}
      />
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
    </Space>
  );
}
