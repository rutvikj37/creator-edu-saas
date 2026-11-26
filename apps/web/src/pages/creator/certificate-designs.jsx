import { CERTIFICATE_DESIGNS, CERTIFICATE_DESIGN_KEYS, resolveCertificateDesign } from '@ce/shared';

export { CERTIFICATE_DESIGNS, CERTIFICATE_DESIGN_KEYS, resolveCertificateDesign };

/** Live preview of the certificate frame for the creator template editor. */
export function CertificatePreview({ form, academyName = 'Your academy', recipientName = 'Student Name', courseTitle = 'Course title' }) {
  const key = resolveCertificateDesign(form?.designKey).key;
  const accent = form?.accentColor || '#4f46e5';
  const title = form?.title || 'Certificate of Completion';
  const body = form?.bodyText || 'has successfully completed';
  const common = (
    <>
      <p className="text-xs">{body}</p>
      <p className="text-sm font-semibold text-fg">{courseTitle}</p>
      {form?.signatoryName ? (
        <div className="mt-3 border-t border-line pt-2 text-right">
          <p className="text-xs font-semibold text-fg">{form.signatoryName}</p>
          {form.signatoryRole ? <p className="text-[10px] text-muted">{form.signatoryRole}</p> : null}
        </div>
      ) : null}
    </>
  );

  if (key === 'modern') {
    return (
      <div className="relative overflow-hidden rounded-lg border border-line bg-white p-4 pl-6 text-left shadow-sm dark:bg-surface" style={{ borderLeftWidth: 6, borderLeftColor: accent }}>
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: accent }}>{academyName}</p>
        <p className="mt-1 font-serif text-lg font-bold text-fg">{title}</p>
        <div className="mt-1 h-0.5 w-10" style={{ backgroundColor: accent }} />
        <p className="mt-3 text-xs text-muted">This is to certify that</p>
        <p className="font-serif text-base font-bold" style={{ color: accent }}>{recipientName}</p>
        {common}
      </div>
    );
  }

  if (key === 'formal') {
    return (
      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm dark:bg-surface" style={{ borderColor: accent }}>
        <div className="px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-white" style={{ backgroundColor: accent }}>{academyName}</div>
        <div className="space-y-1 p-4 text-center">
          <div className="mx-auto flex size-8 items-center justify-center rounded-full border-2 text-[10px] font-bold" style={{ borderColor: accent, color: accent }}>★</div>
          <p className="font-serif text-lg font-bold text-fg">{title}</p>
          <p className="text-xs text-muted">This is to certify that</p>
          <p className="font-serif text-base font-bold" style={{ color: accent }}>{recipientName}</p>
          {common}
        </div>
      </div>
    );
  }

  if (key === 'elegant') {
    return (
      <div className="relative rounded-lg border bg-white p-5 text-center shadow-sm dark:bg-surface" style={{ borderColor: accent }}>
        <span className="pointer-events-none absolute left-2 top-2 size-4 border-l-2 border-t-2" style={{ borderColor: accent }} aria-hidden />
        <span className="pointer-events-none absolute right-2 top-2 size-4 border-r-2 border-t-2" style={{ borderColor: accent }} aria-hidden />
        <span className="pointer-events-none absolute bottom-2 left-2 size-4 border-b-2 border-l-2" style={{ borderColor: accent }} aria-hidden />
        <span className="pointer-events-none absolute bottom-2 right-2 size-4 border-b-2 border-r-2" style={{ borderColor: accent }} aria-hidden />
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted">{academyName}</p>
        <div className="mx-auto my-1 h-px w-16" style={{ backgroundColor: accent }} />
        <p className="font-serif text-lg font-bold" style={{ color: accent }}>{title}</p>
        <p className="mt-1 text-xs text-muted">This is to certify that</p>
        <p className="font-serif text-base font-bold text-fg">{recipientName}</p>
        {common}
      </div>
    );
  }

  if (key === 'scholar') {
    return (
      <div className="rounded-lg border border-line bg-white px-4 py-5 text-center shadow-sm dark:bg-surface">
        <div className="mx-auto mb-2 h-0.5 w-2/3" style={{ backgroundColor: accent }} />
        <div className="mx-auto mb-3 h-px w-2/3" style={{ backgroundColor: accent }} />
        <p className="text-[10px] uppercase tracking-wider text-muted">{academyName}</p>
        <p className="mt-1 font-serif text-lg font-bold text-fg">{title}</p>
        <div className="mx-auto my-2 h-px w-1/2" style={{ backgroundColor: accent }} />
        <p className="text-xs text-muted">This is to certify that</p>
        <p className="font-serif text-base font-bold" style={{ color: accent }}>{recipientName}</p>
        {common}
        <div className="mx-auto mt-3 h-px w-2/3" style={{ backgroundColor: accent }} />
        <div className="mx-auto mt-1 h-0.5 w-2/3" style={{ backgroundColor: accent }} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border-2 p-4 text-center" style={{ borderColor: accent }}>
      <div className="rounded border p-3" style={{ borderColor: accent }}>
        <p className="text-xs uppercase" style={{ color: accent }}>{academyName}</p>
        <p className="mt-1 font-serif text-lg font-bold text-fg">{title}</p>
        <p className="text-xs text-muted">This is to certify that</p>
        <p className="font-serif text-base font-bold" style={{ color: accent }}>{recipientName}</p>
        {common}
      </div>
    </div>
  );
}

/** Compact thumbnail used in the design chooser grid. */
export function DesignThumb({ designKey, accent, selected, onSelect, name, description }) {
  const sample = { designKey, accentColor: accent, title: 'Certificate', bodyText: 'has completed', showQr: false };
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`group flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors ${selected ? 'border-primary-600 bg-primary-50/40 dark:bg-primary-950/40' : 'border-line hover:border-line-strong'}`}
    >
      <div className="pointer-events-none origin-top scale-[0.92] p-2 opacity-90 group-hover:opacity-100">
        <CertificatePreview form={sample} academyName="Academy" recipientName="Alex" courseTitle="Course" />
      </div>
      <div className="border-t border-line px-3 py-2">
        <p className="text-sm font-medium text-fg">{name}</p>
        <p className="line-clamp-2 text-xs text-muted">{description}</p>
      </div>
    </button>
  );
}
