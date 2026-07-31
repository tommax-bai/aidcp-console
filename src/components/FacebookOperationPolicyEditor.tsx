import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiGet, apiPut } from '../api/client';
import { errorText } from '../api/errorText';
import type {
  FacebookConsumptionCadence,
  FacebookOperationMode,
  FacebookOperationPolicyView,
  FacebookOperationPolicyWrite,
  FacebookRuleCadence,
  IntegerFieldBounds,
} from '../types/api';

const MODE_META: Record<FacebookOperationMode | 'blocked', { label: string; color?: string }> = {
  persona: { label: '人设模式' },
  slow_start: { label: '慢启动', color: 'orange' },
  rule: { label: '规则模式', color: 'blue' },
  consumption: { label: '消费模式', color: 'purple' },
  blocked: { label: '已阻断', color: 'red' },
};

interface PolicyDraft {
  mode: FacebookOperationMode;
  rule: FacebookRuleCadence;
  consumption: FacebookConsumptionCadence;
}

function draftFrom(view: FacebookOperationPolicyView): PolicyDraft {
  return {
    mode: view.slowStart.state === 'active' || view.effectiveMode === 'slow_start'
      ? 'slow_start'
      : view.baseMode,
    rule: { ...view.rule },
    consumption: { ...view.consumption },
  };
}

function sameDraft(left: PolicyDraft, right: PolicyDraft): boolean {
  if (left.mode !== right.mode) return false;
  if (left.mode === 'rule') {
    return left.rule.viewsPerLike === right.rule.viewsPerLike
      && left.rule.joinEveryNRounds === right.rule.joinEveryNRounds;
  }
  if (left.mode === 'consumption') {
    return left.consumption.viewsPerLike === right.consumption.viewsPerLike
      && left.consumption.confirmedLikesPerJoin
        === right.consumption.confirmedLikesPerJoin
      && left.consumption.confirmedJoinsPerComment
        === right.consumption.confirmedJoinsPerComment;
  }
  return true;
}

function integerError(label: string, value: number, bounds: IntegerFieldBounds) {
  if (!Number.isInteger(value)) return `${label}必须是整数`;
  if (value < bounds.min || value > bounds.max) {
    return `${label}必须在 ${bounds.min}–${bounds.max} 之间`;
  }
  return null;
}

function validateDraft(draft: PolicyDraft, view: FacebookOperationPolicyView) {
  if (draft.mode === 'rule') {
    return integerError('浏览点赞阈值', draft.rule.viewsPerLike, view.bounds.rule.viewsPerLike)
      ?? integerError('加群联系轮次', draft.rule.joinEveryNRounds, view.bounds.rule.joinEveryNRounds);
  }
  if (draft.mode === 'consumption') {
    return integerError(
      '浏览点赞阈值',
      draft.consumption.viewsPerLike,
      view.bounds.consumption.viewsPerLike,
    )
      ?? integerError(
        '确认点赞加群阈值',
        draft.consumption.confirmedLikesPerJoin,
        view.bounds.consumption.confirmedLikesPerJoin,
      )
      ?? integerError(
        '确认加群评论阈值',
        draft.consumption.confirmedJoinsPerComment,
        view.bounds.consumption.confirmedJoinsPerComment,
      );
  }
  return null;
}

function writePayload(
  draft: PolicyDraft,
  expectedRevision: number,
): FacebookOperationPolicyWrite {
  if (draft.mode === 'rule') {
    return { expectedRevision, mode: 'rule', rule: { ...draft.rule } };
  }
  if (draft.mode === 'consumption') {
    return { expectedRevision, mode: 'consumption', consumption: { ...draft.consumption } };
  }
  return { expectedRevision, mode: draft.mode };
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

export function FacebookOperationPolicyEditor({ envKey }: { envKey: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const queryKey = ['environments', envKey, 'facebook-operation-policy'] as const;
  const query = useQuery({
    queryKey,
    queryFn: () =>
      apiGet<FacebookOperationPolicyView>(
        `/api/environments/${encodeURIComponent(envKey)}/facebook-operation-policy`,
      ),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [baseline, setBaseline] = useState<PolicyDraft | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: FacebookOperationPolicyWrite) =>
      apiPut<FacebookOperationPolicyView>(
        `/api/environments/${encodeURIComponent(envKey)}/facebook-operation-policy`,
        input,
      ),
    onSuccess: async (result) => {
      const resultDraft = draftFrom(result);
      queryClient.setQueryData(queryKey, result);
      setDraft(resultDraft);
      setBaseline(resultDraft);
      setWriteError(null);
      void queryClient.invalidateQueries({ queryKey: ['environments'], exact: true });
      const readback = await query.refetch();
      if (readback.isError || !readback.data) {
        setWriteError('配置写入已返回，但最新权威回读失败；当前表单保留，请重试读取后再确认。');
        return;
      }
      const authoritativeDraft = draftFrom(readback.data);
      setDraft(authoritativeDraft);
      setBaseline(authoritativeDraft);
      setOpen(false);
      message.success('Facebook 运行策略已保存并完成权威回读');
    },
    onError: (error) => {
      const conflict = (error instanceof ApiError && error.status === 409)
        || (typeof error === 'object' && error !== null && 'status' in error && error.status === 409);
      setWriteError(conflict
        ? '策略已被其他操作员更新；当前表单未丢失，请重新读取权威配置后再提交。'
        : errorText(error, '运行策略保存失败，当前表单已保留'));
    },
  });

  if (query.isLoading) {
    return <Tag>策略加载中</Tag>;
  }
  if (query.isError || !query.data) {
    return (
      <Space direction="vertical" size={4}>
        <Tag color="red">策略状态未知</Tag>
        <Button size="small" onClick={() => void query.refetch()}>重试读取</Button>
      </Space>
    );
  }

  const view = query.data;
  const effective = view.effectiveMode ? MODE_META[view.effectiveMode] : null;
  const configured = MODE_META[view.baseMode];
  const bindingText = view.binding.state === 'bound'
    ? `挂载：${view.binding.accountDisplayName || view.binding.accountId || '账号未知'}`
    : view.binding.state === 'unbound'
      ? '未挂载（可配置）'
      : `挂载状态：${view.binding.state}`;
  const validationError = draft ? validateDraft(draft, view) : null;
  const dirty = draft !== null && baseline !== null && !sameDraft(draft, baseline);

  const openEditor = () => {
    const current = draftFrom(view);
    setDraft(current);
    setBaseline(current);
    setWriteError(null);
    setOpen(true);
  };

  const reloadAuthoritative = async () => {
    const result = await query.refetch();
    if (result.data) {
      const current = draftFrom(result.data);
      setDraft(current);
      setBaseline(current);
      setWriteError(null);
    }
  };

  return (
    <>
      <Space direction="vertical" size={4} style={{ maxWidth: 330 }}>
        <Space size={[4, 4]} wrap>
          <Tag color={configured.color}>基础：{configured.label}</Tag>
          {effective ? (
            <Tag color={effective.color}>生效：{effective.label}</Tag>
          ) : (
            <Tag>生效：无执行对象</Tag>
          )}
          <Tag>revision {view.policyRevision}</Tag>
          {view.slowStart.globallyDisabled ? (
            <Tag color="gold">慢启动：Cloud 全局停用</Tag>
          ) : view.slowStart.state === 'active' ? (
            <Tag color="orange">慢启动生命周期已启用</Tag>
          ) : view.slowStart.state === 'unknown' ? (
            <Tag color="orange">慢启动状态未知</Tag>
          ) : null}
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {bindingText}
        </Typography.Text>
        {view.blocker ? <Tag color="orange">阻断：{view.blocker}</Tag> : null}
        <Button size="small" aria-label={`编辑运行策略 ${envKey}`} onClick={openEditor}>
          编辑策略
        </Button>
      </Space>

      <Modal
        title={`Facebook 运行策略 · ${envKey}`}
        open={open}
        onCancel={() => {
          if (!save.isPending) setOpen(false);
        }}
        footer={[
          <Button key="cancel" disabled={save.isPending} onClick={() => setOpen(false)}>
            取消
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={save.isPending}
            disabled={!draft || !dirty || !!validationError}
            onClick={() => {
              if (draft) save.mutate(writePayload(draft, view.policyRevision));
            }}
          >
            保存运行策略
          </Button>,
        ]}
        destroyOnHidden
      >
        {draft ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space size={[4, 4]} wrap>
              <Tag>当前 revision {view.policyRevision}</Tag>
              <Tag>schema {view.schemaVersion}</Tag>
              <Tag>{bindingText}</Tag>
            </Space>

            {writeError ? (
              <Alert
                type="error"
                showIcon
                message={writeError}
                action={
                  <Button size="small" onClick={() => void reloadAuthoritative()}>
                    重新读取权威配置
                  </Button>
                }
              />
            ) : null}

            <Space direction="vertical" size={4}>
              <Typography.Text strong>运行模式</Typography.Text>
              <Select<FacebookOperationMode>
                aria-label={`运行模式 ${envKey}`}
                value={draft.mode}
                style={{ width: 220 }}
                disabled={save.isPending}
                onChange={(mode) => setDraft((current) => current ? { ...current, mode } : current)}
                options={[
                  { value: 'persona', label: '人设模式' },
                  { value: 'slow_start', label: '慢启动' },
                  { value: 'rule', label: '规则模式' },
                  { value: 'consumption', label: '消费模式' },
                ]}
              />
            </Space>

            {draft.mode === 'rule' ? (
              <Space direction="vertical" size={8}>
                <Typography.Text strong>规则模式节奏</Typography.Text>
                <Space wrap>
                  <Typography.Text>每浏览</Typography.Text>
                  <InputNumber
                    aria-label={`规则模式浏览点赞阈值 ${envKey}`}
                    precision={0}
                    value={draft.rule.viewsPerLike}
                    disabled={save.isPending}
                    onChange={(value) => setDraft((current) => current && value !== null
                      ? { ...current, rule: { ...current.rule, viewsPerLike: value } }
                      : current)}
                  />
                  <Typography.Text>
                    条点赞一次（范围 {view.bounds.rule.viewsPerLike.min}–{view.bounds.rule.viewsPerLike.max}，
                    默认 {view.bounds.rule.viewsPerLike.default}）
                  </Typography.Text>
                </Space>
                <Space wrap>
                  <Typography.Text>每</Typography.Text>
                  <InputNumber
                    aria-label={`规则模式加群轮次 ${envKey}`}
                    precision={0}
                    value={draft.rule.joinEveryNRounds}
                    disabled={save.isPending}
                    onChange={(value) => setDraft((current) => current && value !== null
                      ? { ...current, rule: { ...current.rule, joinEveryNRounds: value } }
                      : current)}
                  />
                  <Typography.Text>
                    轮加群联系评论一次（范围 {view.bounds.rule.joinEveryNRounds.min}–
                    {view.bounds.rule.joinEveryNRounds.max}，默认 {view.bounds.rule.joinEveryNRounds.default}）
                  </Typography.Text>
                </Space>
              </Space>
            ) : null}

            {draft.mode === 'consumption' ? (
              <Space direction="vertical" size={8}>
                <Typography.Text strong>消费模式节奏</Typography.Text>
                <Alert
                  type="info"
                  showIcon
                  message="加群与评论是两个独立阶段"
                  description="加群阶段只加入群组、不发评论；评论阶段选择此前已加入且满足首次评论等待与同群复评冷却的群组。"
                />
                <Space wrap>
                  <Typography.Text>每浏览</Typography.Text>
                  <InputNumber
                    aria-label={`消费模式浏览点赞阈值 ${envKey}`}
                    precision={0}
                    value={draft.consumption.viewsPerLike}
                    disabled={save.isPending}
                    onChange={(value) => setDraft((current) => current && value !== null
                      ? {
                          ...current,
                          consumption: { ...current.consumption, viewsPerLike: value },
                        }
                      : current)}
                  />
                  <Typography.Text>
                    条点赞一次（范围 {view.bounds.consumption.viewsPerLike.min}–
                    {view.bounds.consumption.viewsPerLike.max}，默认 {view.bounds.consumption.viewsPerLike.default}）
                  </Typography.Text>
                </Space>
                <Space wrap>
                  <Typography.Text>每确认</Typography.Text>
                  <InputNumber
                    aria-label={`消费模式确认点赞加群阈值 ${envKey}`}
                    precision={0}
                    value={draft.consumption.confirmedLikesPerJoin}
                    disabled={save.isPending}
                    onChange={(value) => setDraft((current) => current && value !== null
                      ? {
                          ...current,
                          consumption: { ...current.consumption, confirmedLikesPerJoin: value },
                        }
                      : current)}
                  />
                  <Typography.Text>
                    个新点赞加群一次（范围 {view.bounds.consumption.confirmedLikesPerJoin.min}–
                    {view.bounds.consumption.confirmedLikesPerJoin.max}，
                    默认 {view.bounds.consumption.confirmedLikesPerJoin.default}）
                  </Typography.Text>
                </Space>
                <Space wrap>
                  <Typography.Text>每确认</Typography.Text>
                  <InputNumber
                    aria-label={`消费模式确认加群评论阈值 ${envKey}`}
                    precision={0}
                    value={draft.consumption.confirmedJoinsPerComment}
                    disabled={save.isPending}
                    onChange={(value) => setDraft((current) => current && value !== null
                      ? {
                          ...current,
                          consumption: { ...current.consumption, confirmedJoinsPerComment: value },
                        }
                      : current)}
                  />
                  <Typography.Text>
                    个新群，在历史已加入群发一次评论（范围
                    {' '}{view.bounds.consumption.confirmedJoinsPerComment.min}–
                    {view.bounds.consumption.confirmedJoinsPerComment.max}，
                    默认 {view.bounds.consumption.confirmedJoinsPerComment.default}）
                  </Typography.Text>
                </Space>
              </Space>
            ) : null}

            {draft.mode === 'slow_start' ? (
              <Alert
                type="info"
                showIcon
                message="保存后由 Cloud 启用现有慢启动生命周期"
                description="慢启动是生效模式；可恢复的基础模式会按契约设为人设模式，不在前端维护第二个慢启动开关。"
              />
            ) : null}

            {validationError ? <Typography.Text type="danger">{validationError}</Typography.Text> : null}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              最近权威更新：{formatTime(view.updatedAt)}{view.updatedBy ? ` · ${view.updatedBy}` : ''}
            </Typography.Text>
          </Space>
        ) : null}
      </Modal>
    </>
  );
}
