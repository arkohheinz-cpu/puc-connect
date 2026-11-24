import nodemailer, { type Transporter } from 'nodemailer';

type SmtpConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  username?: string;
  password?: string;
  publicAppUrl: URL;
};

let transporter: Transporter | undefined;

function localDevelopmentOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const origin = new URL(value);
    if (
      origin.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) &&
      origin.pathname === '/' &&
      !origin.search &&
      !origin.hash &&
      !origin.username &&
      !origin.password
    ) {
      return origin.origin;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function readPublicAppUrl(requestOrigin?: string): URL {
  const defaultUrl =
    process.env.NODE_ENV === 'production'
      ? undefined
      : localDevelopmentOrigin(requestOrigin) ??
        (process.env.npm_lifecycle_event === 'start'
          ? `http://localhost:${process.env.PORT ?? '3001'}`
          : 'http://localhost:5173');
  const publicAppUrlValue = process.env.PUBLIC_APP_URL ?? defaultUrl;
  if (!publicAppUrlValue) {
    throw new Error('PUBLIC_APP_URL must be configured for production email links.');
  }
  const publicAppUrl = new URL(publicAppUrlValue);
  if (
    !['http:', 'https:'].includes(publicAppUrl.protocol) ||
    publicAppUrl.username ||
    publicAppUrl.password ||
    publicAppUrl.search ||
    publicAppUrl.hash
  ) {
    throw new Error('PUBLIC_APP_URL must be a valid HTTP or HTTPS app URL.');
  }
  if (
    process.env.NODE_ENV === 'production' &&
    publicAppUrl.protocol !== 'https:'
  ) {
    throw new Error('PUBLIC_APP_URL must use HTTPS in production.');
  }
  return publicAppUrl;
}

function buildVerificationUrl(token: string, appUrl: URL): string {
  const verificationUrl = new URL(
    `${appUrl.pathname.replace(/\/$/, '')}/verify-email`,
    appUrl.origin,
  );
  verificationUrl.searchParams.set('token', token);
  return verificationUrl.toString();
}

export function createDevelopmentVerificationUrl(
  token: string,
  requestOrigin?: string,
): string | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  return buildVerificationUrl(token, readPublicAppUrl(requestOrigin));
}

function hasSmtpConfiguration(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_PORT?.trim() &&
      process.env.SMTP_FROM?.trim(),
  );
}

function readConfiguration(requestOrigin?: string): SmtpConfiguration {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT);
  const from = process.env.SMTP_FROM?.trim();
  const username = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const secureSetting = process.env.SMTP_SECURE?.toLowerCase();

  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535 || !from) {
    throw new Error('SMTP_HOST, SMTP_PORT, and SMTP_FROM must be configured.');
  }
  if (Boolean(username) !== Boolean(password)) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must both be configured or both omitted.');
  }
  if (secureSetting && !['true', 'false'].includes(secureSetting)) {
    throw new Error('SMTP_SECURE must be true or false.');
  }
  if (port === 465 && secureSetting === 'false') {
    throw new Error('SMTP port 465 requires SMTP_SECURE=true.');
  }

  return {
    host,
    port,
    secure: secureSetting === 'true' || port === 465,
    from,
    ...(username ? { username, password } : {}),
    publicAppUrl: readPublicAppUrl(requestOrigin),
  };
}

export function validateEmailConfiguration(): void {
  readConfiguration();
}

export async function sendVerificationEmail(
  email: string,
  token: string,
  requestOrigin?: string,
): Promise<boolean> {
  if (
    process.env.NODE_ENV !== 'production' &&
    !hasSmtpConfiguration()
  ) {
    const appUrl = readPublicAppUrl(requestOrigin);
    console.info(
      `SMTP is not configured. Development verification link: ${buildVerificationUrl(token, appUrl)}`,
    );
    return false;
  }

  const config = readConfiguration(requestOrigin);
  const mailer =
    transporter ??
    (transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: !config.secure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      ...(config.username && config.password
        ? { auth: { user: config.username, pass: config.password } }
        : {}),
    }));
  const link = buildVerificationUrl(token, config.publicAppUrl);

  await mailer.sendMail({
    from: config.from,
    to: email,
    subject: 'Verify your PU Circle email',
    text: `Verify your email address to activate your PU Circle account: ${link}\n\nThis link expires in 24 hours. If you did not create an account, you can ignore this message.`,
    html: `<p>Verify your email address to activate your PU Circle account.</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours. If you did not create an account, you can ignore this message.</p>`,
  });
  return true;
}
