import { useState } from 'react';
import { App, Button, Dropdown, Input, Modal, Select, Space } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../api/client';
import type { PanelAccount } from '../types/api';
import { RISK_QUOTA_LEVELS } from '../types/aidcp-enums';

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
      // refused 可辨：状态机拒绝（changed=false）渲染 refused，绝不当成功
      if (res.changed) message.success(`status → ${res.state.status}`);
      else message.warning(`refused (still ${res.state.status})`);
      invalidate();
    },
    onError: () => message.error('status change failed'),
  });

  const quota = useMutation({
    mutationFn: (level: string) =>
      apiPost<{ state: { quotaLevel: string } }>(`/api/accounts/${account.accountId}/risk/quota`, { level }),
    onSuccess: (res) => {
      message.success(`tier → ${res.state.quotaLevel}`);
      invalidate();
    },
    onError: () => message.error('tier change failed'),
  });

  return (
    <Space size={4}>
      <Dropdown
        menu={{
          items: [
            { key: 'manual_restrict', label: 'Restrict' },
            { key: 'manual_freeze', label: 'Freeze', danger: true },
            { key: 'operator_override_recover', label: 'Force recover (override)…' },
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
          Risk ▾
        </Button>
      </Dropdown>
      <Select
        size="small"
        style={{ width: 110 }}
        value={account.riskQuotaLevel ?? undefined}
        placeholder="tier"
        loading={quota.isPending}
        onChange={(v) => quota.mutate(v)}
        options={RISK_QUOTA_LEVELS.map((l) => ({ label: `Tier: ${l}`, value: l }))}
      />
      <Modal
        title="Force recover — bypasses risk recovery window (privileged)"
        open={overrideOpen}
        onOk={() => {
          status.mutate({ kind: 'operator_override_recover', reason });
          setOverrideOpen(false);
          setReason('');
        }}
        onCancel={() => setOverrideOpen(false)}
        okButtonProps={{ disabled: !reason.trim(), danger: true }}
        okText="Force recover"
      >
        <Input.TextArea
          placeholder="audit reason (required) — 这是绕过风控时间门控的特权操作"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
        />
      </Modal>
    </Space>
  );
}
