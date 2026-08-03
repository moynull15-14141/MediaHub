import nodemailer, { Transporter } from 'nodemailer';
import { config } from './config';

// Phase B.2 - minimal owner-notification email sender. Lazily constructs a
// single transporter only if SMTP is fully configured; every other module in
// this codebase treats optional integrations (SMTP/Redis/Meta) the same way -
// log once, no-op, never throw - so this mirrors that convention rather than
// introducing a new "startup validation" pattern.
let transporter: Transporter | null = null;
let warnedOnce = false;

const getTransporter = (): Transporter | null => {
  if (!config.smtp.configured) {
    if (!warnedOnce) {
      console.log('SMTP not configured (optional) - account notification emails will be skipped.');
      warnedOnce = true;
    }
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host!,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user!, pass: config.smtp.password! },
    });
  }
  return transporter;
};

export interface SendMailInput {
  to: string | string[];
  subject: string;
  text: string;
}

// Fire-and-forget safe: never throws, matching logAudit's failure semantics -
// a notification failure should never break the caller's actual operation
// (a failover pause, a token-expiry check, etc).
export const sendMail = async ({ to, subject, text }: SendMailInput): Promise<void> => {
  const client = getTransporter();
  if (!client) return;
  try {
    await client.sendMail({ from: config.smtp.from, to, subject, text });
  } catch (err) {
    console.error('Failed to send notification email:', err instanceof Error ? err.message : err);
  }
};
