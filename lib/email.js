
// Line 1-4: Comments are good, keep them

// Line 5: ADD INPUT VALIDATION
async function sendEmail({ to, subject, html }) {
  // ✅ ADD: Validate inputs before processing
  if (!to?.trim() || !subject?.trim() || !html?.trim()) {
    throw new Error('Missing required parameters: to, subject, html');
  }

  // Line 6-9: IMPROVE return value and logging
  if (!process.env.RESEND_API_KEY) {
    // ✅ CHANGE: Return object instead of undefined, add dev mode indicator
    console.info(`[DEV MODE] Would email ${to}: "${subject}"`);
    return { success: true, dev: true };
  }

  // Line 10: KEEP (already good)
  const from = process.env.RESET_EMAIL_FROM || 'EduFlow <onboarding@resend.dev>';

  // Line 11-18: ADD TIMEOUT PROTECTION
  try {
    // ✅ ADD: Timeout controller for fetch
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
      signal: controller.signal, // ✅ ADD: abort signal
    });

    clearTimeout(timeout); // ✅ ADD: clean up timeout

    // Line 19-22: IMPROVE error handling
    if (!res.ok) {
      const body = await res.text().catch(() => '(no response body)');
      // ✅ CHANGE: Throw error instead of silent console.error
      throw new Error(`Resend API ${res.status}: ${body}`);
    }

    // ✅ ADD: Return success object
    return { success: true };

  } catch (error) {
    // ✅ ADD: Catch block for network/timeout errors
    console.error(`Failed to send email to ${to}:`, error.message);
    throw error; // Let caller handle the error
  }
}

module.exports = { sendEmail };
