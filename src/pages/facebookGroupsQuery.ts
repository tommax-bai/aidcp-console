export interface FacebookGroupListQuery {
  status: string;
  enabled: string;
  page: number;
  region?: string;
  park?: string;
  direction?: string;
  accountScopeMode?: string;
  accountGroupLabel?: string;
}

export const GROUP_PAGE_SIZE = 30;

export function facebookGroupListPath(input: FacebookGroupListQuery): string {
  const q = new URLSearchParams();
  q.set('limit', String(GROUP_PAGE_SIZE));
  q.set('offset', String((input.page - 1) * GROUP_PAGE_SIZE));
  if (input.status !== 'all') q.set('status', input.status);
  if (input.enabled !== 'all') q.set('enabled', input.enabled);
  if (input.region) q.set('region', input.region);
  if (input.park) q.set('park', input.park);
  if (input.direction) q.set('direction', input.direction);
  if (input.accountScopeMode) q.set('accountScopeMode', input.accountScopeMode);
  if (input.accountGroupLabel) q.set('accountGroupLabel', input.accountGroupLabel);
  return `/api/facebook/groups?${q.toString()}`;
}
