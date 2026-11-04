import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayoutDashboard, BookOpen } from 'lucide-react';
import { DashboardShell } from './DashboardShell.jsx';
import { renderWithApp } from '../../test/render.jsx';

const nav = [
  {
    label: 'Main',
    items: [
      { label: 'Overview', to: '/', icon: LayoutDashboard, available: true, end: true },
      { label: 'Courses', to: '/courses', icon: BookOpen, available: false, phase: 4 },
    ],
  },
];

function setup() {
  return renderWithApp([
    { path: '/', element: <DashboardShell nav={nav} brand={{ key: 'test', mark: 'T', name: 'Test Panel' }} />, children: [{ index: true, element: <p>Home content</p> }] },
  ]);
}

describe('DashboardShell', () => {
  it('renders available items as links and unbuilt items as disabled (no dead links)', () => {
    setup();
    const sidebar = screen.getAllByRole('navigation', { name: 'Main' })[0];
    expect(sidebar.querySelector('a[href="/"]')).toHaveTextContent('Overview');
    expect(sidebar.querySelector('a[href="/courses"]')).toBeNull();
    expect(screen.getAllByText('Courses')[0].closest('[aria-disabled="true"]')).not.toBeNull();
    expect(screen.getByText('Home content')).toBeInTheDocument();
  });

  it('remembers the collapsed sidebar preference', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(JSON.parse(localStorage.getItem('ce.sidebar.test.collapsed'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('switches interface language', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Language' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'हिन्दी' }));
    expect(await screen.findByText('खोजें…')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ce.lang'))).toBe('hi');
  });
});
