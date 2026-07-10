import { describe, expect, it } from 'vitest';
import { parseFacebookGroupImportText } from './facebookGroupImportParser';

describe('parseFacebookGroupImportText', () => {
  it('parses URL-only text without metadata', () => {
    expect(
      parseFacebookGroupImportText(
        'https://www.facebook.com/groups/162891655741492/?ref=share\nhttps://www.facebook.com/groups/abc/posts/1',
      ),
    ).toEqual([
      { url: 'https://www.facebook.com/groups/162891655741492/?ref=share' },
      { url: 'https://www.facebook.com/groups/abc/posts/1' },
    ]);
  });

  it('parses wide region and park spreadsheet columns', () => {
    const text = [
      '\t河南区域\t\t北宁区域',
      '序号\t同文1工业区\t序号\t周山工业区/VSIP 1',
      '1\thttps://www.facebook.com/groups/162891655741492/?__cft__[0]=x\t401\thttps://www.facebook.com/groups/285000599260908/',
    ].join('\n');

    expect(parseFacebookGroupImportText(text)).toEqual([
      {
        url: 'https://www.facebook.com/groups/162891655741492/?__cft__[0]=x',
        region: '河南区域',
        park: '同文1工业区',
      },
      {
        url: 'https://www.facebook.com/groups/285000599260908/',
        region: '北宁区域',
        park: '周山工业区/VSIP 1',
      },
    ]);
  });

  it('parses trailing direction columns separately from parks', () => {
    const text = [
      '\t北江区域\t\t',
      '序号\t越韩工业区\t河南技术\t机械和电气',
      '2101\thttps://www.facebook.com/groups/1512651993618094/\t2201 https://www.facebook.com/groups/tuyendungvieclamkythuatt/\t2301 https://www.facebook.com/groups/tuyendungcokhi/',
    ].join('\n');

    expect(parseFacebookGroupImportText(text)).toEqual([
      {
        url: 'https://www.facebook.com/groups/1512651993618094/',
        region: '北江区域',
        park: '越韩工业区',
      },
      {
        url: 'https://www.facebook.com/groups/tuyendungvieclamkythuatt/',
        direction: '河南技术',
      },
      {
        url: 'https://www.facebook.com/groups/tuyendungcokhi/',
        direction: '机械和电气',
      },
    ]);
  });
});
