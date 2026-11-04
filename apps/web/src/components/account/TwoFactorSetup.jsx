import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Copy } from 'lucide-react';
import { Button, Input, Skeleton, toast } from '../ui/index.js';
import { Alert } from '../auth/Alert.jsx';
import { authApi } from '../../services/api/auth.js';

const schema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

/** Authenticator-app enrolment: QR code + manual key, confirmed with a code. */
export function TwoFactorSetup({ onEnabled }) {
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState(null);
  const [error, setError] = useState(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), defaultValues: { code: '' } });

  useEffect(() => {
    let cancelled = false;
    authApi
      .setup2fa()
      .then(async (s) => {
        if (cancelled) return;
        setSetup(s);
        setQr(await QRCode.toDataURL(s.otpauthUrl, { margin: 1, width: 200 }));
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = handleSubmit(async ({ code }) => {
    setError(null);
    try {
      const result = await authApi.enable2fa(code);
      toast.success('Two-factor authentication is on');
      await onEnabled?.(result);
    } catch (e) {
      setError(e.message);
    }
  });

  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-2">
        <li>Open an authenticator app (Google Authenticator, 1Password, Authy…).</li>
        <li>Scan the QR code, or enter the key manually.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {qr ? <img src={qr} alt="QR code for your authenticator app" className="size-44 rounded-lg border border-line bg-white p-2" /> : <Skeleton className="size-44" />}
        <div className="w-full min-w-0 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted">Setup key</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-surface-2 px-2.5 py-1.5 font-mono text-xs">{setup?.secret ?? '••••••••'}</code>
              <Button variant="secondary" size="icon-sm" aria-label="Copy key" disabled={!setup}
                onClick={() => navigator.clipboard?.writeText(setup.secret).then(() => toast.success('Key copied'))}>
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
          <form onSubmit={onSubmit} noValidate className="space-y-3">
            <Input label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} {...register('code')} error={errors.code?.message} />
            <Button type="submit" loading={isSubmitting} disabled={!setup}>Turn on two-factor</Button>
          </form>
        </div>
      </div>
    </div>
  );
}
