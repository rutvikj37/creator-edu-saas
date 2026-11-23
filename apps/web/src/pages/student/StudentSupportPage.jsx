import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { MessageSquare, Send } from 'lucide-react';
import { learnChatApi } from '../../services/api/chat.js';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button, Card, CardBody, CardHeader, Input, Textarea, toast } from '../../components/ui/index.js';

export function StudentSupportPage() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Requests go to the academy team through the student chat, so replies arrive in "Chat with us".
  const send = useMutation({
    mutationFn: () => learnChatApi.send(`Support request: ${subject.trim()}\n\n${message.trim()}`),
    onSuccess: () => {
      setSubmitted(true);
      toast.success('Your request was sent to the academy team.');
      setSubject('');
      setMessage('');
    },
    onError: (err) => toast.error(err?.message || 'Could not send your request. Please try again.'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      toast.error('Please enter both a subject and message');
      return;
    }
    send.mutate();
  };

  return (
    <>
      <PageHeader
        title="Student Support"
        description="Have questions about your courses, assignments, or account? Reach out to your academy instructor."
        breadcrumbs={[{ label: 'Support' }]}
      />

      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Contact academy support" description="We typically respond within 24-48 hours." />
          <CardBody>
            {submitted && (
              <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200">
                Request sent. The academy team will reply in{' '}
                <Link to="/learn/chat" className="font-medium underline">
                  Chat with us
                </Link>
                .
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Subject"
                placeholder="e.g. Issue with Lesson 3 video playback"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
              <Textarea
                label="Description"
                rows={5}
                placeholder="Describe what you need help with..."
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="flex justify-end">
                <Button type="submit" leftIcon={Send} loading={send.isPending}>
                  Send request
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Link to="/learn/chat" className="block">
            <Card className="p-4 transition-colors hover:border-primary-300">
              <div className="flex items-center gap-3">
                <MessageSquare className="size-6 text-primary-600" />
                <div>
                  <p className="font-medium text-fg">Chat with us</p>
                  <p className="text-xs text-muted">See replies and continue the conversation with the academy team.</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>
      </div>
    </>
  );
}
