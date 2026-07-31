import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

type MailTransporter = ReturnType<typeof nodemailer.createTransport>;

/**
 * 邮件发送（SMTP）。变量命名与「AI电影梦 / 爱电影梦」backend/lib/mailer.js 对齐：
 * SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM / SMTP_FROM_NAME
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private cachedKey = '';
  private transporter: MailTransporter | null = null;

  constructor(private readonly config: ConfigService) {}

  readConfig() {
    const host = String(this.config.get('SMTP_HOST') || '').trim();
    const user = String(this.config.get('SMTP_USER') || '').trim();
    const pass = String(this.config.get('SMTP_PASS') || '');
    const port = Number(this.config.get('SMTP_PORT') || 465) || 465;
    const secureEnv = this.config.get('SMTP_SECURE');
    const secure =
      secureEnv === undefined || secureEnv === ''
        ? port === 465
        : /^(1|true|yes|on)$/i.test(String(secureEnv));
    const from = String(this.config.get('SMTP_FROM') || user).trim();
    const fromName = String(this.config.get('SMTP_FROM_NAME') || 'DramaVN').trim();
    return { host, port, secure, user, pass, from, fromName };
  }

  isConfigured(): boolean {
    const c = this.readConfig();
    return Boolean(c.host && c.user && c.pass && c.from);
  }

  private getTransporter(): MailTransporter {
    const c = this.readConfig();
    if (!this.isConfigured()) {
      throw new Error('邮件服务未配置，请先配置 SMTP_HOST / SMTP_USER / SMTP_PASS');
    }
    const key = `${c.host}:${c.port}:${c.secure}:${c.user}`;
    if (this.transporter && this.cachedKey === key) return this.transporter;
    this.transporter = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: { user: c.user, pass: c.pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
    this.cachedKey = key;
    return this.transporter;
  }

  async sendMail(opts: { to: string; subject: string; text: string; html?: string }) {
    const c = this.readConfig();
    const transporter = this.getTransporter();
    const info = await transporter.sendMail({
      from: c.fromName ? `"${c.fromName}" <${c.from}>` : c.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { messageId: (info as any)?.messageId || null };
  }

  async sendLoginOtp(to: string, code: string, expiresMinutes = 5) {
    return this.sendOtpMail(to, code, expiresMinutes, 'login');
  }

  async sendRegisterOtp(to: string, code: string, expiresMinutes = 5) {
    return this.sendOtpMail(to, code, expiresMinutes, 'register');
  }

  async sendResetOtp(to: string, code: string, expiresMinutes = 5) {
    return this.sendOtpMail(to, code, expiresMinutes, 'reset');
  }

  private async sendOtpMail(
    to: string,
    code: string,
    expiresMinutes: number,
    purpose: 'login' | 'register' | 'reset',
  ) {
    const titles = {
      login: { zh: '登录验证码', action: '登录' },
      register: { zh: '注册验证码', action: '注册' },
      reset: { zh: '重置密码验证码', action: '重置密码' },
    } as const;
    const t = titles[purpose];
    const subject = `【DramaVN】${t.zh} ${code}`;
    const text = [
      `你正在${t.action} DramaVN 短剧平台。`,
      '',
      `验证码：${code}`,
      `有效期：${expiresMinutes} 分钟`,
      '',
      '如果不是你本人操作，请忽略本邮件。',
    ].join('\n');
    const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2430">
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827">${t.zh}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#4b5563">你正在${t.action} DramaVN，请在页面中输入下面的验证码：</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 20px;background:#f3f4f6;border-radius:10px;text-align:center;color:#111827">${code}</div>
    <p style="margin:20px 0 0;font-size:13px;color:#6b7280">验证码 ${expiresMinutes} 分钟内有效，请勿转发给他人。</p>
  </div>`;
    try {
      return await this.sendMail({ to, subject, text, html });
    } catch (e: any) {
      this.logger.error(`sendOtpMail(${purpose}) failed: ${e?.message || e}`);
      throw e;
    }
  }
}
