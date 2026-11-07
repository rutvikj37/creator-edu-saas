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

  it('collapsed rail shows one icon per section with a flyout of its pages', async () => {
    localStorage.setItem('ce.sidebar.rail.collapsed', 'true');
    const railNav = [
      { label: null, items: [{ label: 'Overview', to: '/', icon: LayoutDashboard, available: true, end: true }] },
      { label: 'Content', icon: BookOpen, items: [{ label: 'Courses', to: '/courses', icon: BookOpen, available: true }, { label: 'Videos', to: '/videos', icon: BookOpen, available: true }] },
    ];
    renderWithApp([{ path: '/', element: <DashboardShell nav={railNav} brand={{ key: 'rail', mark: 'R', name: 'Rail' }} />, children: [{ index: true, element: <p>Home</p> }] }]);
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Content' })).toBeNull();
    const section = screen.getByRole('button', { name: 'Content' });
    await userEvent.click(section);
    const menu = screen.getByRole('menu', { name: 'Content' });
    expect(menu.querySelector('a[href="/courses"]')).toHaveTextContent('Courses');
    expect(menu.querySelector('a[href="/videos"]')).toHaveTextContent('Videos');
    expect(section).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Content' })).toBeNull();
  });

  it('uses the panel default when no preference is saved', () => {
    renderWithApp([{ path: '/', element: <DashboardShell nav={nav} defaultCollapsed brand={{ key: 'fresh', mark: 'F', name: 'Fresh' }} />, children: [{ index: true, element: <p>Home</p> }] }]);
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
