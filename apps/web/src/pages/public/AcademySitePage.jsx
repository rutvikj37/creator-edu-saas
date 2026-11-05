import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { academyApi } from '../../services/api/auth.js';
import { websiteApi } from '../../services/api/website.js';
import { ErrorState, Skeleton } from '../../components/ui/index.js';
import { SiteBlocks } from '../../components/site/blocks.jsx';
import { AcademyHeader, AcademyLandingPage } from './AcademyLandingPage.jsx';

function useSeo(seo, fallbackTitle) {
  useEffect(() => {
    const prev = document.title;
    document.title = seo?.title || fallbackTitle || prev;
    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'description'); document.head.appendChild(meta); }
    const prevDesc = meta.getAttribute('content');
    if (seo?.description) meta.setAttribute('content', seo.description);
    return () => { document.title = prev; if (created) meta.remove(); else if (prevDesc !== null) meta.setAttribute('content', prevDesc); };
  }, [seo?.title, seo?.description, fallbackTitle]);
}

function SiteFooter({ site, footer }) {
  return (
    <footer className="mt-10 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted">
        <p>{footer?.text || `© ${new Date().getFullYear()} ${site?.name ?? ''}`}</p>
        <nav className="flex flex-wrap gap-4">{(footer?.links ?? []).map((l) => (l.href.startsWith('/') ? <Link key={l.href + l.label} to={l.href} className="hover:text-fg">{l.label}</Link> : <a key={l.href + l.label} href={l.href} rel="noreferrer noopener" className="hover:text-fg">{l.label}</a>))}</nav>
      </div>
    </footer>
  );
}

/**
 * Academy website on the academy host. Home ("/"):
 *  - own external website → redirect there (courses, checkout and learning stay here);
 *  - published home page (AI landing page / builder) → rendered from blocks;
 *  - otherwise → the default catalogue landing page.
 * `?preview=<token>` shows drafts to the creator.
 */
export function AcademySitePage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const preview = params.get('preview') || undefined;
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000, retry: false });
  const layout = useQuery({ queryKey: ['site-layout', preview], queryFn: () => websiteApi.layout(preview), staleTime: 60_000, retry: false });
  const external = !slug && !preview && layout.data?.mode === 'EXTERNAL' && layout.data.externalUrl;
  const wantsPage = Boolean(slug) || Boolean(layout.data?.hasHomePage);
  const page = useQuery({ queryKey: ['site-page', slug ?? 'home', preview], queryFn: () => websiteApi.publicPage(slug, preview), enabled: Boolean(layout.data) && !external && wantsPage, retry: false });
  useSeo(page.data?.seo, page.data?.title ? `${page.data.title} · ${site.data?.name ?? ''}` : site.data?.name);
  useEffect(() => {
    if (external) window.location.replace(layout.data.externalUrl);
  }, [external, layout.data]);

  if (external) return <div className="grid min-h-dvh place-items-center p-6 text-center text-sm text-muted">Taking you to <a className="ml-1 underline" href={layout.data.externalUrl}>{new URL(layout.data.externalUrl).hostname}</a>…</div>;
  if (layout.isError && !slug) return <AcademyLandingPage />;
  if (!layout.data || (wantsPage && page.isLoading)) return <div className="min-h-dvh"><Skeleton className="h-16 w-full" /><Skeleton className="mx-auto mt-10 h-64 max-w-5xl" /></div>;
  if (!wantsPage) return <AcademyLandingPage />;
  if (page.isError) return slug ? <div className="grid min-h-dvh place-items-center"><ErrorState title="Page not found" error={{ message: 'This page does not exist or is not published.' }} /></div> : <AcademyLandingPage />;
  const s = site.data;
  return (
    <div className="min-h-dvh bg-surface" style={{ fontFamily: s?.theme?.fontBody }}>
      {page.data.preview && <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">Preview of unpublished changes — visitors still see the published page.</div>}
      <AcademyHeader site={s} nav={layout.data.nav} />
      <main><SiteBlocks blocks={page.data.blocks} data={page.data.data} theme={s?.theme} template={layout.data.template} /></main>
      <SiteFooter site={s} footer={layout.data.footer} />
    </div>
  );
}
