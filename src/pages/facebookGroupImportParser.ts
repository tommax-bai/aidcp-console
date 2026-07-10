export interface FacebookGroupImportItem {
  url: string;
  name?: string | null;
  region?: string | null;
  park?: string | null;
  direction?: string | null;
}

const URL_RE = /(?:https?:\/\/)?(?:www\.|m\.|mbasic\.)?(?:facebook|fb)\.com\/[^\s\t]+/gi;

function cleanCell(value: string): string {
  return value.replace(/\u00a0/g, ' ').trim();
}

function extractUrls(value: string): string[] {
  return [...value.matchAll(URL_RE)].map((m) => m[0].replace(/[),，。；;]+$/g, ''));
}

function isRegionLabel(value: string): boolean {
  return /^.+区域$/.test(value);
}

function isSequenceLabel(value: string): boolean {
  return value === '序号';
}

function isHeaderLabel(value: string): boolean {
  return !!value && !isSequenceLabel(value) && !isRegionLabel(value) && extractUrls(value).length === 0;
}

function isParkLabel(value: string): boolean {
  return /工业区|园区|VSIP/i.test(value);
}

function rowsFrom(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split('\t').map(cleanCell))
    .filter((row) => row.some(Boolean));
}

function regionByColumn(rows: string[][], maxCols: number): Array<string | null> {
  const regionRow = rows.find((row) => row.some((cell) => isRegionLabel(cell)));
  const regions: Array<string | null> = Array.from({ length: maxCols }, () => null);
  if (!regionRow) return regions;

  let active: string | null = null;
  for (let col = 0; col < maxCols; col++) {
    const cell = cleanCell(regionRow[col] ?? '');
    if (isRegionLabel(cell)) active = cell;
    regions[col] = active;
  }
  return regions;
}

function headerLabelFor(headers: string[][], col: number): string | null {
  for (let i = headers.length - 1; i >= 0; i--) {
    const same = cleanCell(headers[i]?.[col] ?? '');
    if (isHeaderLabel(same)) return same;
    const left = cleanCell(headers[i]?.[col - 1] ?? '');
    if (isHeaderLabel(left)) return left;
  }
  return null;
}

function parseGrid(text: string): FacebookGroupImportItem[] {
  const rows = rowsFrom(text);
  if (rows.length === 0) return [];
  const maxCols = Math.max(...rows.map((row) => row.length));
  const firstUrlRow = rows.findIndex((row) => row.some((cell) => extractUrls(cell).length > 0));
  if (firstUrlRow < 0) return [];
  const headers = rows.slice(0, firstUrlRow);
  const regions = regionByColumn(headers, maxCols);
  const items: FacebookGroupImportItem[] = [];

  for (const row of rows.slice(firstUrlRow)) {
    for (let col = 0; col < maxCols; col++) {
      for (const url of extractUrls(row[col] ?? '')) {
        const label = headerLabelFor(headers, col);
        const item: FacebookGroupImportItem = { url };
        if (label) {
          if (isParkLabel(label)) {
            item.region = regions[col] ?? null;
            item.park = label;
          } else {
            item.direction = label;
          }
        }
        items.push(item);
      }
    }
  }

  return items;
}

function parseUrlOnly(text: string): FacebookGroupImportItem[] {
  return extractUrls(text).map((url) => ({ url }));
}

export function parseFacebookGroupImportText(text: string): FacebookGroupImportItem[] {
  const raw = text.trim();
  if (!raw) return [];
  if (raw.includes('\t')) {
    const gridItems = parseGrid(raw);
    if (gridItems.length > 0) return gridItems;
  }
  return parseUrlOnly(raw);
}
