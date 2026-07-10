import { describe, expect, it } from 'vitest';
import {
  FACEBOOK_GROUP_CSV_MAX_BYTES,
  FACEBOOK_GROUP_CSV_TEMPLATE_FILENAME,
  FacebookGroupCsvError,
  facebookGroupCsvTemplate,
  parseFacebookGroupCsv,
  validateFacebookGroupCsvFile,
} from './facebookGroupCsvImport';

describe('parseFacebookGroupCsv', () => {
  it('parses the Chinese template with optional metadata', () => {
    const result = parseFacebookGroupCsv(
      '\uFEFF群组URL,区域,园区,方向,群组名称\r\n' +
        'https://www.facebook.com/groups/123,河南区域,同文1工业区,机械和电气,测试群组\r\n' +
        'https://www.facebook.com/groups/456,,,,\r\n',
    );

    expect(result).toEqual({
      items: [
        {
          url: 'https://www.facebook.com/groups/123',
          region: '河南区域',
          park: '同文1工业区',
          direction: '机械和电气',
          name: '测试群组',
        },
        { url: 'https://www.facebook.com/groups/456' },
      ],
      skippedRows: 0,
    });
  });

  it('accepts English aliases and parses quoted commas and escaped quotes', () => {
    const result = parseFacebookGroupCsv(
      'group_url,region,park,direction,group_name\n' +
        'https://www.facebook.com/groups/abc,北宁区域,"周山工业区, VSIP 1",,"招聘""技术""群"',
    );

    expect(result.items[0]).toEqual({
      url: 'https://www.facebook.com/groups/abc',
      region: '北宁区域',
      park: '周山工业区, VSIP 1',
      name: '招聘"技术"群',
    });
  });

  it('ignores empty rows and counts non-empty rows without a URL', () => {
    expect(parseFacebookGroupCsv('群组URL,区域\n,河南区域\n\nhttps://www.facebook.com/groups/789,')).toEqual({
      items: [{ url: 'https://www.facebook.com/groups/789' }],
      skippedRows: 1,
    });
  });

  it('rejects malformed files and missing importable rows', () => {
    expect(() => parseFacebookGroupCsv('区域,园区\n河南区域,同文1工业区')).toThrow('缺少“群组URL”列');
    expect(() => parseFacebookGroupCsv('群组URL,区域\n,河南区域')).toThrow('没有可导入的群组 URL');
    expect(() => parseFacebookGroupCsv('群组URL,名称\nhttps://example.com,"未闭合')).toThrow('未闭合的引号');
  });
});

describe('Facebook group CSV file and template', () => {
  it('validates file type and size', () => {
    expect(() => validateFacebookGroupCsvFile({ name: 'groups.csv', size: FACEBOOK_GROUP_CSV_MAX_BYTES })).not.toThrow();
    expect(() => validateFacebookGroupCsvFile({ name: 'groups.xlsx', size: 100 })).toThrow(FacebookGroupCsvError);
    expect(() => validateFacebookGroupCsvFile({ name: 'groups.csv', size: FACEBOOK_GROUP_CSV_MAX_BYTES + 1 })).toThrow(
      '不能超过 5 MB',
    );
  });

  it('builds a BOM-prefixed header-only template', () => {
    expect(FACEBOOK_GROUP_CSV_TEMPLATE_FILENAME).toBe('facebook-group-import-template.csv');
    expect(facebookGroupCsvTemplate()).toBe('\uFEFF群组URL,区域,园区,方向,群组名称\r\n');
  });
});
