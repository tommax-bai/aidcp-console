import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  InputNumber,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiGet, apiPut } from '../api/client';
import { errorText } from '../api/errorText';
import type {
  FacebookGroupCommentPolicyView,
  FacebookGroupCommentPolicyWrite,
} from '../types/api';
import { labelOf } from '../types/aidcp-enums';

const SOURCE_LABEL: Record<FacebookGroupCommentPolicyView['source'], string> = {
  db: '数据库策略',
  legacy_env: '旧环境配置回退（未持久化）',
  default: '服务器默认值（未持久化）',
};

export function FacebookGroupCommentPolicyEditor({ enabled = true }: { enabled?: boolean }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const queryKey = ['facebook', 'groups', 'comment-policy'] as const;
  const policy = useQuery({
    queryKey,
    queryFn: () =>
      apiGet<FacebookGroupCommentPolicyView>('/api/facebook/groups/comment-policy'),
    enabled,
    refetchOnWindowFocus: true,
  });
  const [draftHours, setDraftHours] = useState<number | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: FacebookGroupCommentPolicyWrite) =>
      apiPut<FacebookGroupCommentPolicyView>('/api/facebook/groups/comment-policy', input),
    onSuccess: async (result) => {
      queryClient.setQueryData(queryKey, result);
      setDraftHours(result.joinToFirstCommentHours);
      setWriteError(null);
      const readback = await policy.refetch();
      if (readback.isError || !readback.data) {
        setWriteError('策略写入已返回，但最新权威回读失败；请重试读取后再确认。');
        return;
      }
      setDraftHours(null);
      message.success('入群后首次评论等待已保存并完成权威回读');
    },
    onError: (error) => {
      const conflict = (error instanceof ApiError && error.status === 409)
        || (typeof error === 'object' && error !== null && 'status' in error && error.status === 409);
      setWriteError(conflict
        ? '策略 revision 已变化；当前输入未丢失，请刷新权威配置后再提交。'
        : errorText(error, '首次评论等待保存失败，当前输入已保留'));
    },
  });

  if (!enabled) return null;

  if (policy.isLoading) {
    return (
      <Card
        size="small"
        type="inner"
        className="facebook-global-policy-subpolicy"
        title="入群后评论延迟（独立保存）"
      >
        <Skeleton active paragraph={{ rows: 2 }} />
      </Card>
    );
  }

  if (policy.isError || !policy.data) {
    return (
      <Card
        size="small"
        type="inner"
        className="facebook-global-policy-subpolicy"
        title="入群后评论延迟（独立保存）"
      >
        <Alert
          type="error"
          showIcon
          message="群组评论时序状态未知"
          description="无法读取首次评论等待与同群复评冷却；未使用默认值冒充服务器真态。"
          action={<Button size="small" onClick={() => void policy.refetch()}>重试读取</Button>}
        />
      </Card>
    );
  }

  const view = policy.data;
  const value = draftHours ?? view.joinToFirstCommentHours;
  const bounds = view.bounds.joinToFirstCommentHours;
  const invalid = !Number.isInteger(value) || value < bounds.min || value > bounds.max;
  const dirty = view.source !== 'db' || value !== view.joinToFirstCommentHours;

  return (
    <Card
      size="small"
      type="inner"
      className="facebook-global-policy-subpolicy"
      title="入群后评论延迟（独立保存）"
      extra={
        <Space size={[4, 4]} wrap>
          <Tag>{labelOf(SOURCE_LABEL, view.source)}</Tag>
          <Tag>{view.revision === null ? '无持久化 revision' : `revision ${view.revision}`}</Tag>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          该配置独立于消费节奏保存；修改它不会重置消费模式 revision 或已累计进度。
        </Typography.Text>
        {writeError ? (
          <Alert
            type="error"
            showIcon
            message={writeError}
            action={
              <Button
                size="small"
                onClick={async () => {
                  const result = await policy.refetch();
                  if (result.data) {
                    setDraftHours(null);
                    setWriteError(null);
                  }
                }}
              >
                刷新权威配置
              </Button>
            }
          />
        ) : null}

        <Space direction="vertical" size={6}>
          <Typography.Text strong>入群后首次评论等待（小时）</Typography.Text>
          <Space wrap>
            <InputNumber
              aria-label="入群后首次评论等待（小时）"
              precision={0}
              value={value}
              status={invalid ? 'error' : undefined}
              disabled={save.isPending}
              onChange={(next) => {
                if (next !== null) setDraftHours(next);
              }}
            />
            <Typography.Text type="secondary">
              服务器范围 {bounds.min}–{bounds.max}；默认 {bounds.default}
            </Typography.Text>
            <Button
              type="primary"
              loading={save.isPending}
              disabled={invalid || !dirty}
              onClick={() =>
                save.mutate({
                  expectedRevision: view.revision ?? 0,
                  joinToFirstCommentHours: value,
                })
              }
            >
              保存首次评论等待
            </Button>
          </Space>
          {invalid ? (
            <Typography.Text type="danger">
              请输入 {bounds.min}–{bounds.max} 之间的整数小时。
            </Typography.Text>
          ) : null}
          <Typography.Text type="secondary">
            该值决定消费模式与普通群组覆盖中，账号加入群组后最早何时可首次评论。
          </Typography.Text>
        </Space>

        <Space direction="vertical" size={4}>
          <Typography.Text strong>同群再次评论冷却（独立，只读）</Typography.Text>
          {view.sameGroupRecommentCooldownHours === null ? (
            <Tag color="red">同群复评冷却状态未知</Tag>
          ) : (
            <Space wrap>
              <Tag>{view.sameGroupRecommentCooldownHours} 小时</Tag>
              {view.sameGroupRecommentCooldownSource ? (
                <Typography.Text type="secondary">
                  来源：{view.sameGroupRecommentCooldownSource}
                </Typography.Text>
              ) : null}
            </Space>
          )}
          <Typography.Text type="secondary">
            修改“入群后首次评论等待”不会修改、重置或替代同群再次评论冷却。
          </Typography.Text>
        </Space>
      </Space>
    </Card>
  );
}
