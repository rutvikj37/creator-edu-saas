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
    const info = await this.transport.sendMail({ from: this.config.get('MAIL_FROM'), to: job.to, subject: job.subject, html: job.html, text: job.text });
    this.logger.log({ tag: job.tag, messageId: info.messageId }, 'email sent');
    return info.messageId;
  }
}
