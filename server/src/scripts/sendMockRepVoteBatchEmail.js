import "dotenv/config"; // Load RESEND_API_KEY / RESEND_FROM_EMAIL from server/.env.
import { sendEmail } from "../utils/resendClient.js"; // Use your real Resend send helper.
import { buildRepVoteBatchEmail } from "../utils/buildRepVoteBatchEmail.js"; // Use your real VoteFeed batch email builder.

process.env.APP_ORIGIN ??= "http://localhost:5173"; // Fallback app URL for links if APP_ORIGIN is not set in env.

async function main() {
  // Wrap the send flow so we can await the email call cleanly.
  const email = buildRepVoteBatchEmail({
    // Build the exact subject/html/text payload your sync job will eventually use.
    firstName: "Merlin", // Greeting becomes "Hi Merlin,".
    repName: "Rep. Alexandria Smith", // Fake rep name for testing the subject and body copy.
    votes: [
      // Mock a batch of new votes so you can see the final email format now.
      {
        legislationType: "hres", // Resolution type should render as "H.Res."
        legislationNumber: 1128, // Resolution number used in the bullet/link text.
        billTitle: "", // Blank on purpose so the resolution label path is exercised.
        vote: "Yea", // Representative's vote cast.
      },
      {
        legislationType: "hr", // Standard House bill.
        legislationNumber: 42, // Bill number used in the VoteFeed bill route.
        billTitle: "A Bill To Improve Civic Participation", // Real title path for non-resolution votes.
        vote: "Nay", // Representative's vote cast.
      },
      {
        legislationType: "hjres", // Joint resolution type to test another formatted label.
        legislationNumber: 88, // Joint resolution number.
        billTitle: "", // Blank so the formatted label is used.
        vote: "Yea", // Representative's vote cast.
      },
    ],
  });

  const result = await sendEmail({
    // Send the built email through Resend.
    to: "merlinvaldez@gmail.com", // Your target inbox.
    subject: email.subject, // Generated subject line.
    html: email.html, // Generated HTML body.
    text: email.text, // Generated plain-text fallback.
  });

  console.log("Mock rep vote batch email sent:", result); // Print the Resend response so you can confirm success.
}

main().catch((err) => {
  // Surface any failure clearly in the terminal.
  console.error(err); // Print the full error.
  process.exitCode = 1; // Exit non-zero on failure.
});
