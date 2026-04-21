import { Resend } from "resend";

function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");
  if (!from) throw new Error("Missing RESEND_FROM_EMAIL");
  return { apiKey, from };
}

export async function sendEmail({ to, subject, html, text }) {
  if (!html && !text) throw new Error("sendEmail requires html or text");
  const { apiKey, from } = getResendConfig();
  const resend = new Resend(apiKey);

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
    text,
  });
  if (error) throw new Error(error.message);
  return data;
}
