const nodemailer = require('nodemailer');

// Configure transporter with SendGrid credentials
// IMPORTANT: Set SMTP_PASS environment variable with your SendGrid API key
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER || 'apikey',
        pass: process.env.SMTP_PASS, // Must be set in environment variables
    },
});

/**
 * Send an email
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - Email body (HTML)
 */
async function sendEmail(to, subject, html) {
    try {
        const info = await transporter.sendMail({
            from: '"Opus" <no-reply@opus-app.com>', // Sender address - update this if you have a verified sender
            to,
            subject,
            html,
        });
        console.log('Message sent: %s', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
}

/**
 * Send app invite email
 * @param {string} to - Recipient email
 * @param {string} studentName - Student's name
 * @param {string} ensembleName - Ensemble name
 */
async function sendAppInvite(to, studentName, ensembleName) {
    const subject = `Join ${ensembleName} on the Opus App`;
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4f46e5;">You're invited to join Opus!</h2>
      <p>Hi ${studentName},</p>
      <p>You've been invited to join <strong>${ensembleName}</strong> on the Opus Student App.</p>
      <p>With the app, you can:</p>
      <ul>
        <li>View your rehearsal schedule</li>
        <li>Access your music library</li>
        <li>See your fees and payments</li>
        <li>Receive important announcements</li>
      </ul>
      <p>To get started:</p>
      <ol>
        <li>Download the <strong>Expo Go</strong> app on your phone.</li>
        <li>Scan the QR code or search for the project.</li>
        <li>Sign up using this email address: <strong>${to}</strong></li>
      </ol>
      <div style="margin-top: 30px; padding: 20px; background-color: #f3f4f6; border-radius: 8px;">
        <p style="margin: 0; font-size: 14px; color: #6b7280;">
          <strong>Note:</strong> Make sure to sign up with the email address this message was sent to so your account is automatically linked to your ensemble.
        </p>
      </div>
    </div>
  `;
    return sendEmail(to, subject, html);
}

module.exports = {
    sendEmail,
    sendAppInvite
};
