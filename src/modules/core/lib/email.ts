import nodemailer from 'nodemailer';

// Envío de correo centralizado. Antes cada ruta API duplicaba la creación del
// transporte nodemailer + lectura de variables SMTP. Aquí vive una sola vez.

export interface SendEmailOptions {
    to: string;
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
    headers?: Record<string, string>;
    /** Nombre que aparece en el From. Por defecto "PAGNOL". */
    fromName?: string;
    attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
}

/** True si las variables SMTP están configuradas. */
export function isEmailConfigured(): boolean {
    return !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

/**
 * Envía un correo vía SMTP. Lanza si la configuración SMTP falta (las rutas que
 * tratan el correo como opcional deben chequear isEmailConfigured() antes).
 */
export async function sendEmail(opts: SendEmailOptions): Promise<void> {
    const host = process.env.EMAIL_HOST;
    const port = Number(process.env.EMAIL_PORT) || 465;
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;
    const fromEmail = process.env.EMAIL_FROM || user;

    if (!host || !user || !pass) {
        throw new Error('SMTP no configurado (EMAIL_HOST / EMAIL_USER / EMAIL_PASS).');
    }

    const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
    });

    await transporter.sendMail({
        from: `"${opts.fromName || 'PAGNOL'}" <${fromEmail}>`,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        replyTo: opts.replyTo,
        headers: opts.headers,
        attachments: opts.attachments,
    });
}
