import nodemailer, { Transporter } from "nodemailer";
import env from "../../config/env";

let transporterPromise: Promise<Transporter> | null = null;

async function getTransporter(): Promise<Transporter> {
  if (transporterPromise) return transporterPromise;

  transporterPromise = (async () => {
    if (env.SMTP_HOST) {
      return nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT ?? "587"),
        secure: Number(env.SMTP_PORT ?? "587") === 465,
        auth: env.SMTP_USER
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
      });
    }

    const testAccount = await nodemailer.createTestAccount();
    console.log(
      `No SMTP_HOST configured — using an Ethereal test inbox (${testAccount.user})`,
    );
    return nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
  })();

  return transporterPromise;
}

export async function sendEmail(to: string, subject: string, html: string) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: env.EMAIL_FROM ?? "Corez Ops <no-reply@corez.ops>",
    to,
    subject,
    html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`Email preview (${subject} → ${to}): ${previewUrl}`);
  }
}
