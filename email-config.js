// Email notification configuration for Hocus Focus
// Uses EmailJS (https://www.emailjs.com) — free tier: 200 emails/month
//
// Setup:
// 1. Create a free account at https://www.emailjs.com
// 2. Add an email service (Gmail, Outlook, etc.)
// 3. Create an email template with these variables:
//    {{to_email}}   — recipient's email
//    {{focus_time}} — e.g. "23h 15m"
//    {{change}}     — e.g. "up 12% from last week 📈"
//    {{score}}      — e.g. "78%"
//    {{top_site}}   — e.g. "github.com"
//
// 4. Copy your Service ID, Template ID, and Public Key below
// 5. Run this in the browser console on any extension page to save:
//    chrome.storage.local.set({ emailjsConfig: emailjsConfig });

const emailjsConfig = {
  serviceId: 'YOUR_SERVICE_ID',      // e.g. "service_abc123"
  templateId: 'YOUR_TEMPLATE_ID',    // e.g. "template_xyz789"
  publicKey: 'YOUR_PUBLIC_KEY'        // e.g. "user_ABCdef123"
};

// Uncomment and run in extension console to activate:
// chrome.storage.local.set({ emailjsConfig });
