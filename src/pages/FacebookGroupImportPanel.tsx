import { useMemo, useState } from 'react';
import { Alert, Button, Input, Segmented, Select, Space, Switch, Typography, Upload } from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import {
  DownloadOutlined,
  FileTextOutlined,
  InboxOutlined,
  LinkOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import type { FacebookGroupTargetFacets } from '../types/api';
import type { FacebookGroupImportItem } from './facebookGroupImportParser';
import {
  FacebookGroupCsvError,
  downloadFacebookGroupCsvTemplate,
  parseFacebookGroupCsv,
  validateFacebookGroupCsvFile,
} from './facebookGroupCsvImport';

export type FacebookGroupImportMode = 'single' | 'csv';

interface CsvSelection {
  file: UploadFile;
  items: FacebookGroupImportItem[];
  skippedRows: number;
}

export interface FacebookGroupImportPanelProps {
  facets?: FacebookGroupTargetFacets;
  facetsLoading?: boolean;
  importing?: boolean;
  onImport: (
    items: FacebookGroupImportItem[],
    mode: FacebookGroupImportMode,
    accountGroupLabels?: string[],
  ) => Promise<void>;
}

function errorText(error: unknown): string {
  if (error instanceof FacebookGroupCsvError) return error.message;
  return '读取 CSV 失败，请检查文件后重试';
}

export function FacebookGroupImportPanel({
  facets,
  facetsLoading = false,
  importing = false,
  onImport,
}: FacebookGroupImportPanelProps) {
  const [mode, setMode] = useState<FacebookGroupImportMode>('single');
  const [singleUrl, setSingleUrl] = useState('');
  const [singleRegion, setSingleRegion] = useState<string>();
  const [singlePark, setSinglePark] = useState<string>();
  const [singleDirection, setSingleDirection] = useState<string>();
  const [csvSelection, setCsvSelection] = useState<CsvSelection>();
  const [csvError, setCsvError] = useState<string>();
  const [readingCsv, setReadingCsv] = useState(false);
  const [replaceScopes, setReplaceScopes] = useState(false);
  const [accountGroupLabels, setAccountGroupLabels] = useState<string[]>([]);

  const regionOptions = useMemo(
    () => (facets?.regions ?? []).map((item) => ({ value: item.region, label: item.region })),
    [facets],
  );
  const directionOptions = useMemo(
    () => (facets?.directions ?? []).map((item) => ({ value: item, label: item })),
    [facets],
  );
  const accountGroupOptions = useMemo(
    () => (facets?.accountGroupLabels ?? []).map((item) => ({ value: item, label: item })),
    [facets],
  );

  const importItems = (
    items: FacebookGroupImportItem[],
    importMode: FacebookGroupImportMode,
  ) =>
    replaceScopes
      ? onImport(items, importMode, accountGroupLabels)
      : onImport(items, importMode);

  const resetScopeDraft = () => {
    setReplaceScopes(false);
    setAccountGroupLabels([]);
  };
  const parkOptions = useMemo(
    () =>
      singleRegion
        ? (facets?.regions.find((item) => item.region === singleRegion)?.parks ?? []).map((item) => ({ value: item, label: item }))
        : [],
    [facets, singleRegion],
  );

  const submitSingle = async () => {
    const url = singleUrl.trim();
    if (!url) return;
    const item: FacebookGroupImportItem = { url };
    if (singleRegion) item.region = singleRegion;
    if (singlePark) item.park = singlePark;
    if (singleDirection) item.direction = singleDirection;

    try {
      await importItems([item], 'single');
      setSingleUrl('');
      setSingleRegion(undefined);
      setSinglePark(undefined);
      setSingleDirection(undefined);
      resetScopeDraft();
    } catch {
      // The page mutation owns operator-facing request errors.
    }
  };

  const readCsvFile = async (file: File & { uid: string }) => {
    setReadingCsv(true);
    setCsvError(undefined);
    setCsvSelection(undefined);
    try {
      validateFacebookGroupCsvFile(file);
      const parsed = parseFacebookGroupCsv(await file.text());
      setCsvSelection({
        file: { uid: file.uid, name: file.name, size: file.size, type: file.type, status: 'done' },
        items: parsed.items,
        skippedRows: parsed.skippedRows,
      });
    } catch (error) {
      setCsvError(errorText(error));
    } finally {
      setReadingCsv(false);
    }
  };

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    void readCsvFile(file);
    return Upload.LIST_IGNORE;
  };

  const submitCsv = async () => {
    if (!csvSelection) return;
    try {
      await importItems(csvSelection.items, 'csv');
      setCsvSelection(undefined);
      setCsvError(undefined);
      resetScopeDraft();
    } catch {
      // The page mutation owns operator-facing request errors.
    }
  };

  return (
    <section className="facebook-group-import" aria-label="添加群组">
      <div className="facebook-group-import__header">
        <Typography.Text strong>添加群组</Typography.Text>
        <Segmented<FacebookGroupImportMode>
          value={mode}
          options={[
            { value: 'single', label: '单条添加', icon: <PlusOutlined /> },
            { value: 'csv', label: '文件导入', icon: <FileTextOutlined /> },
          ]}
          onChange={setMode}
        />
      </div>

      <div className="facebook-group-import__scope">
        <Space size={8} wrap>
          <Switch
            aria-label="本次设置适用账号分组"
            checked={replaceScopes}
            onChange={setReplaceScopes}
          />
          <Typography.Text>本次设置适用账号分组</Typography.Text>
        </Space>
        <Select
          aria-label="导入适用账号分组"
          mode="multiple"
          allowClear
          showSearch
          optionFilterProp="label"
          value={accountGroupLabels}
          options={accountGroupOptions}
          placeholder="选择一个或多个账号分组"
          disabled={!replaceScopes}
          loading={facetsLoading}
          onChange={setAccountGroupLabels}
          style={{ minWidth: 280 }}
        />
        <Typography.Text type="secondary">
          {replaceScopes
            ? accountGroupLabels.length > 0
              ? `将统一归属到 ${accountGroupLabels.length} 个账号分组`
              : '将明确清空适用分组；未设置范围的群组不会被自动加入'
            : '保持已存在群组的适用分组不变；新群组将保持未设置范围'}
        </Typography.Text>
      </div>

      {mode === 'single' ? (
        <div className="facebook-group-import__single">
          <Input
            aria-label="群组 URL"
            prefix={<LinkOutlined />}
            value={singleUrl}
            placeholder="Facebook 群组 URL"
            onChange={(event) => setSingleUrl(event.target.value)}
            onPressEnter={() => void submitSingle()}
          />
          <Select
            aria-label="添加区域"
            allowClear
            showSearch
            optionFilterProp="label"
            value={singleRegion}
            options={regionOptions}
            placeholder="区域（可选）"
            loading={facetsLoading}
            onChange={(value) => {
              setSingleRegion(value);
              setSinglePark(undefined);
            }}
          />
          <Select
            aria-label="添加园区"
            allowClear
            showSearch
            optionFilterProp="label"
            value={singlePark}
            options={parkOptions}
            placeholder="园区（可选）"
            disabled={!singleRegion}
            loading={facetsLoading}
            onChange={setSinglePark}
          />
          <Select
            aria-label="添加方向"
            allowClear
            showSearch
            optionFilterProp="label"
            value={singleDirection}
            options={directionOptions}
            placeholder="方向（可选）"
            loading={facetsLoading}
            onChange={setSingleDirection}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={importing}
            disabled={!singleUrl.trim()}
            onClick={() => void submitSingle()}
          >
            添加
          </Button>
        </div>
      ) : (
        <div className="facebook-group-import__csv">
          <Upload.Dragger
            aria-label="选择 CSV 文件"
            accept=".csv,text/csv"
            maxCount={1}
            disabled={readingCsv || importing}
            beforeUpload={beforeUpload}
            fileList={csvSelection ? [csvSelection.file] : []}
            onRemove={() => {
              setCsvSelection(undefined);
              setCsvError(undefined);
              return true;
            }}
            showUploadList={{ showRemoveIcon: !importing }}
          >
            <InboxOutlined className="facebook-group-import__upload-icon" />
            <Typography.Text>选择或拖入 CSV 文件</Typography.Text>
            <Typography.Text type="secondary">最大 5 MB</Typography.Text>
          </Upload.Dragger>

          {csvError ? <Alert type="error" showIcon message={csvError} /> : null}
          {csvSelection ? (
            <Alert
              type="success"
              showIcon
              message={`可导入 ${csvSelection.items.length} 行`}
              description={csvSelection.skippedRows > 0 ? `另有 ${csvSelection.skippedRows} 行因群组 URL 为空已跳过` : undefined}
            />
          ) : null}

          <Space className="facebook-group-import__csv-actions" wrap>
            <Button icon={<DownloadOutlined />} onClick={downloadFacebookGroupCsvTemplate}>
              下载 CSV 模板
            </Button>
            <Button
              type="primary"
              icon={<FileTextOutlined />}
              loading={importing || readingCsv}
              disabled={!csvSelection}
              onClick={() => void submitCsv()}
            >
              导入文件
            </Button>
          </Space>
        </div>
      )}
    </section>
  );
}
