import { Download, FileText, Receipt } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button, Card, CardBody, CardHeader, EmptyState } from '../../components/ui/index.js';

export function FinanceInvoicesPage() {
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Platform tax invoices and subscription billing receipts for all academies."
        breadcrumbs={[{ label: 'Finance', to: '/finance' }, { label: 'Invoices' }]}
        actions={
          <Button variant="secondary" size="sm" leftIcon={Download}>
            Export invoices (CSV)
          </Button>
        }
      />
      <Card>
        <CardBody className="py-12">
          <EmptyState
            icon={FileText}
            title="No invoices generated yet"
            description="Monthly platform subscription fee invoices will be automatically cataloged here."
          />
        </CardBody>
      </Card>
    </>
  );
}

export function FinanceTaxReportsPage() {
  return (
    <>
      <PageHeader
        title="Tax Reports"
        description="GST / VAT transaction reports and quarterly tax liability statements."
        breadcrumbs={[{ label: 'Finance', to: '/finance' }, { label: 'Tax reports' }]}
        actions={
          <Button variant="secondary" size="sm" leftIcon={Download}>
            Download tax summary
          </Button>
        }
      />
      <Card>
        <CardBody className="py-12">
          <EmptyState
            icon={Receipt}
            title="Tax liability reports"
            description="Tax compliance summaries and HSN/SAC breakups will appear here."
          />
        </CardBody>
      </Card>
    </>
  );
}
