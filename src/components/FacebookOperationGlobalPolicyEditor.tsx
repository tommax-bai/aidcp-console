import { useState } from 'react';
import { EditOutlined } from '@ant-design/icons';
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

interface PolicyNumberFieldProps {
  ariaLabel: string;
  disabled: boolean;
  hint?: string;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number | null) => void;
  suffix: string;
  value: number;
}

function PolicyNumberField({
  ariaLabel,
  disabled,
  hint,
  label,
  max,
  min,
  onChange,
  suffix,
  value,
}: PolicyNumberFieldProps) {
  return (
    <label className="facebook-global-policy-field">
      <span className="facebook-global-policy-field__label">{label}</span>
      <span className="facebook-global-policy-field__control">
        <InputNumber
          aria-label={ariaLabel}
          precision={0}
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
        <span className="facebook-global-policy-field__suffix">{suffix}</span>
      </span>
      {hint ? <span className="facebook-global-policy-field__hint">{hint}</span> : null}
    </label>
  );
}

function PolicyMetric({
  label,
  suffix,
  value,
}: {
  label: string;
  suffix: string;
  value: number;
}) {
  return (
    <div className="facebook-global-policy-metric">
      <span className="facebook-global-policy-metric__label">{label}</span>
      <span>
        <strong className="facebook-global-policy-metric__value tabular-nums">{value}</strong>
        <span className="facebook-global-policy-metric__suffix">{suffix}</span>
      </span>
    </div>
  );
}

function formatUpdatedAt(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '更新时间未知';
}

function draftFrom(view: FacebookOperationGlobalPolicyView): GlobalDraft {
  return {
    rule: { ...view.rule },
    consumption: { ...view.consumption },
    reels: {
      persona: { ...view.reels.persona },
      slowStart: { ...view.reels.slowStart },
      rule: { ...view.reels.rule },
      consumption: { ...view.reels.consumption },
    },
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
    ['普通人设 Reel 浏览点赞阈值', draft.reels.persona.viewsPerLike, view.bounds.reels.persona.viewsPerLike],
    ['普通人设 Reel 浏览关注阈值', draft.reels.persona.viewsPerFollow, view.bounds.reels.persona.viewsPerFollow],
    ['冷启动 Reel 浏览关注阈值', draft.reels.slowStart.viewsPerFollow, view.bounds.reels.slowStart.viewsPerFollow],
    ['规则模式 Reel 浏览关注阈值', draft.reels.rule.viewsPerFollow, view.bounds.reels.rule.viewsPerFollow],
    ['消费模式 Reel 浏览关注阈值', draft.reels.consumption.viewsPerFollow, view.bounds.reels.consumption.viewsPerFollow],
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
    || !query.data.reels
    || !query.data.bounds?.reels
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
        className="facebook-global-policy-card"
        title={(
          <div className="facebook-global-policy-card__title">
            <span>Facebook 全局运行数值</span>
            <Tag color={view.executionTarget === 'dev' ? 'blue' : 'gold'}>
              {view.executionTarget.toUpperCase()}
            </Tag>
          </div>
        )}
        extra={(
          <div className="facebook-global-policy-card__actions">
            <Typography.Text type="secondary" className="tabular-nums">
              revision {view.revision}
            </Typography.Text>
            <Button
              type="primary"
              size="small"
              aria-label="编辑全局数值"
              icon={<EditOutlined aria-hidden />}
              onClick={openEditor}
            >
              编辑全局数值
            </Button>
          </div>
        )}
      >
        <section
          aria-label="Facebook 全局运行数值摘要"
          className="facebook-global-policy-summary"
        >
          <article className="facebook-global-policy-summary__group is-persona">
            <header>
              <span className="facebook-global-policy-summary__eyebrow">普通人设</span>
              <strong>Reel 节奏</strong>
            </header>
            <div className="facebook-global-policy-summary__metrics">
              <PolicyMetric
                label="点赞"
                value={view.reels.persona.viewsPerLike}
                suffix="次浏览 / 次"
              />
              <PolicyMetric
                label="关注"
                value={view.reels.persona.viewsPerFollow}
                suffix="次浏览 / 次"
              />
            </div>
          </article>

          <article className="facebook-global-policy-summary__group is-rule">
            <header>
              <span className="facebook-global-policy-summary__eyebrow">规则模式</span>
              <strong>内容与群组节奏</strong>
            </header>
            <div className="facebook-global-policy-summary__metrics">
              <PolicyMetric label="点赞" value={view.rule.viewsPerLike} suffix="条浏览 / 次" />
              <PolicyMetric label="加群联系" value={view.rule.joinEveryNRounds} suffix="轮 / 次" />
              <PolicyMetric
                label="Reel 关注"
                value={view.reels.rule.viewsPerFollow}
                suffix="次浏览 / 次"
              />
            </div>
          </article>

          <article className="facebook-global-policy-summary__group is-consumption">
            <header>
              <span className="facebook-global-policy-summary__eyebrow">消费模式</span>
              <strong>确认结果驱动</strong>
            </header>
            <div className="facebook-global-policy-summary__metrics">
              <PolicyMetric
                label="点赞"
                value={view.consumption.viewsPerLike}
                suffix="条浏览 / 次"
              />
              <PolicyMetric
                label="加群"
                value={view.consumption.confirmedLikesPerJoin}
                suffix="次确认点赞 / 次"
              />
              <PolicyMetric
                label="评论"
                value={view.consumption.confirmedJoinsPerComment}
                suffix="次确认加群 / 次"
              />
              <PolicyMetric
                label="Reel 关注"
                value={view.reels.consumption.viewsPerFollow}
                suffix="次浏览 / 次"
              />
            </div>
          </article>

          <article className="facebook-global-policy-summary__group is-slow-start">
            <header>
              <span className="facebook-global-policy-summary__eyebrow">冷启动</span>
              <strong>分天动作上限</strong>
            </header>
            <div className="facebook-global-policy-summary__metrics">
              <PolicyMetric label="周期" value={view.slowStart.totalDays} suffix="天" />
              <PolicyMetric
                label="Reel 关注"
                value={view.reels.slowStart.viewsPerFollow}
                suffix="次浏览 / 次"
              />
            </div>
          </article>
        </section>

        <div className="facebook-global-policy-card__note">
          <Typography.Text type="secondary">
            Reel 点赞与关注节奏由全局策略统一管理；达到阈值只产生动作意图，仍需通过风险、配额、冷却与平台结果确认。
          </Typography.Text>
          <Typography.Text type="secondary" className="tabular-nums">
            {formatUpdatedAt(view.updatedAt)}{view.updatedBy ? ` · ${view.updatedBy}` : ''}
          </Typography.Text>
        </div>
      </Card>

      <Modal
        title={(
          <div className="facebook-global-policy-modal__title">
            <span>Facebook 全局运行数值</span>
            <Tag color={view.executionTarget === 'dev' ? 'blue' : 'gold'}>
              {view.executionTarget.toUpperCase()}
            </Tag>
            <Typography.Text type="secondary" className="tabular-nums">
              revision {view.revision}
            </Typography.Text>
          </div>
        )}
        open={open}
        width={1180}
        className="facebook-global-policy-modal"
        styles={{ body: { maxHeight: '76vh', overflowY: 'auto' } }}
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
                reels: {
                  persona: { ...draft.reels.persona },
                  slowStart: { ...draft.reels.slowStart },
                  rule: { ...draft.reels.rule },
                  consumption: { ...draft.reels.consumption },
                },
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
          <div className="facebook-global-policy-editor">
            {writeError ? <Alert type="error" showIcon message={writeError} /> : null}
            <Alert
              type="info"
              showIcon
              message="这里配置的是全局节奏，不代表平台动作已经成功"
              description="普通人设点赞只统计 Reel 浏览。达到阈值时仅产生一次动作意图，Feed、详情页和其他模式不会复用该计数；最终结果仍以平台确认回读为准。"
            />

            <section aria-label="普通人设 Reel 节奏" className="facebook-global-policy-section is-persona">
              <header className="facebook-global-policy-section__header">
                <div>
                  <Typography.Title level={5}>普通人设 · Reel 节奏</Typography.Title>
                  <Typography.Text type="secondary">仅统计普通人设模式下确认识别的 Reel 浏览。</Typography.Text>
                </div>
                <Tag color="cyan">Reel 专属</Tag>
              </header>
              <div className="facebook-global-policy-fields is-two-column">
                <PolicyNumberField
                  ariaLabel="普通人设 Reel 浏览点赞阈值"
                  label="点赞频率"
                  suffix="个 Reel / 点赞 1 次"
                  value={draft.reels.persona.viewsPerLike}
                  min={view.bounds.reels.persona.viewsPerLike.min}
                  max={view.bounds.reels.persona.viewsPerLike.max}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? {
                        ...current,
                        reels: {
                          ...current.reels,
                          persona: { ...current.reels.persona, viewsPerLike: value },
                        },
                      }
                    : current)}
                />
                <PolicyNumberField
                  ariaLabel="普通人设 Reel 浏览关注阈值"
                  label="关注频率"
                  suffix="个 Reel / 关注 1 次"
                  value={draft.reels.persona.viewsPerFollow}
                  min={view.bounds.reels.persona.viewsPerFollow.min}
                  max={view.bounds.reels.persona.viewsPerFollow.max}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? {
                        ...current,
                        reels: {
                          ...current.reels,
                          persona: { ...current.reels.persona, viewsPerFollow: value },
                        },
                      }
                    : current)}
                />
              </div>
            </section>

            <section aria-label="规则模式全局节奏" className="facebook-global-policy-section is-rule">
              <header className="facebook-global-policy-section__header">
                <div>
                  <Typography.Title level={5}>规则模式</Typography.Title>
                  <Typography.Text type="secondary">按浏览轮次触发点赞、加群联系和 Reel 关注意图。</Typography.Text>
                </div>
                <Tag color="blue">轮次驱动</Tag>
              </header>
              <div className="facebook-global-policy-fields is-three-column">
                <PolicyNumberField
                  ariaLabel="全局规则模式浏览点赞阈值"
                  label="点赞频率"
                  suffix="条内容 / 点赞 1 次"
                  value={draft.rule.viewsPerLike}
                  min={view.bounds.rule.viewsPerLike.min}
                  max={view.bounds.rule.viewsPerLike.max}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? { ...current, rule: { ...current.rule, viewsPerLike: value } }
                    : current)}
                />
                <PolicyNumberField
                  ariaLabel="全局规则模式加群轮次"
                  label="加群联系频率"
                  suffix="轮 / 加群联系 1 次"
                  value={draft.rule.joinEveryNRounds}
                  min={view.bounds.rule.joinEveryNRounds.min}
                  max={view.bounds.rule.joinEveryNRounds.max}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? { ...current, rule: { ...current.rule, joinEveryNRounds: value } }
                    : current)}
                />
                <PolicyNumberField
                  ariaLabel="规则模式 Reel 浏览关注阈值"
                  label="Reel 关注频率"
                  suffix="个 Reel / 关注 1 次"
                  value={draft.reels.rule.viewsPerFollow}
                  min={view.bounds.reels.rule.viewsPerFollow.min}
                  max={view.bounds.reels.rule.viewsPerFollow.max}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? {
                        ...current,
                        reels: { ...current.reels, rule: { viewsPerFollow: value } },
                      }
                    : current)}
                />
              </div>
            </section>

            <section aria-label="消费模式全局节奏" className="facebook-global-policy-section is-consumption">
              <header className="facebook-global-policy-section__header">
                <div>
                  <Typography.Title level={5}>消费模式</Typography.Title>
                  <Typography.Text type="secondary">后续动作只累计平台已确认的新点赞与新加群。</Typography.Text>
                </div>
                <Tag color="purple">确认结果驱动</Tag>
              </header>
              <div className="facebook-global-policy-fields is-four-column">
                <PolicyNumberField
                  ariaLabel="全局消费模式浏览点赞阈值"
                  label="点赞频率"
                  suffix="条内容 / 点赞 1 次"
                  value={draft.consumption.viewsPerLike}
                  min={view.bounds.consumption.viewsPerLike.min}
                  max={view.bounds.consumption.viewsPerLike.max}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? { ...current, consumption: { ...current.consumption, viewsPerLike: value } }
                    : current)}
                />
                <PolicyNumberField
                  ariaLabel="全局消费模式确认点赞加群阈值"
                  label="加群频率"
                  suffix="次确认点赞 / 加群 1 次"
                  value={draft.consumption.confirmedLikesPerJoin}
                  min={view.bounds.consumption.confirmedLikesPerJoin.min}
                  max={view.bounds.consumption.confirmedLikesPerJoin.max}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? {
                        ...current,
                        consumption: { ...current.consumption, confirmedLikesPerJoin: value },
                      }
                    : current)}
                />
                <PolicyNumberField
                  ariaLabel="全局消费模式确认加群评论阈值"
                  label="历史群评论频率"
                  suffix="次确认加群 / 评论 1 次"
                  value={draft.consumption.confirmedJoinsPerComment}
                  min={view.bounds.consumption.confirmedJoinsPerComment.min}
                  max={view.bounds.consumption.confirmedJoinsPerComment.max}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? {
                        ...current,
                        consumption: { ...current.consumption, confirmedJoinsPerComment: value },
                      }
                    : current)}
                />
                <PolicyNumberField
                  ariaLabel="消费模式 Reel 浏览关注阈值"
                  label="Reel 关注频率"
                  suffix="个 Reel / 关注 1 次"
                  value={draft.reels.consumption.viewsPerFollow}
                  min={view.bounds.reels.consumption.viewsPerFollow.min}
                  max={view.bounds.reels.consumption.viewsPerFollow.max}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? {
                        ...current,
                        reels: { ...current.reels, consumption: { viewsPerFollow: value } },
                      }
                    : current)}
                />
              </div>
            </section>

            <section aria-label="冷启动全局上限" className="facebook-global-policy-section is-slow-start">
              <header className="facebook-global-policy-section__header">
                <div>
                  <Typography.Title level={5}>冷启动</Typography.Title>
                  <Typography.Text type="secondary">按天设置动作硬上限；慢启动生效时优先于其他运行模式。</Typography.Text>
                </div>
                <Tag color="orange">优先约束</Tag>
              </header>
              <div className="facebook-global-policy-fields is-two-column">
                <PolicyNumberField
                  ariaLabel="冷启动 Reel 浏览关注阈值"
                  label="Reel 关注频率"
                  suffix="个 Reel / 关注 1 次"
                  value={draft.reels.slowStart.viewsPerFollow}
                  min={view.bounds.reels.slowStart.viewsPerFollow.min}
                  max={view.bounds.reels.slowStart.viewsPerFollow.max}
                  disabled={save.isPending}
                  onChange={(value) => setDraft((current) => current && value !== null
                    ? {
                        ...current,
                        reels: { ...current.reels, slowStart: { viewsPerFollow: value } },
                      }
                    : current)}
                />
                <PolicyNumberField
                  ariaLabel="全局冷启动总天数"
                  label="冷启动周期"
                  suffix="天"
                  hint="增加天数时复制当前最后一天上限，可在下表继续调整。"
                  value={draft.slowStart.totalDays}
                  min={view.bounds.slowStart.totalDays.min}
                  max={view.bounds.slowStart.totalDays.max}
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
              </div>

              <div className="facebook-global-policy-daily__heading">
                <div>
                  <Typography.Text strong>每日动作上限</Typography.Text>
                  <Typography.Text type="secondary">0 表示当天不允许执行该动作。</Typography.Text>
                </div>
                <Typography.Text type="secondary">单位：次 / 天</Typography.Text>
              </div>
              <div className="facebook-global-policy-daily__scroll">
                <table aria-label="冷启动每日动作上限" className="facebook-global-policy-daily__table">
                  <thead>
                    <tr>
                      <th scope="col">天数</th>
                      {DAILY_CAP_FIELDS.map((field) => <th key={field.key} scope="col">{field.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {draft.slowStart.dailyCaps.map((row, index) => (
                      <tr key={row.day}>
                        <th scope="row" className="tabular-nums">第 {row.day} 天</th>
                        {DAILY_CAP_FIELDS.map((field) => (
                          <td key={field.key}>
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
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {validationError ? (
              <Alert type="error" showIcon message={validationError} />
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
