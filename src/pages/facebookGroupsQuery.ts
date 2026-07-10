export interface FacebookGroupListQuery {
  status: string;
  enabled: string;
  page: number;
  region?: string;
  park?: string;
  direction?: string;
}

export function facebookGroupListPath(input: FacebookGroupListQuery): string {
  const q = new URLSearchParams();
  q.set('limit', '100');
  q.set('offset', String((input.page - 1) * 100));
  if (input.status !== 'all') q.set('status', input.status);
  if (input.enabled !== 'all') q.set('enabled', input.enabled);
  if (input.region) q.set('region', input.region);
  if (input.park) q.set('park', input.park);
  if (input.direction) q.set('direction', input.direction);
  return `/api/facebook/groups?${q.toString()}`;
}
