import { useState } from 'react';
import { App, Button, Form, Input, Modal, Radio, Select, Skeleton, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../api/client';
import type { FacebookCommentConfig, FacebookCommentMode, PanelAccount } from '../types/api';
import { accountName } from '../types/accountDisplay';

/**
 * Facebook 账号「FB配置」入口（关键词 + 评论方式 / 模板）。
 * 仅对 Facebook 账号展示（调用方按 platform 门控）。打开时拉当前配置回填、保存经面板 PUT。
 * 目标群由账号已加入群组账本选择；本弹窗不再编辑 legacy containers。
 */
export function FacebookSearchConfig({ account }: { account: PanelAccount }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [commentMode, setCommentMode] = useState<FacebookCommentMode>('generated');
  const [templateText, setTemplateText] = useState('');

  const path = `/api/accounts/${encodeURIComponent(account.accountId)}/facebook-comment-config`;

  const openModal = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const cfg = await apiGet<FacebookCommentConfig>(path);
      setKeywords(cfg.keywords ?? []);
      setCommentMode(cfg.commentMode ?? 'generated');
      setTemplateText((cfg.commentTemplates ?? []).join('\n'));
    } catch {
      message.error('读取搜索词配置失败');
      setKeywords([]);
      setCommentMode('generated');
      setTemplateText('');
    } finally {
      setLoading(false);
    }
  };

  const save = useMutation({
    mutationFn: (v: { keywords: string[]; commentMode: FacebookCommentMode; commentTemplates: string[] }) =>
      apiPut<FacebookCommentConfig>(path, v),
    onSuccess: () => {
      message.success('搜索词配置已保存');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: () => message.error('搜索词配置保存失败'),
  });

  const commentTemplates = (): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of templateText.split(/\r?\n/)) {
      const v = raw.trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  };

  const effectiveOff = keywords.length === 0 || (commentMode === 'template' && commentTemplates().length === 0);

  return (
    <>
      <Button size="small" onClick={openModal}>
        FB配置
      </Button>
      <Modal
        title={`FB配置 · ${accountName(account)}`}
        open={open}
        confirmLoading={save.isPending}
        onOk={() => save.mutate({ keywords, commentMode, commentTemplates: commentTemplates() })}
        onCancel={() => setOpen(false)}
        okText="保存"
        cancelText="取消"
        width={640}
      >
        {loading ? (
          <Skeleton active />
        ) : (
          <Form layout="vertical" requiredMark={false}>
            <Form.Item label="搜索关键词" extra="系统每次随机选一个关键词。输入后回车 / 逗号添加；关键词内可含空格（如「手冲 咖啡」为一个词，不会被拆开）。">
              <Select
                mode="tags"
                style={{ width: '100%' }}
                value={keywords}
                onChange={setKeywords}
                // 只用逗号分隔关键词——空格保留在词内（多词短语算一个搜索词，绝不按空格拆词）。
                tokenSeparators={[',']}
                placeholder="如：手冲 咖啡、烘焙"
              />
            </Form.Item>
            <Form.Item label="评论方式">
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                value={commentMode}
                onChange={(e) => setCommentMode(e.target.value as FacebookCommentMode)}
                options={[
                  { label: '生成评论', value: 'generated' },
                  { label: '模板评论', value: 'template' },
                ]}
              />
            </Form.Item>
            {commentMode === 'template' ? (
              <Form.Item label="评论模板" extra="每行一个模板。模板正文不应包含联系方式；带联系方式评论会自动拼接账号联系方式。">
                <Input.TextArea
                  rows={5}
                  value={templateText}
                  onChange={(e) => setTemplateText(e.target.value)}
                  placeholder="这家手冲咖啡很不错"
                />
              </Form.Item>
            ) : null}
            {effectiveOff ? (
              <Typography.Text type="warning">
                {keywords.length === 0 ? '至少需要 1 个搜索关键词。' : '模板评论至少需要 1 条模板。'}
              </Typography.Text>
            ) : null}
          </Form>
        )}
      </Modal>
    </>
  );
}
