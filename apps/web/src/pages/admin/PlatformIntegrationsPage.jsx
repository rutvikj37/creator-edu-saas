import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, HardDrive, Mail, MessageCircle, Phone, Plug, Settings, ShieldCheck, Video } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Badge, Button, Card, CardBody, CardHeader, Input, Modal, toast } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';

const INTEGRATIONS_CATALOG = [
  {
    id: 'razorpay',
    name: 'Razorpay Payment Gateway',
    category: 'Payments',
    icon: CreditCard,
    description: 'Accept credit/debit cards, UPI, netbanking, and recurring agency subscriptions in INR.',
    keys: ['payments.razorpayKeyId', 'payments.razorpayKeySecret', 'payments.razorpayWebhookSecret'],
  },
  {
    id: 'email_smtp',
    name: 'Transactional Mail (SMTP / Mailpit)',
    category: 'Email',
    icon: Mail,
    description: 'Deliver password resets, agency credentials, and notifications through Mailpit or custom SMTP.',
    keys: ['email.fromName', 'email.fromAddress', 'email.replyTo'],
  },
  {
    id: 'whatsapp_api',
    name: 'WhatsApp Business Cloud API',
    category: 'Messaging',
    icon: MessageCircle,
    description: 'Send automated enrollment receipts, live class reminders, and batch updates via WhatsApp.',
    keys: ['whatsapp.businessNumber'],
  },
  {
    id: 'sms_gateway',
    name: 'SMS Alerts (Fast2SMS / Twilio)',
    category: 'Messaging',
    icon: Phone,
    description: 'Send OTP verification codes and urgent system alerts via high-throughput SMS routes.',
    keys: ['sms.senderId'],
  },
  {
    id: 'video_streaming',
    name: 'Video CDN & Transcoding',
    category: 'Media',
    icon: Video,
    description: 'Secure HLS streaming with tokenized playback, AES-128 encryption, and multi-resolution encoding.',
    keys: ['video.rateCurrency', 'video.storageRatePerGbMonth', 'video.deliveryRatePerGb'],
  },
  {
    id: 'backups_cloud',
    name: 'Cloud Storage & Disaster Recovery',
    category: 'Storage',
    icon: HardDrive,
    description: 'Automatic encrypted off-site database and media backups with automated retention cleanup.',
    keys: ['backups.driveLowSpacePercent'],
  },
];

export function PlatformIntegrationsPage() {
  const qc = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['platform', 'settings'],
    queryFn: platformApi.settings,
  });

  const [activeConfig, setActiveConfig] = useState(null);
  const [formValues, setFormValues] = useState({});

  const settingsMap = useMemo(() => {
    const settingsList = settingsQuery.data || [];
    const map = {};
    if (Array.isArray(settingsList)) {
      settingsList.forEach((group) => {
        group.items?.forEach((item) => {
          map[item.key] = item.value;
        });
      });
    } else if (typeof settingsList === 'object') {
      return settingsList;
    }
    return map;
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (items) => platformApi.updateSettings(items),
    onSuccess: () => {
      toast.success('Integration settings updated successfully!');
      qc.invalidateQueries({ queryKey: ['platform', 'settings'] });
      setActiveConfig(null);
    },
    onError: (err) => toast.error(err.message || 'Failed to update settings'),
  });

  const handleOpenConfig = (integration) => {
    setActiveConfig(integration);
    const initial = {};
    integration.keys.forEach((k) => {
      initial[k] = settingsMap[k] ?? '';
    });
    setFormValues(initial);
  };

  const handleSave = (e) => {
    e.preventDefault();
    const items = Object.entries(formValues).map(([key, value]) => ({ key, value }));
    saveMutation.mutate(items);
  };

  const isConfigured = (integration) => {
    const primaryKey = integration.keys[0];
    return Boolean(settingsMap[primaryKey]);
  };

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Configure third-party gateways, email providers, and storage engines across the platform."
        breadcrumbs={[{ label: 'System' }, { label: 'Integrations' }]}
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS_CATALOG.map((item) => {
          const configured = isConfigured(item);
          const Icon = item.icon;
          return (
            <Card key={item.id} className="flex flex-col justify-between p-5">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="grid size-10 place-items-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-400">
                    <Icon className="size-5" />
                  </div>
                  {configured ? (
                    <Badge tone="success" className="gap-1">
                      <CheckCircle2 className="size-3" /> Connected
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Ready to configure</Badge>
                  )}
                </div>

                <div className="mt-4">
                  <h3 className="font-semibold text-fg">{item.name}</h3>
                  <p className="mt-1.5 text-xs text-muted leading-relaxed">{item.description}</p>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
                <span className="text-xs text-muted">{item.category}</span>
                <Button variant="secondary" size="sm" onClick={() => handleOpenConfig(item)}>
                  Configure
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {activeConfig && (
        <Modal
          open={Boolean(activeConfig)}
          onClose={() => setActiveConfig(null)}
          title={`Configure ${activeConfig.name}`}
          description={`Update credentials and settings for this integration service.`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setActiveConfig(null)}>
                Cancel
              </Button>
              <Button loading={saveMutation.isPending} onClick={handleSave}>
                Save configuration
              </Button>
            </>
          }
        >
          <form onSubmit={handleSave} className="space-y-4">
            {activeConfig.keys.map((k) => {
              const label = k.split('.').pop().replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
              const isSecret = k.toLowerCase().includes('secret') || k.toLowerCase().includes('keysecret');
              return (
                <Input
                  key={k}
                  label={label}
                  type={isSecret ? 'password' : 'text'}
                  value={formValues[k] ?? ''}
                  onChange={(e) => setFormValues((prev) => ({ ...prev, [k]: e.target.value }))}
                  placeholder={`Enter ${label.toLowerCase()}...`}
                />
              );
            })}
          </form>
        </Modal>
      )}
    </>
  );
}
