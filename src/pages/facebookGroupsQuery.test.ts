import { describe, expect, it } from 'vitest';
import { facebookGroupListPath } from './facebookGroupsQuery';

describe('facebookGroupListPath', () => {
  it('keeps metadata filters optional', () => {
    expect(facebookGroupListPath({ status: 'all', enabled: 'all', page: 1 })).toBe('/api/facebook/groups?limit=30&offset=0');
  });

  it('builds status, enabled, metadata, and exact account-group query params', () => {
    expect(
      facebookGroupListPath({
        status: 'joined',
        enabled: 'true',
        page: 2,
        region: '北宁区域',
        park: '周山工业区/VSIP 1',
        direction: '机械和电气',
        accountScopeMode: 'restricted',
        accountGroupLabel: '越南销售一组',
      }),
    ).toBe(
      '/api/facebook/groups?limit=30&offset=30&status=joined&enabled=true&region=%E5%8C%97%E5%AE%81%E5%8C%BA%E5%9F%9F&park=%E5%91%A8%E5%B1%B1%E5%B7%A5%E4%B8%9A%E5%8C%BA%2FVSIP+1&direction=%E6%9C%BA%E6%A2%B0%E5%92%8C%E7%94%B5%E6%B0%94&accountScopeMode=restricted&accountGroupLabel=%E8%B6%8A%E5%8D%97%E9%94%80%E5%94%AE%E4%B8%80%E7%BB%84',
    );
  });
});
