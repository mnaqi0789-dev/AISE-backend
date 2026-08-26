export function passwordResetEmail(resetUrl: string): {
  subject: string;
  html: string;
} {
  return {
    subject: "Reset your Corez Ops password",
    html: `
      <div style="font-family: monospace; max-width: 480px;">
        <h2>Reset your password</h2>
        <p>A password reset was requested for this account. This link expires in 30 minutes.</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>If you didn't request this, you can ignore this email — your password will not change.</p>
      </div>
    `,
  };
}

export function verificationEmail(verifyUrl: string): {
  subject: string;
  html: string;
} {
  return {
    subject: "Verify your Corez Ops email",
    html: `
      <div style="font-family: monospace; max-width: 480px;">
        <h2>Verify your email</h2>
        <p>Click below to verify your email address. This link expires in 24 hours.</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      </div>
    `,
  };
}
