/**
 * 写结果诚实文案（design §5）：written / already decided / refused / recorded N edges。
 * **绝不**出现 published / done。配合 App.useApp() 的 message 使用（见各写按钮）。
 */
export type WriteOutcome =
  | { kind: 'written' }
  | { kind: 'alreadyDecided'; value: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'recorded'; edgesOnline: number };

export function writeResultText(o: WriteOutcome): {
  type: 'success' | 'info' | 'warning';
  text: string;
} {
  switch (o.kind) {
    case 'written':
      return { type: 'success', text: 'written' };
    case 'alreadyDecided':
      return { type: 'info', text: `already decided: ${o.value}` };
    case 'refused':
      return { type: 'warning', text: `refused: ${o.reason}` };
    case 'recorded':
      return { type: 'info', text: `recorded, ${o.edgesOnline} edges online` };
  }
}
