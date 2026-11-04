import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import { renderWithApp } from '../../test/render.jsx';
import { SystemStatusPage } from './SystemStatusPage.jsx';
import { systemApi } from '../../services/api/system.js';

vi.mock('../../services/api/system.js', () => ({ systemApi: { health: vi.fn(), info: vi.fn() } }));

describe('SystemStatusPage', () => {
  beforeEach(() => {
    systemApi.info.mockResolvedValue({ name: 'Creator Education', rootDomain: 'lvh.me', locales: ['en', 'hi', 'gu'] });
  });

  it('renders per-service status from the health endpoint', async () => {
    systemApi.health.mockResolvedValue({
      status: 'ok',
      details: { database: { status: 'up', latencyMs: 3 }, redis: { status: 'up', latencyMs: 1 }, queue: { status: 'down', message: 'unreachable' } },
    });
    renderWithApp([{ path: '/', element: <SystemStatusPage /> }]);
    expect(await screen.findByText('Operational')).toBeInTheDocument();
    expect(screen.getByText('3 ms')).toBeInTheDocument();
    expect(screen.getByText('unreachable')).toBeInTheDocument();
    expect(await screen.findByText('lvh.me')).toBeInTheDocument();
  });

  it('shows an error state when the API is unreachable', async () => {
    systemApi.health.mockRejectedValue(Object.assign(new Error('Cannot reach the server.'), { status: 0 }));
    renderWithApp([{ path: '/', element: <SystemStatusPage /> }]);
    expect(await screen.findByText('API unreachable', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
