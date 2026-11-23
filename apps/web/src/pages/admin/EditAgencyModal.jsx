import { useEffect, useState } from 'react';
import { Button, Input, Modal, toast } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';

export function EditAgencyModal({ open, onClose, tenant, onSuccess }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [country, setCountry] = useState('IN');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (tenant) {
      setName(tenant.name || '');
      setSlug(tenant.slug || '');
      setOwnerName(tenant.owner?.fullName || '');
      setOwnerPhone(tenant.owner?.phone || '');
      setCountry(tenant.country || 'IN');
      setTimezone(tenant.timezone || 'Asia/Kolkata');
      setError(null);
    }
  }, [tenant, open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Agency name is required');
    if (!slug.trim()) return setError('Slug is required');

    setSubmitting(true);
    setError(null);
    try {
      const res = await platformApi.updateTenant(tenant.id, {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        ownerName: ownerName.trim() || undefined,
        ownerPhone: ownerPhone.trim() || undefined,
        country: country.trim() || undefined,
        timezone: timezone.trim() || undefined,
      });

      toast.success('Agency updated successfully!');
      onSuccess?.(res);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to update agency');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={`Edit ${tenant?.name || 'Agency'}`}
      description="Update agency information, portal subdomain slug, or owner contact details."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </div>
        )}

        <Input
          label="Agency name *"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme Academy"
        />

        <Input
          label="Subdomain slug *"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="e.g. acme"
          hint={`Portal URL: ${slug || 'yourname'}.lvh.me`}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Owner name"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="e.g. John Doe"
          />
          <Input
            label="Owner phone"
            value={ownerPhone}
            onChange={(e) => setOwnerPhone(e.target.value)}
            placeholder="e.g. +91 9876543210"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Country code"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            maxLength={2}
            placeholder="IN"
          />
          <Input
            label="Timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Asia/Kolkata"
          />
        </div>

        <div className="flex justify-end gap-3 pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
