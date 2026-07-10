import type { FacebookGroupImportItem } from './facebookGroupImportParser';

export const FACEBOOK_GROUP_CSV_MAX_BYTES = 5 * 1024 * 1024;
export const FACEBOOK_GROUP_CSV_TEMPLATE_FILENAME = 'facebook-group-import-template.csv';

const TEMPLATE_HEADERS = ['群组URL', '区域', '园区', '方向', '群组名称'] as const;

type ImportField = 'url' | 'region' | 'park' | 'direction' | 'name';

const HEADER_FIELDS: Record<string, ImportField> = {
  url: 'url',
  groupurl: 'url',
  facebookgroupurl: 'url',
  群组url: 'url',
  群组网址: 'url',
  region: 'region',
  区域: 'region',
  park: 'park',
  园区: 'park',
  direction: 'direction',
  方向: 'direction',
  name: 'name',
  groupname: 'name',
  群组名称: 'name',
  名称: 'name',
};

export interface FacebookGroupCsvParseResult {
  items: FacebookGroupImportItem[];
  skippedRows: number;
}

export class FacebookGroupCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacebookGroupCsvError';
  }
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const finishField = () => {
    row.push(field.trim());
    field = '';
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      finishField();
    } else if (char === '\n') {
      finishRow();
    } else if (char === '\r') {
      if (text[index + 1] === '\n') index += 1;
      finishRow();
    } else {
      field += char;
    }
  }

  if (quoted) {
    throw new FacebookGroupCsvError('CSV 存在未闭合的引号，请检查文件格式');
  }
  if (field.length > 0 || row.length > 0) finishRow();

  return rows.filter((cells) => cells.some((cell) => cell.length > 0));
}

function optionalValue(row: string[], index: number | undefined): string | undefined {
  if (index === undefined) return undefined;
  const value = row[index]?.trim();
  return value || undefined;
}

export function validateFacebookGroupCsvFile(file: { name: string; size: number }): void {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new FacebookGroupCsvError('仅支持 CSV 文件');
  }
  if (file.size > FACEBOOK_GROUP_CSV_MAX_BYTES) {
    throw new FacebookGroupCsvError('CSV 文件不能超过 5 MB');
  }
}

export function parseFacebookGroupCsv(text: string): FacebookGroupCsvParseResult {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    throw new FacebookGroupCsvError('CSV 文件为空');
  }

  const fields = new Map<ImportField, number>();
  rows[0].forEach((header, index) => {
    const fieldName = HEADER_FIELDS[normalizeHeader(header)];
    if (fieldName && !fields.has(fieldName)) fields.set(fieldName, index);
  });

  const urlIndex = fields.get('url');
  if (urlIndex === undefined) {
    throw new FacebookGroupCsvError('CSV 缺少“群组URL”列，请使用下载模板');
  }

  const items: FacebookGroupImportItem[] = [];
  let skippedRows = 0;
  for (const row of rows.slice(1)) {
    const url = row[urlIndex]?.trim();
    if (!url) {
      skippedRows += 1;
      continue;
    }

    const item: FacebookGroupImportItem = { url };
    const region = optionalValue(row, fields.get('region'));
    const park = optionalValue(row, fields.get('park'));
    const direction = optionalValue(row, fields.get('direction'));
    const name = optionalValue(row, fields.get('name'));
    if (region) item.region = region;
    if (park) item.park = park;
    if (direction) item.direction = direction;
    if (name) item.name = name;
    items.push(item);
  }

  if (items.length === 0) {
    throw new FacebookGroupCsvError('CSV 中没有可导入的群组 URL');
  }
  return { items, skippedRows };
}

export function facebookGroupCsvTemplate(): string {
  return `\uFEFF${TEMPLATE_HEADERS.join(',')}\r\n`;
}

export function downloadFacebookGroupCsvTemplate(): void {
  const blobUrl = URL.createObjectURL(new Blob([facebookGroupCsvTemplate()], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = FACEBOOK_GROUP_CSV_TEMPLATE_FILENAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}
