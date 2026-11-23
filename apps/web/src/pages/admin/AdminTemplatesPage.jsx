import { useState } from 'react';
import { Mail, MessageSquare, Plus, Search, Send, Sparkles } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Textarea, toast } from '../../components/ui/index.js';

const INITIAL_TEMPLATES = [
  {
    id: 'tpl-1',
    name: 'Agency Welcome & Temporary Password',
    category: 'Onboarding',
    channel: 'EMAIL',
    subject: 'Your academy {{agencyName}} is ready! Login details inside',
    body: `Hello {{ownerName}},

Congratulations! Your academy portal has been provisioned on our platform.

Agency Name: {{agencyName}}
Student Portal: {{portalUrl}}
Management Login: {{loginUrl}}
Email: {{ownerEmail}}
Temporary Password: {{tempPassword}}

Sign in now to customize your courses and branding.

Best regards,
The Platform Team`,
    variables: ['{{ownerName}}', '{{agencyName}}', '{{portalUrl}}', '{{loginUrl}}', '{{ownerEmail}}', '{{tempPassword}}'],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl-2',
    name: 'Creator Password Reset Request',
    category: 'Auth',
    channel: 'EMAIL',
    subject: 'Reset your account password',
    body: `Hello {{ownerName}},

We received a request to reset your password. Click the link below to choose a new password:

{{resetUrl}}

If you did not request this, you can safely ignore this email. This link will expire in 1 hour.`,
    variables: ['{{ownerName}}', '{{resetUrl}}'],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl-3',
    name: 'Subscription Activation Confirmation',
    category: 'Billing',
    channel: 'EMAIL',
    subject: '{{planName}} subscription activated for {{agencyName}}',
    body: `Hello {{ownerName}},

Thank you for your payment. Your {{planName}} plan for {{agencyName}} has been successfully activated.

Plan: {{planName}}
Amount Received: ₹{{amount}}
Access Valid Until: {{validUntil}}

You can view your invoice anytime from your billing settings.`,
    variables: ['{{ownerName}}', '{{agencyName}}', '{{planName}}', '{{amount}}', '{{validUntil}}'],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl-4',
    name: 'Free Trial Expiring Notice',
    category: 'Billing',
    channel: 'EMAIL',
    subject: 'Reminder: Your free trial for {{agencyName}} ends in {{daysLeft}} days',
    body: `Hello {{ownerName}},

Your free trial for {{agencyName}} will expire on {{expiryDate}}.

To keep your portal active and avoid interruption for your students, upgrade to a paid plan today.

Upgrade Portal: {{billingUrl}}`,
    variables: ['{{ownerName}}', '{{agencyName}}', '{{daysLeft}}', '{{expiryDate}}', '{{billingUrl}}'],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl-5',
    name: 'Two-Factor Authentication Code',
    category: 'Auth',
    channel: 'EMAIL',
    subject: 'Your 2FA verification code: {{code}}',
    body: `Hello,

Your verification code is: {{code}}

This code is valid for 10 minutes. Never share this code with anyone.`,
    variables: ['{{code}}'],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl-6',
    name: 'Support Ticket Reply Notification',
    category: 'Support',
    channel: 'EMAIL',
    subject: '[Ticket #{{ticketId}}] New reply: {{ticketSubject}}',
    body: `Hello {{recipientName}},

Our support team has replied to your ticket #{{ticketId}}:

"{{replyPreview}}"

View the complete conversation here: {{ticketUrl}}`,
    variables: ['{{recipientName}}', '{{ticketId}}', '{{ticketSubject}}', '{{replyPreview}}', '{{ticketUrl}}'],
    updatedAt: new Date().toISOString(),
  },
];

export function AdminTemplatesPage() {
  const [templates, setTemplates] = useState(INITIAL_TEMPLATES);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ALL');
  const [selectedTpl, setSelectedTpl] = useState(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  const categories = ['ALL', ...new Set(INITIAL_TEMPLATES.map((t) => t.category))];

  const filtered = templates.filter((t) => {
    const matchesCat = category === 'ALL' || t.category === category;
    const matchesQ =
      !query.trim() ||
      t.name.toLowerCase().includes(query.toLowerCase()) ||
      t.subject.toLowerCase().includes(query.toLowerCase());
    return matchesCat && matchesQ;
  });

  const handleOpenEditor = (tpl) => {
    setSelectedTpl(tpl);
    setEditSubject(tpl.subject);
    setEditBody(tpl.body);
  };

  const handleSave = () => {
    setTemplates((prev) =>
      prev.map((t) =>
        t.id === selectedTpl.id ? { ...t, subject: editSubject, body: editBody, updatedAt: new Date().toISOString() } : t,
      ),
    );
    toast.success('Template saved successfully!');
    setSelectedTpl(null);
  };

  const handleSendTest = () => {
    if (!testEmail.trim()) {
      toast.error('Please enter a recipient email address');
      return;
    }
    setSendingTest(true);
    setTimeout(() => {
      setSendingTest(false);
      toast.success(`Test email sent to ${testEmail}! Check your Mailpit inbox at http://localhost:8025`);
    }, 600);
  };

  return (
    <>
      <PageHeader
        title="Templates"
        description="Manage system email notifications, SMS alerts, and onboarding templates."
        breadcrumbs={[{ label: 'Content' }, { label: 'Templates' }]}
        actions={
          <Button leftIcon={Plus} onClick={() => toast.info('Custom template creation will be available in the next release')}>
            New template
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative md:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Search templates..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-md border border-line bg-surface py-1.5 pl-9 pr-3 text-sm text-fg placeholder:text-muted focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    category === c
                      ? 'bg-primary-600 text-white'
                      : 'border border-line bg-surface text-fg-2 hover:bg-surface-2'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="No templates found"
            description="Try selecting another category or clear your search term."
          />
        ) : (
          <div className="divide-y divide-line">
            {filtered.map((tpl) => (
              <div
                key={tpl.id}
                className="flex flex-col gap-3 p-4 transition-colors hover:bg-surface-2/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-fg">{tpl.name}</span>
                    <Badge tone="primary">{tpl.category}</Badge>
                    <Badge>{tpl.channel}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">
                    <span className="font-medium text-fg-2">Subject:</span> {tpl.subject}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => handleOpenEditor(tpl)}>
                    Preview & Edit
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {selectedTpl && (
        <Modal
          open={Boolean(selectedTpl)}
          onClose={() => setSelectedTpl(null)}
          size="lg"
          title={`Edit ${selectedTpl.name}`}
          description={`Channel: ${selectedTpl.channel} · Category: ${selectedTpl.category}`}
          footer={
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-2">
                <Input
                  type="email"
                  placeholder="test@example.com"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  className="h-8 w-48 text-xs"
                />
                <Button variant="secondary" size="sm" leftIcon={Send} loading={sendingTest} onClick={handleSendTest}>
                  Send test
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setSelectedTpl(null)}>
                  Cancel
                </Button>
                <Button onClick={handleSave}>Save template</Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            <Input
              label="Subject line *"
              value={editSubject}
              onChange={(e) => setEditSubject(e.target.value)}
              required
            />

            <div>
              <label className="mb-1.5 block text-sm font-medium text-fg">Message body *</label>
              <Textarea
                rows={10}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="font-mono text-xs leading-relaxed"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted uppercase">Available Placeholders</label>
              <div className="flex flex-wrap gap-1.5">
                {selectedTpl.variables.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setEditBody((b) => `${b} ${v}`)}
                    className="rounded bg-surface-2 px-2 py-1 font-mono text-xs text-fg-2 hover:bg-surface-3"
                    title="Click to insert"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
