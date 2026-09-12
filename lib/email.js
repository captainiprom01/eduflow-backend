// Shared by password reset, email verification, and deadline reminders.
// Without RESEND_API_KEY set, this just logs instead of sending — handy
// for local development so you're not forced to configure email to test
// everything else.
async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`RESEND_API_KEY not set — would have emailed ${to}: "${subject}"`);
    return;
  }
  const from = process.env.RESET_EMAIL_FROM || 'EduFlow <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Resend send failed', res.status, body);
  }
}

module.exports = { sendEmail };
