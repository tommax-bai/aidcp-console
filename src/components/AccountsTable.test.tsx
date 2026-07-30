import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { PanelAccount } from '../types/api';
import type { FacebookRuleModePersonaState } from '../types/personaPresentation';
import { AccountsTable } from './AccountsTable';

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
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

const realGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((element: Element, pseudo?: string | null): CSSStyleDeclaration => (
  pseudo ? { getPropertyValue: () => '0px' } as unknown as CSSStyleDeclaration : realGetComputedStyle(element)
)) as typeof window.getComputedStyle;

const unboundFacebookAccount: PanelAccount = {
  accountId: 'fb-1',
  label: 'FB',
  nickname: 'Facebook 账号',
  operatorAlias: null,
  displayName: 'Facebook 账号',
  displayNameSource: 'platform_nickname',
  platform: 'facebook',
  groupLabel: null,
  machineLabel: null,
  contactInfo: null,
  operatorStatus: 'active',
  pausedAt: null,
  riskStatus: null,
  riskQuotaLevel: null,
  signalCount: null,
  personaBound: false,
  needsPersonaSetup: true,
};

function renderState(state?: FacebookRuleModePersonaState) {
  render(
    <MemoryRouter>
      <AccountsTable
        accounts={[unboundFacebookAccount]}
        facebookRuleModePersonaStates={state ? new Map([['fb-1', state]]) : undefined}
      />
    </MemoryRouter>,
  );
}

describe('AccountsTable persona presentation', () => {
  it('shows the full rule-mode/no-persona state before needsPersonaSetup without setup guidance', () => {
    renderState('enabled');

    expect(screen.getByText('按规则运行、未绑人设')).toBeTruthy();
    expect(screen.queryByText('需设置')).toBeNull();
    expect(screen.queryByText('已绑')).toBeNull();
    expect(document.querySelector('a[href="/persona"]')).toBeNull();
  });

  it('keeps setup guidance when environment authority is unavailable and cannot prove the exemption', () => {
    renderState('unknown');

    const setup = screen.getByRole('link', { name: '需设置' });
    expect(setup.getAttribute('href')).toBe('/persona');
    expect(screen.queryByText('按规则运行、未绑人设')).toBeNull();
  });

  it('preserves the existing setup link for an explicitly disabled ordinary unbound account', () => {
    renderState('disabled');

    const setup = screen.getByRole('link', { name: '需设置' });
    expect(setup.getAttribute('href')).toBe('/persona');
    expect(screen.queryByText('按规则运行、未绑人设')).toBeNull();
  });
});
