import "dotenv/config";

import { sendEmail } from "../utils/resendClient.js";

const TEST_TO = "merlinvaldezeducation@gmail.com";

async function main() {
  const data = await sendEmail({
    to: TEST_TO,
    subject: "Votefeed Test",
    html: "<strong>VoteFeed</strong><p>Your Resend setup is working.</p>",
    text: "VoteFeed: Your Resend setup is working.",
  });
  console.log("Email sent:", data);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
