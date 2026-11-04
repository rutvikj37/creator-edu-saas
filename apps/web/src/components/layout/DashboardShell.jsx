import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Bell, ChevronsLeft, ChevronsRight, Languages, LogOut, Menu, Moon, Search, Sun, User, X } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { usePersistentState } from '../../hooks/usePersistentState.js';
import { useTheme } from '../../context/ThemeContext.jsx';
import { LANGUAGES } from '../../i18n/index.js';
import { Avatar, Badge, Button, Dropdown, DropdownItem, DropdownSeparator, EmptyState } from '../ui/index.js';
import { CommandPalette } from './CommandPalette.jsx';

function flatten(nav) {
  return nav.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
}

function SidebarNav({ nav, collapsed, onNavigate }) {
  const { t } = useTranslation();
  return (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {nav.map((group) => (
        <div key={group.label ?? 'root'}>
          {group.label && !collapsed && <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-muted uppercase">{group.label}</p>}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const inner = (
                <>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                  {!collapsed && !item.available && (
                    <Badge className="px-1.5 py-0 text-[10px]">{item.phase ? `P${item.phase}` : t('shell.soon')}</Badge>
                  )}
                </>
              );
              const base = cn('flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium transition-colors', collapsed && 'justify-center');
              return (
                <li key={item.to}>
                  {item.available ? (
                    <NavLink
                      to={item.to}
                      end={item.end}
                      title={collapsed ? item.label : undefined}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(base, isActive ? 'bg-primary-50 text-primary-700' : 'text-fg-2 hover:bg-surface-2 hover:text-fg')
                      }
                    >
                      {inner}
                    </NavLink>
                  ) : (
                    // Not yet built: rendered as disabled, never as a dead link.
                    <span aria-disabled="true" title={`${item.label} — available in Phase ${item.phase}`} className={cn(base, 'cursor-not-allowed text-muted opacity-70')}>
                      {inner}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Shared dashboard layout for every panel: collapsible (remembered) sidebar, mobile
 * drawer, top bar with ⌘K search, notifications, theme, language and profile menu.
 */
export function DashboardShell({ nav, brand, user, footer, onSignOut, notifications = [], banner }) {
  const { t, i18n } = useTranslation();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const [collapsed, setCollapsed] = usePersistentState(`sidebar.${brand.key}.collapsed`, false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const items = useMemo(() => flatten(nav), [nav]);

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const brandBlock = (
    <div className={cn('flex h-14 items-center gap-2.5 border-b border-line px-4', collapsed && 'justify-center px-0')}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-600 text-sm font-bold text-on-primary">{brand.mark}</span>
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{brand.name}</p>
          {brand.subtitle && <p className="truncate text-xs text-muted">{brand.subtitle}</p>}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className={cn('sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] lg:flex', collapsed ? 'w-16' : 'w-64')}>
        {brandBlock}
        <SidebarNav nav={nav} collapsed={collapsed} />
        {footer && !collapsed && <div className="border-t border-line p-3">{footer}</div>}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? t('shell.expand') : t('shell.collapse')}
          className="flex h-10 items-center justify-center gap-2 border-t border-line text-xs text-muted hover:text-fg"
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          {!collapsed && t('shell.collapse')}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-lg">
            <div className="flex items-center justify-between pr-2">
              <div className="flex-1">{brandBlock}</div>
              <Button variant="ghost" size="icon-sm" aria-label="Close menu" onClick={() => setMobileOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
            <SidebarNav nav={nav} collapsed={false} onNavigate={() => setMobileOpen(false)} />
            {footer && <div className="border-t border-line p-3">{footer}</div>}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label={t('shell.openMenu')} onClick={() => setMobileOpen(true)}>
            <Menu className="size-5" />
          </Button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full max-w-sm items-center gap-2 rounded-md border border-line bg-surface-2/60 px-3 text-sm text-muted hover:border-line-strong"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1 text-left">{t('shell.search')}</span>
            <kbd className="hidden rounded border border-line bg-surface px-1.5 text-[10px] font-medium sm:inline">⌘K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <Dropdown
              trigger={(p) => (
                <Button variant="ghost" size="icon-sm" aria-label={t('shell.language')} {...p}>
                  <Languages className="size-4" />
                </Button>
              )}
            >
              {LANGUAGES.map((l) => (
                <DropdownItem key={l.code} onClick={() => i18n.changeLanguage(l.code)} aria-checked={i18n.language === l.code}>
                  <span className={cn('flex-1', i18n.language === l.code && 'font-semibold text-fg')}>{l.label}</span>
                </DropdownItem>
              ))}
            </Dropdown>
            <Button variant="ghost" size="icon-sm" aria-label={t('shell.theme')} onClick={toggle}>
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Dropdown
              panelClassName="w-80 p-0"
              trigger={(p) => (
                <Button variant="ghost" size="icon-sm" aria-label={t('shell.notifications')} className="relative" {...p}>
                  <Bell className="size-4" />
                  {notifications.some((n) => !n.readAt) && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500" />}
                </Button>
              )}
            >
              <div className="border-b border-line px-4 py-3 text-sm font-semibold">{t('shell.notifications')}</div>
              {notifications.length === 0 ? (
                <EmptyState icon={Bell} title={t('shell.noNotifications')} description={t('shell.noNotificationsHint')} className="py-8" />
              ) : (
                <ul className="max-h-80 divide-y divide-line overflow-y-auto">
                  {notifications.map((n) => (
                    <li key={n.id} className="px-4 py-3 text-sm">
                      <p className="font-medium">{n.title}</p>
                      <p className="text-muted">{n.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Dropdown>
            {user && (
              <Dropdown
                trigger={(p) => (
                  <button type="button" className="ml-1 flex items-center gap-2 rounded-full p-0.5 hover:bg-surface-2" aria-label="Account menu" {...p}>
                    <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                  </button>
                )}
              >
                <div className="px-2.5 py-2">
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="text-xs text-muted">{user.email}</p>
                </div>
                <DropdownSeparator />
                {user.profileTo && (
                  <DropdownItem icon={User} as={NavLink} to={user.profileTo}>
                    {t('shell.profile')}
                  </DropdownItem>
                )}
                {onSignOut && (
                  <DropdownItem icon={LogOut} danger onClick={onSignOut}>
                    {t('shell.signOut')}
                  </DropdownItem>
                )}
              </Dropdown>
            )}
          </div>
        </header>
        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {banner}
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={items} />
    </div>
  );
}
