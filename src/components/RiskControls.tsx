import { useState } from 'react';
import { App, Dropdown, Input, Modal, Space, Tag, Tooltip } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiPost } from '../api/client';
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
 * 账号归属（change risk-state-cross-process-integrity）。
 *
 * 同一个账号在平台眼里只有一份活动预算，因此它只能由一套云端的自动化驱动。归属事实由服务端权威给出
 * （`executionTarget` / `riskWritable`），**console MUST NOT 自己推断**。
 *
 * 未归属 MUST 显示为「未归属」而不是伪装成当前后台：那不是一个空值，那是「还没有任何一套云端
 * 真实驱动过它」这个确切事实。
 */
export function ownershipHint(account: PanelAccount): string {
  if (account.executionTarget === undefined || account.executionTarget === null) {
    return '该账号尚未归属任何一套云端的自动化；等它在某套云端上真实连上一次即可自动归属。';
  }
  return `该账号归属 ${account.executionTarget}，请在 ${account.executionTarget} 后台操作。`;
}

/** 服务端说 false 才算不可写；字段缺失（旧 Cloud）按可写处理，与本 change 之前逐位一致。 */
export function isRiskWritable(account: PanelAccount): boolean {
  return account.riskWritable !== false;
}

/**
 * 只读呈现：拿掉下拉与可点样式，并把归属**直接显示在行上**（不只挂在 hover 提示里）——
 * 运营需要一眼看出「这行为什么是灰的」，而不是先去猜、再去悬停。
 */
function ReadOnlyRisk({ account, children }: { account: PanelAccount; children: React.ReactNode }) {
  const owner = account.executionTarget ?? null;
  return (
    <Tooltip title={ownershipHint(account)}>
      <span
        data-testid="risk-readonly"
        aria-disabled="true"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.6 }}
      >
        {children}
        <Tag>{owner ? `归属 ${owner}` : '未归属'}</Tag>
      </span>
    </Tooltip>
  );
}

/**
 * 归属类拒绝的诚实呈现（MUST NOT 显示成功、MUST NOT 静默无反应）。
 * 服务端把「真实属主是谁、该去哪操作」写在 body.message 里，这里原样上屏。
 */
function ownershipRefusal(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  if (err.message !== 'risk_state_not_owned' && err.message !== 'owner_change_blocked_by_active_session') {
    return null;
  }
  return err.serverMessage ?? '该账号不归本后台管，操作未执行。';
}

/**
 * 风控写控件（V1 task 10.1）：status 迁移（枚举种类）与 quota-tier 是**两个独立控件**。
 * 非乐观——round-trip 后才显示真态；status 迁移被状态机拒绝时渲染 refused（区别于成功）。
 * operator_override_recover 走 Modal 强制填审计理由。
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
    onError: (err) => {
      const refusal = ownershipRefusal(err);
      // 可区分的失败态：归属拒绝不是「改失败了再试一次」，而是「这台后台没有写它的权力」。
      if (refusal) message.warning(refusal);
      else message.error('风控状态修改失败');
    },
  });

  if (!isRiskWritable(account)) {
    return (
      <ReadOnlyRisk account={account}>
        {account.riskStatus ? <RiskStatusBadge status={account.riskStatus} /> : <Tag>未上报</Tag>}
      </ReadOnlyRisk>
    );
  }

  return (
    <>
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
    onError: (err) => {
      const refusal = ownershipRefusal(err);
      if (refusal) message.warning(refusal);
      else message.error('配额档位修改失败');
    },
  });

  if (!isRiskWritable(account)) {
    return (
      <ReadOnlyRisk account={account}>
        {account.riskQuotaLevel ? <QuotaTierBadge tier={account.riskQuotaLevel} /> : <Tag>未配置</Tag>}
      </ReadOnlyRisk>
    );
  }

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
