import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Modal, Select, toast } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { formatDate } from '../../utils/format.js';

const BILLING_MONTH_OPTIONS = [
  { value: '12', label: '12 Months (1 Year)' },
  { value: '6', label: '6 Months' },
  { value: '3', label: '3 Months' },
  { value: '1', label: '1 Month' },
];

const TRIAL_PRESET_DAYS = [7, 14, 30, 60, 90];

function calculatePlanPrice(plan, months) {
  if (!plan) return '24999';
  const inrPrices = plan.prices?.filter((p) => p.currency === 'INR') ?? [];
  const yearPrice = inrPrices.find((p) => p.interval === 'YEAR' || p.interval === 'YEARLY');
  const monthPrice = inrPrices.find((p) => p.interval === 'MONTH' || p.interval === 'MONTHLY');
  const m = Number(months) || 12;

  if (m === 12 && yearPrice) return String(Number(yearPrice.amount));
  if (m === 1 && monthPrice) return String(Number(monthPrice.amount));
  if (monthPrice) return String(Number(monthPrice.amount) * m);
  if (yearPrice) return String(Math.round((Number(yearPrice.amount) / 12) * m));
  return '24999';
}

function findMatchingPriceId(plan, months) {
  if (!plan) return undefined;
  const inrPrices = plan.prices?.filter((p) => p.currency === 'INR') ?? [];
  const m = Number(months) || 12;
  if (m === 12) {
    const yearPrice = inrPrices.find((p) => p.interval === 'YEAR' || p.interval === 'YEARLY');
    return yearPrice?.id;
  }
  if (m === 1) {
    const monthPrice = inrPrices.find((p) => p.interval === 'MONTH' || p.interval === 'MONTHLY');
    return monthPrice?.id;
  }
  return undefined;
}

export function CreateAgencyModal({ open, onClose, onSuccess }) {
  const plans = useQuery({ queryKey: ['platform', 'plans'], queryFn: platformApi.plans, enabled: open });

  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phonePrefix, setPhonePrefix] = useState('+91');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const [portalType, setPortalType] = useState('subdomain'); // 'subdomain' | 'custom'
  const [subdomain, setSubdomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [subdomainTouched, setSubdomainTouched] = useState(false);

  const [paymentType, setPaymentType] = useState('PAID'); // 'PAID' | 'TRIAL' | 'LATER'
  const [planId, setPlanId] = useState('');
  const [billingMonths, setBillingMonths] = useState('12');
  const [amount, setAmount] = useState('24999');
  const [trialDays, setTrialDays] = useState(14);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Paid plans filter out trial-only plans
  const paidPlans = useMemo(() => {
    const list = (plans.data ?? []).filter((p) => p.code !== 'trial' && (p.prices?.length > 0 || p.trialDays === 0));
    return list.length > 0 ? list : (plans.data ?? []);
  }, [plans.data]);

  const allPlans = useMemo(() => plans.data ?? [], [plans.data]);

  // When plans load or paymentType changes, initialize appropriate planId & amount
  useEffect(() => {
    if (!open || allPlans.length === 0) return;

    if (paymentType === 'PAID') {
      const currentIsPaid = paidPlans.some((p) => p.id === planId);
      if (!currentIsPaid) {
        const growth = paidPlans.find((p) => p.code === 'growth') ?? paidPlans[0];
        if (growth) {
          setPlanId(growth.id);
          setAmount(calculatePlanPrice(growth, billingMonths));
        }
      }
    } else if (paymentType === 'TRIAL') {
      const trialPlan = allPlans.find((p) => p.code === 'trial') ?? allPlans[0];
      if (trialPlan && (!planId || !allPlans.some((p) => p.id === planId))) {
        setPlanId(trialPlan.id);
        if (trialPlan.trialDays > 0) setTrialDays(trialPlan.trialDays);
      }
    } else if (paymentType === 'LATER') {
      if (!planId) {
        const defaultPlan = allPlans.find((p) => p.isDefault) ?? allPlans[0];
        if (defaultPlan) setPlanId(defaultPlan.id);
      }
    }
  }, [open, allPlans, paidPlans, paymentType, planId, billingMonths]);

  // Handle plan change in Paid mode
  const handlePaidPlanChange = (newPlanId) => {
    setPlanId(newPlanId);
    const selectedPlan = paidPlans.find((p) => p.id === newPlanId);
    setAmount(calculatePlanPrice(selectedPlan, billingMonths));
  };

  // Handle billing months change in Paid mode
  const handleBillingMonthsChange = (newMonths) => {
    setBillingMonths(newMonths);
    const selectedPlan = paidPlans.find((p) => p.id === planId);
    setAmount(calculatePlanPrice(selectedPlan, newMonths));
  };

  // Calculate dynamic expiry dates
  const paidExpiryDate = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + (Number(billingMonths) || 12));
    return formatDate(d);
  }, [billingMonths]);

  const trialExpiryDate = useMemo(() => {
    const days = Number(trialDays) || 14;
    const d = new Date(Date.now() + days * 86_400_000);
    return formatDate(d);
  }, [trialDays]);

  // Auto-slugify agency name into subdomain if not manually touched
  const handleNameChange = (val) => {
    setName(val);
    if (!subdomainTouched) {
      const slug = val
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      setSubdomain(slug);
    }
  };

  const reset = () => {
    setName('');
    setOwnerName('');
    setPhone('');
    setEmail('');
    setPortalType('subdomain');
    setSubdomain('');
    setCustomDomain('');
    setSubdomainTouched(false);
    setPaymentType('PAID');
    setBillingMonths('12');
    setTrialDays(14);
    setAmount('24999');
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError('Agency name is required');
    if (!ownerName.trim()) return setError('Owner name is required');
    if (!email.trim()) return setError('Owner email is required');

    setSubmitting(true);
    try {
      const fullPhone = phone.trim() ? `${phonePrefix}${phone.trim()}` : undefined;
      const selectedPlan = (paymentType === 'PAID' ? paidPlans : allPlans).find((p) => p.id === planId);
      const planPriceId = paymentType === 'PAID' ? findMatchingPriceId(selectedPlan, billingMonths) : undefined;

      const res = await platformApi.createTenant({
        name: name.trim(),
        ownerName: ownerName.trim(),
        email: email.trim().toLowerCase(),
        phone: fullPhone,
        country: 'IN',
        subdomain: portalType === 'subdomain' ? subdomain.trim() : undefined,
        customDomain: portalType === 'custom' ? customDomain.trim() : undefined,
        paymentType,
        planId: planId || undefined,
        planPriceId,
        amount: paymentType === 'PAID' ? Number(amount) : undefined,
        billingMonths: paymentType === 'PAID' ? Number(billingMonths) : undefined,
        trialDays: paymentType === 'TRIAL' ? Number(trialDays) || 14 : undefined,
      });

      toast.success(
        res.owner.tempPassword
          ? `Agency created! Temporary password: ${res.owner.tempPassword}`
          : 'Agency created successfully!',
      );
      reset();
      onSuccess?.(res);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create agency');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      size="lg"
      title="Create agency"
      description="Provision a new academy portal, configure ownership, student domains, and subscription access."
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Row 1: Agency Name & Owner Name */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Agency / brand name *"
            placeholder="e.g. Acme Academy"
            required
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
          />
          <Input
            label="Owner name *"
            placeholder="e.g. John Doe"
            required
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
          />
        </div>

        {/* Row 2: Owner Phone & Owner Email */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-fg">Owner phone</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={phonePrefix}
                onChange={(e) => setPhonePrefix(e.target.value)}
                className="w-16 rounded-md border border-line bg-surface px-2.5 py-1.5 text-center text-sm font-medium text-fg"
              />
              <input
                type="tel"
                placeholder="9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-muted focus:border-primary-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <Input
              label="Owner email *"
              type="email"
              placeholder="owner@agency.com"
              required
              hint="Login details are emailed here"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        {/* Section: Student portal */}
        <div className="space-y-3 rounded-lg border border-line bg-surface-2/30 p-4">
          <p className="text-sm font-semibold text-fg">Student portal</p>
          <div className="flex gap-6 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="portalType"
                checked={portalType === 'subdomain'}
                onChange={() => setPortalType('subdomain')}
                className="text-primary-600 focus:ring-primary-500"
              />
              <span>Our subdomain</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="portalType"
                checked={portalType === 'custom'}
                onChange={() => setPortalType('custom')}
                className="text-primary-600 focus:ring-primary-500"
              />
              <span>Their own domain</span>
            </label>
          </div>

          {portalType === 'subdomain' ? (
            <div>
              <Input
                label="Subdomain *"
                placeholder="e.g. globalvisa"
                value={subdomain}
                onChange={(e) => {
                  setSubdomainTouched(true);
                  setSubdomain(e.target.value);
                }}
                hint="We host: yourname.lvh.me"
              />
            </div>
          ) : (
            <div>
              <Input
                label="Custom domain *"
                placeholder="e.g. learn.myacademy.com"
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                hint="Point CNAME or A record after creating"
              />
            </div>
          )}
        </div>

        {/* Section: Plan & payment */}
        <div className="space-y-3 rounded-lg border border-line bg-surface-2/30 p-4">
          <p className="text-sm font-semibold text-fg">Plan & payment</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="paymentType"
                checked={paymentType === 'PAID'}
                onChange={() => setPaymentType('PAID')}
                className="text-primary-600 focus:ring-primary-500"
              />
              <span className="font-medium text-fg">Paid — activate now</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="paymentType"
                checked={paymentType === 'TRIAL'}
                onChange={() => setPaymentType('TRIAL')}
                className="text-primary-600 focus:ring-primary-500"
              />
              <span className="font-medium text-fg">Free trial</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="paymentType"
                checked={paymentType === 'LATER'}
                onChange={() => setPaymentType('LATER')}
                className="text-primary-600 focus:ring-primary-500"
              />
              <span className="font-medium text-fg">Create only (activate later)</span>
            </label>
          </div>

          {/* Paid activate now */}
          {paymentType === 'PAID' && (
            <div className="space-y-3 pt-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Plan *"
                  value={planId}
                  onChange={(e) => handlePaidPlanChange(e.target.value)}
                  options={paidPlans.map((p) => ({ value: p.id, label: p.name }))}
                />
                <Select
                  label="Billing duration *"
                  value={billingMonths}
                  onChange={(e) => handleBillingMonthsChange(e.target.value)}
                  options={BILLING_MONTH_OPTIONS}
                />
              </div>

              <div>
                <Input
                  label="Amount received (₹)"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  hint={`${billingMonths} months access · Valid until ${paidExpiryDate}`}
                />
              </div>
            </div>
          )}

          {/* Free trial */}
          {paymentType === 'TRIAL' && (
            <div className="space-y-3 pt-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Plan tier *"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  options={allPlans.map((p) => ({ value: p.id, label: p.name }))}
                />
                <Input
                  label="Trial days *"
                  type="number"
                  min="1"
                  max="365"
                  value={trialDays}
                  onChange={(e) => setTrialDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  hint={`Trial active until ${trialExpiryDate} (${trialDays} days free access)`}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">Quick select days:</label>
                <div className="flex flex-wrap gap-2">
                  {TRIAL_PRESET_DAYS.map((days) => {
                    const active = Number(trialDays) === days;
                    return (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setTrialDays(days)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          active
                            ? 'bg-primary-600 text-white shadow-sm'
                            : 'bg-surface border border-line text-fg hover:bg-surface-2'
                        }`}
                      >
                        {days} days
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Create only activate later */}
          {paymentType === 'LATER' && (
            <div className="space-y-3 pt-2">
              <Select
                label="Target plan *"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                options={allPlans.map((p) => ({ value: p.id, label: p.name }))}
              />
              <div className="rounded-md border border-line bg-surface p-3 text-xs text-muted">
                Agency will be created in <strong className="text-fg">Onboarding</strong> status. No subscription will be charged or activated until you manually activate it from the panel.
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {paymentType === 'PAID'
              ? 'Create & activate'
              : paymentType === 'TRIAL'
              ? 'Create with trial'
              : 'Create agency'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
