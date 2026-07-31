import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  InputNumber,
  Modal,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiGet, apiPut } from '../api/client';
import { errorText } from '../api/errorText';
import type {
  FacebookOperationGlobalPolicyView,
  FacebookOperationGlobalPolicyWrite,
  FacebookSlowStartDailyCaps,
  IntegerFieldBounds,
} from '../types/api';

type GlobalDraft = Omit<FacebookOperationGlobalPolicyWrite, 'expectedRevision' | 'reason'>;
type DailyCapKey = Exclude<keyof FacebookSlowStartDailyCaps, 'day'>;

const DAILY_CAP_FIELDS: Array<{ key: DailyCapKey; label: string }> = [
  { key: 'view', label: '浏览' },
  { key: 'like', label: '点赞' },
  { key: 'comment', label: '评论' },
  { key: 'follow', label: '关注' },
  { key: 'publish', label: '发布' },
  { key: 'search', label: '搜索' },
  { key: 'joinGroup', label: '加群' },
];

function draftFrom(view: FacebookOperationGlobalPolicyView): GlobalDraft {
  return {
    rule: { ...view.rule },
    consumption: { ...view.consumption },
    slowStart: {
      totalDays: view.slowStart.totalDays,
      dailyCaps: view.slowStart.dailyCaps.map((row) => ({ ...row })),
    },
  };
}

function sameDraft(left: GlobalDraft, right: GlobalDraft) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function integerError(label: string, value: number, bounds: { min: number; max: number }) {
  if (!Number.isInteger(value)) return `${label}必须是整数`;
  if (value < bounds.min || value > bounds.max) {
    return `${label}必须在 ${bounds.min}–${bounds.max} 之间`;
  }
  return null;
}

function validateDraft(draft: GlobalDraft, view: FacebookOperationGlobalPolicyView) {
  const cadenceChecks: Array<[string, number, IntegerFieldBounds]> = [
    ['规则浏览点赞阈值', draft.rule.viewsPerLike, view.bounds.rule.viewsPerLike],
    ['规则加群轮次', draft.rule.joinEveryNRounds, view.bounds.rule.joinEveryNRounds],
    ['消费浏览点赞阈值', draft.consumption.viewsPerLike, view.bounds.consumption.viewsPerLike],
    [
      '消费确认点赞加群阈值',
      draft.consumption.confirmedLikesPerJoin,
      view.bounds.consumption.confirmedLikesPerJoin,
    ],
    [
      '消费确认加群评论阈值',
      draft.consumption.confirmedJoinsPerComment,
      view.bounds.consumption.confirmedJoinsPerComment,
    ],
    ['冷启动总天数', draft.slowStart.totalDays, view.bounds.slowStart.totalDays],
  ];
  for (const [label, value, bounds] of cadenceChecks) {
    const error = integerError(label, value, bounds);
    if (error) return error;
  }
  if (draft.slowStart.dailyCaps.length !== draft.slowStart.totalDays) {
    return '冷启动每日上限必须完整覆盖总天数';
  }
  for (let index = 0; index < draft.slowStart.dailyCaps.length; index += 1) {
    const row = draft.slowStart.dailyCaps[index];
    if (row.day !== index + 1) return '冷启动天数必须从第 1 天连续排列';
    for (const field of DAILY_CAP_FIELDS) {
      const error = integerError(
        `第 ${row.day} 天${field.label}上限`,
        row[field.key],
        view.bounds.slowStart.dailyCaps[field.key],
      );
      if (error) return error;
    }
  }
  return null;
}

function resizeDailyCaps(
  rows: FacebookSlowStartDailyCaps[],
  totalDays: number,
): FacebookSlowStartDailyCaps[] {
  const next = rows.slice(0, totalDays).map((row, index) => ({ ...row, day: index + 1 }));
  const fallback = rows.at(-1) ?? {
    day: 1,
    view: 0,
    like: 0,
    comment: 0,
    follow: 0,
    publish: 0,
    search: 0,
    joinGroup: 0,
  };
  while (next.length < totalDays) {
    next.push({ ...fallback, day: next.length + 1 });
  }
  return next;
}

export function FacebookOperationGlobalPolicyEditor() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const queryKey = ['facebook-operation-global-policy'] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => apiGet<FacebookOperationGlobalPolicyView>(
      '/api/facebook/operation-global-policy',
    ),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<GlobalDraft | null>(null);
  const [baseline, setBaseline] = useState<GlobalDraft | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: FacebookOperationGlobalPolicyWrite) =>
      apiPut<FacebookOperationGlobalPolicyView>(
        '/api/facebook/operation-global-policy',
        input,
      ),
    onSuccess: async (result) => {
      queryClient.setQueryData(queryKey, result);
      const resultDraft = draftFrom(result);
      setDraft(resultDraft);
      setBaseline(resultDraft);
      setWriteError(null);
      await queryClient.invalidateQueries({ queryKey: ['environments'] });
      const readback = await query.refetch();
      if (readback.isError || !readback.data) {
        setWriteError('全局配置已写入，但最新权威回读失败；当前表单已保留。');
        return;
      }
      const authoritative = draftFrom(readback.data);
      setDraft(authoritative);
      setBaseline(authoritative);
      setOpen(false);
      message.success('Facebook 全局运行数值已保存并完成权威回读');
    },
    onError: (error) => {
      const conflict = error instanceof ApiError && error.status === 409;
      setWriteError(conflict
        ? '全局策略已被其他操作员更新；当前表单已保留，请重新读取。'
        : errorText(error, '全局运行数值保存失败，当前表单已保留'));
    },
  });

  if (query.isLoading) {
    return <Card size="small" title="Facebook 全局运行数值"><Tag>加载中</Tag></Card>;
  }
  if (
    query.isError
    || !query.data
    || !['dev', 'ol'].includes(query.data.executionTarget)
    || !query.data.rule
    || !query.data.consumption
    || !query.data.slowStart
    || !query.data.bounds?.slowStart
  ) {
    return (
      <Card size="small" title="Facebook 全局运行数值">
        <Space>
          <Tag color="red">全局配置不可用</Tag>
          <Button size="small" onClick={() => void query.refetch()}>重试全局配置</Button>
        </Space>
      </Card>
    );
  }

  const view = query.data;
  const validationError = draft ? validateDraft(draft, view) : null;
  const dirty = draft !== null && baseline !== null && !sameDraft(draft, baseline);

  const openEditor = () => {
    const current = draftFrom(view);
    setDraft(current);
    setBaseline(current);
    setWriteError(null);
    setOpen(true);
  };

  return (
    <>
      <Card
        size="small"
        title="Facebook 全局运行数值"
        extra={<Button size="small" onClick={openEditor}>编辑全局数值</Button>}
      >
        <Space size={[8, 8]} wrap>
          <Tag color="blue">目标：{view.executionTarget.toUpperCase()}</Tag>
          <Tag>revision {view.revision}</Tag>
          <Tag>规则：{view.rule.viewsPerLike}/{view.rule.joinEveryNRounds}</Tag>
          <Tag color="purple">
            消费：{view.consumption.viewsPerLike}/
            {view.consumption.confirmedLikesPerJoin}/
            {view.consumption.confirmedJoinsPerComment}
          </Tag>
          <Tag color="orange">冷启动：{view.slowStart.totalDays} 天</Tag>
          <Typography.Text type="secondary">
            环境可选择继承这些节奏，或保留独立配置；冷启动数值仅使用全局配置。
          </Typography.Text>
        </Space>
      </Card>

      <Modal
        title={`Facebook 全局运行数值 · ${view.executionTarget.toUpperCase()}`}
        open={open}
        width={1080}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
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
              if (!draft) return;
              save.mutate({
                expectedRevision: view.revision,
                rule: { ...draft.rule },
                consumption: { ...draft.consumption },
                slowStart: {
                  totalDays: draft.slowStart.totalDays,
                  dailyCaps: draft.slowStart.dailyCaps.map((row) => ({ ...row })),
                },
              });
            }}
          >
            保存全局数值
          </Button>,
        ]}
        destroyOnHidden
      >
        {draft ? (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {writeError ? <Alert type="error" showIcon message={writeError} /> : null}
            <Alert
              type="info"
              showIcon
              message="全局节奏变更只推进继承环境的 policy revision"
              description="独立配置环境不会改变；冷启动中的环境保留当前天数，已毕业环境不会因延长总天数重新进入。"
            />

            <Space direction="vertical" size={8}>
              <Typography.Title level={5}>规则模式全局节奏</Typography.Title>
              <Space wrap>
                <Typography.Text>每浏览</Typography.Text>
                <InputNumber
                  aria-label="全局规则模式浏览点赞阈值"
                  precision={0}
                  value={draft.rule.viewsPerLike}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? { ...current, rule: { ...current.rule, viewsPerLike: value } }
                    : current)}
                />
                <Typography.Text>条点赞一次</Typography.Text>
                <Typography.Text>每</Typography.Text>
                <InputNumber
                  aria-label="全局规则模式加群轮次"
                  precision={0}
                  value={draft.rule.joinEveryNRounds}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? { ...current, rule: { ...current.rule, joinEveryNRounds: value } }
                    : current)}
                />
                <Typography.Text>轮加群联系评论一次</Typography.Text>
              </Space>
            </Space>

            <Space direction="vertical" size={8}>
              <Typography.Title level={5}>消费模式全局节奏</Typography.Title>
              <Space wrap>
                <Typography.Text>浏览</Typography.Text>
                <InputNumber
                  aria-label="全局消费模式浏览点赞阈值"
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
                <Typography.Text>→ 点赞；确认新点赞</Typography.Text>
                <InputNumber
                  aria-label="全局消费模式确认点赞加群阈值"
                  precision={0}
                  value={draft.consumption.confirmedLikesPerJoin}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? {
                        ...current,
                        consumption: {
                          ...current.consumption,
                          confirmedLikesPerJoin: value,
                        },
                      }
                    : current)}
                />
                <Typography.Text>→ 加群；确认新加群</Typography.Text>
                <InputNumber
                  aria-label="全局消费模式确认加群评论阈值"
                  precision={0}
                  value={draft.consumption.confirmedJoinsPerComment}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? {
                        ...current,
                        consumption: {
                          ...current.consumption,
                          confirmedJoinsPerComment: value,
                        },
                      }
                    : current)}
                />
                <Typography.Text>→ 历史群评论</Typography.Text>
              </Space>
            </Space>

            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Title level={5}>冷启动全局上限</Typography.Title>
              <Space wrap>
                <Typography.Text>总天数</Typography.Text>
                <InputNumber
                  aria-label="全局冷启动总天数"
                  precision={0}
                  min={view.bounds.slowStart.totalDays.min}
                  max={view.bounds.slowStart.totalDays.max}
                  value={draft.slowStart.totalDays}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => {
                    if (!current || value === null || !Number.isInteger(value)) return current;
                    return {
                      ...current,
                      slowStart: {
                        totalDays: value,
                        dailyCaps: resizeDailyCaps(current.slowStart.dailyCaps, value),
                      },
                    };
                  })}
                />
                <Typography.Text type="secondary">
                  增加天数时复制当前最后一天上限，可继续逐天调整。
                </Typography.Text>
              </Space>
              {draft.slowStart.dailyCaps.map((row, index) => (
                <Card key={row.day} size="small" title={`第 ${row.day} 天`}>
                  <Space size={[8, 8]} wrap>
                    {DAILY_CAP_FIELDS.map((field) => (
                      <Space key={field.key} size={4}>
                        <Typography.Text>{field.label}</Typography.Text>
                        <InputNumber
                          aria-label={`冷启动第${row.day}天${field.label}上限`}
                          precision={0}
                          min={view.bounds.slowStart.dailyCaps[field.key].min}
                          max={view.bounds.slowStart.dailyCaps[field.key].max}
                          value={row[field.key]}
                          disabled={save.isPending}
                          onChange={(value) => setDraft((current) => {
                            if (!current || value === null) return current;
                            const dailyCaps = current.slowStart.dailyCaps.map((candidate, rowIndex) =>
                              rowIndex === index
                                ? { ...candidate, [field.key]: value }
                                : candidate);
                            return {
                              ...current,
                              slowStart: { ...current.slowStart, dailyCaps },
                            };
                          })}
                        />
                      </Space>
                    ))}
                  </Space>
                </Card>
              ))}
            </Space>
            {validationError ? (
              <Typography.Text type="danger">{validationError}</Typography.Text>
            ) : null}
          </Space>
        ) : null}
      </Modal>
    </>
  );
}
