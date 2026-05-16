/**
 * Optional transactional email via Resend (RESEND_API_KEY + NOTIFY_EMAIL_FROM).
 */

async function sendEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_EMAIL_FROM || 'alerts@airfarmerpro.com';
  if (!apiKey || !to) return { sent: false, reason: 'not_configured' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn('Resend email failed', res.status, body);
      return { sent: false, reason: 'api_error' };
    }
    return { sent: true };
  } catch (e) {
    console.warn('Email send failed', e.message);
    return { sent: false, reason: e.message };
  }
}

module.exports = { sendEmail };
