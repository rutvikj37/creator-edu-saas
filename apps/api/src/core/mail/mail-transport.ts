import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { AppConfig } from '../../config/app-config.service.js';
import type { EmailJob } from './mail.service.js';

@Injectable()
export class MailTransport {
  private readonly logger = new Logger(MailTransport.name);
  private transporter?: Transporter;

  constructor(private readonly config: AppConfig) {}

  private get transport(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: this.config.get('SMTP_HOST'),
      port: this.config.get('SMTP_PORT'),
      secure: this.config.get('SMTP_SECURE') ?? this.config.get('SMTP_PORT') === 465,
      auth: this.config.get('SMTP_USER') ? { user: this.config.get('SMTP_USER'), pass: this.config.get('SMTP_PASS') } : undefined,
    });
    return this.transporter;
  }

  async deliver(job: EmailJob): Promise<string> {
    const base = this.config.get('MAIL_FROM');
    // The academy's sender name replaces the display name; the sending address stays the platform's verified one.
    const address = /<([^>]+)>/.exec(base)?.[1] ?? base;
    const from = job.fromName ? { name: job.fromName.replace(/["<>\r\n]/g, '').slice(0, 80), address } : base;
    const info = await this.transport.sendMail({ from, to: job.to, subject: job.subject, html: job.html, text: job.text, headers: job.headers, ...(job.replyTo ? { replyTo: job.replyTo } : {}) });
    this.logger.log({ tag: job.tag, messageId: info.messageId }, 'email sent');
    return info.messageId;
  }
}
