import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { FacebookGroupImportPanel } from './FacebookGroupImportPanel';
import type { FacebookGroupTargetFacets } from '../types/api';

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

const mocks = vi.hoisted(() => ({
  downloadTemplate: vi.fn(),
}));

vi.mock('./facebookGroupCsvImport', async () => ({
  ...(await vi.importActual<typeof import('./facebookGroupCsvImport')>('./facebookGroupCsvImport')),
  downloadFacebookGroupCsvTemplate: mocks.downloadTemplate,
}));

const facets: FacebookGroupTargetFacets = {
  regions: [
    { region: '河南区域', parks: ['同文1工业区'] },
    { region: '北宁区域', parks: ['周山工业区/VSIP 1'] },
  ],
  directions: ['机械和电气'],
  accountGroupLabels: ['越南销售一组', '越南销售二组'],
  globalTargetCount: 3,
  unscopedTargetCount: 2,
};

function renderPanel(onImport = vi.fn(() => Promise.resolve())) {
  render(
    <AntdApp>
      <FacebookGroupImportPanel facets={facets} onImport={onImport} />
    </AntdApp>,
  );
  return onImport;
}

async function chooseOption(controlName: string, optionLabel: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: controlName }));
  fireEvent.click(await screen.findByText(optionLabel, { selector: '.ant-select-item-option-content' }));
}

function selectFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('CSV file input not found');
  fireEvent.change(input, { target: { files: [file] } });
}

describe('FacebookGroupImportPanel', () => {
  beforeEach(() => {
    mocks.downloadTemplate.mockReset();
  });

  it('defaults to single add and switches modes without submitting', () => {
    const onImport = renderPanel();
    expect(screen.getByRole('textbox', { name: '群组 URL' })).toBeTruthy();

    fireEvent.click(screen.getByText('文件导入'));
    expect(screen.getByText('选择或拖入 CSV 文件')).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('submits one URL with the selected cascading metadata', async () => {
    const onImport = renderPanel();
    fireEvent.change(screen.getByRole('textbox', { name: '群组 URL' }), {
      target: { value: ' https://www.facebook.com/groups/123/?ref=share ' },
    });
    await chooseOption('添加区域', '河南区域');
    await chooseOption('添加园区', '同文1工业区');
    await chooseOption('添加方向', '机械和电气');

    fireEvent.click(screen.getByRole('button', { name: /添加$/ }));

    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith(
        [
          {
            url: 'https://www.facebook.com/groups/123/?ref=share',
            region: '河南区域',
            park: '同文1工业区',
            direction: '机械和电气',
          },
        ],
        'single',
      ),
    );
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '群组 URL' }).value).toBe('');
  });

  it('parses a CSV file and submits its structured rows', async () => {
    const onImport = renderPanel();
    fireEvent.click(screen.getByText('文件导入'));
    const file = new File(['placeholder'], 'groups.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', {
      value: () => Promise.resolve('群组URL,区域,园区,方向,群组名称\nhttps://www.facebook.com/groups/456,北宁区域,周山工业区/VSIP 1,,测试群组'),
    });

    selectFile(file);
    expect(await screen.findByText('可导入 1 行')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /导入文件$/ }));

    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith(
        [
          {
            url: 'https://www.facebook.com/groups/456',
            region: '北宁区域',
            park: '周山工业区/VSIP 1',
            name: '测试群组',
          },
        ],
        'csv',
      ),
    );
  });

  it('rejects a non-CSV file without submitting', async () => {
    const onImport = renderPanel();
    fireEvent.click(screen.getByText('文件导入'));
    selectFile(new File(['x'], 'groups.xlsx'));

    expect(await screen.findByText('仅支持 CSV 文件')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /导入文件$/ }).disabled).toBe(true);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('preserves scope by default and can explicitly replace or clear it', async () => {
    const onImport = renderPanel();
    fireEvent.change(screen.getByRole('textbox', { name: '群组 URL' }), {
      target: { value: 'https://www.facebook.com/groups/789' },
    });
    fireEvent.click(screen.getByRole('switch', { name: '本次设置适用账号分组' }));
    await chooseOption('导入适用账号分组', '越南销售一组');
    fireEvent.click(screen.getByRole('button', { name: /添加$/ }));

    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith(
        [{ url: 'https://www.facebook.com/groups/789' }],
        'single',
        ['越南销售一组'],
        'restricted',
      ),
    );

    fireEvent.change(screen.getByRole('textbox', { name: '群组 URL' }), {
      target: { value: 'https://www.facebook.com/groups/790' },
    });
    fireEvent.click(screen.getByRole('switch', { name: '本次设置适用账号分组' }));
    fireEvent.click(screen.getByRole('button', { name: /添加$/ }));
    await waitFor(() =>
      expect(onImport).toHaveBeenLastCalledWith(
        [{ url: 'https://www.facebook.com/groups/790' }],
        'single',
        [],
        'restricted',
      ),
    );
  });

  it('can import targets as global without any account-group labels', async () => {
    const onImport = renderPanel();
    fireEvent.change(screen.getByRole('textbox', { name: '群组 URL' }), {
      target: { value: 'https://www.facebook.com/groups/global-1' },
    });
    fireEvent.click(screen.getByRole('switch', { name: '本次设置适用账号分组' }));
    fireEvent.click(screen.getByText('全局分组'));
    fireEvent.click(screen.getByRole('button', { name: /添加$/ }));

    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith(
        [{ url: 'https://www.facebook.com/groups/global-1' }],
        'single',
        [],
        'global',
      ),
    );
  });

  it('downloads the CSV template from file mode', () => {
    renderPanel();
    fireEvent.click(screen.getByText('文件导入'));
    fireEvent.click(screen.getByRole('button', { name: /下载 CSV 模板$/ }));
    expect(mocks.downloadTemplate).toHaveBeenCalledOnce();
  });
});
