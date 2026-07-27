import { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Empty, Input, Select, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { apiGet, apiPut } from '../api/client';
import { errorText } from '../api/errorText';
import type {
  FacebookGroupRegionFacet,
  FacebookRegionCommentTemplateList,
  FacebookRegionCommentTemplateRow,
} from '../types/api';

export function FacebookRegionCommentTemplates({
  regions,
  regionsLoading = false,
}: {
  regions: FacebookGroupRegionFacet[];
  regionsLoading?: boolean;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [region, setRegion] = useState<string>();
  const [templateText, setTemplateText] = useState('');
  const templates = useQuery({
    queryKey: ['facebook', 'groups', 'comment-templates'],
    queryFn: () =>
      apiGet<FacebookRegionCommentTemplateList>(
        '/api/facebook/groups/comment-templates',
      ),
  });
  const byRegion = useMemo(
    () =>
      new Map(
        (templates.data?.items ?? []).map((row) => [row.region, row] as const),
      ),
    [templates.data],
  );

  useEffect(() => {
    if (!region && regions[0]?.region) setRegion(regions[0].region);
  }, [region, regions]);

  useEffect(() => {
    if (!region) {
      setTemplateText('');
      return;
    }
    setTemplateText((byRegion.get(region)?.commentTemplates ?? []).join('\n'));
  }, [byRegion, region]);

  const save = useMutation({
    mutationFn: (input: { region: string; commentTemplates: string[] }) =>
      apiPut<FacebookRegionCommentTemplateRow>(
        '/api/facebook/groups/comment-templates',
        input,
      ),
    onSuccess: (row) => {
      message.success(`已保存「${row.region}」通用评论模板`);
      setTemplateText(row.commentTemplates.join('\n'));
      void qc.invalidateQueries({
        queryKey: ['facebook', 'groups', 'comment-templates'],
      });
    },
    onError: (error) =>
      message.error(errorText(error, '通用评论模板保存失败，未改变原配置')),
  });

  const current = region ? byRegion.get(region) : undefined;
  const commentTemplates = () =>
    [...new Set(templateText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];

  return (
    <Card size="small" type="inner" title="区域通用评论模板">
      {regions.length === 0 && !regionsLoading ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="群组目录暂无可配置区域"
        />
      ) : (
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Space wrap>
            <Select
              aria-label="通用评论模板区域"
              showSearch
              optionFilterProp="label"
              value={region}
              options={regions.map((item) => ({
                value: item.region,
                label: item.region,
              }))}
              placeholder="选择区域"
              loading={regionsLoading}
              style={{ minWidth: 200 }}
              onChange={setRegion}
            />
            <Typography.Text type="secondary">
              {current
                ? `最近更新：${dayjs(current.updatedAt).format('YYYY-MM-DD HH:mm')} · ${current.updatedBy}`
                : '该区域尚未设置通用模板'}
            </Typography.Text>
          </Space>
          <Input.TextArea
            aria-label="区域通用评论模板"
            rows={5}
            value={templateText}
            placeholder="每行一条评论模板"
            onChange={(event) => setTemplateText(event.target.value)}
          />
          <Space wrap>
            <Button
              type="primary"
              loading={save.isPending}
              disabled={!region}
              onClick={() => {
                if (!region) return;
                save.mutate({ region, commentTemplates: commentTemplates() });
              }}
            >
              保存区域模板
            </Button>
            <Typography.Text type="secondary">
              每行一条；账号模板为空时，系统按本次目标群的区域使用这里的模板。
            </Typography.Text>
          </Space>
        </Space>
      )}
    </Card>
  );
}
