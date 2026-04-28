import { Link } from "react-router-dom";
import "./PrivacyPolicy.css";

const EFFECTIVE_DATE = "April 7, 2026";
const CONTACT_EMAIL = "merlinvaldezeducation@gmail.com";
const CONTACT_NAME = "Merlin Valdez";
const LEGAL_ENTITY = "Fahami Valdez Learning Services LLC";
const MAILING_ADDRESS = "66 Saint Nicholas Avenue Apt 2F, New York, NY";

const contents = [
  { id: "acceptance", label: "1. Acceptance of Terms" },
  { id: "eligibility", label: "2. Eligibility and Accounts" },
  { id: "service", label: "3. What VoteFeed Is" },
  { id: "content", label: "4. User Content and Acceptable Use" },
  { id: "moderation", label: "5. Moderation and Enforcement" },
  { id: "data-sources", label: "6. Public Data and AI Features" },
  { id: "third-parties", label: "7. Third-Party Services" },
  { id: "ip", label: "8. Intellectual Property" },
  { id: "disclaimers", label: "9. Disclaimers" },
  { id: "liability", label: "10. Limitation of Liability" },
  { id: "changes", label: "11. Changes to These Terms" },
  { id: "contact", label: "12. Contact Information" },
];

function TermsSection({ id, title, children }) {
  return (
    <section id={id} className="policy-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function TermsOfUse() {
  return (
    <div className="policy-page">
      <header className="policy-hero">
        <div className="policy-hero-top">
          <Link to="/" className="policy-back-link">
            <span aria-hidden="true">&larr;</span>
            <span>Back to VoteFeed</span>
          </Link>
          <Link to="/feed" className="logo-lockup" aria-label="VoteFeed feed">
            <span className="logo-mark">
              <img src="/bullhorn-solid.svg" alt="VoteFeed bullhorn" />
            </span>
            <span className="logo-text">VoteFeed</span>
          </Link>
        </div>

        <div className="policy-hero-copy">
          <p className="policy-kicker">Terms of Use</p>
          <h1>Rules for using VoteFeed.</h1>
        </div>

        <div className="policy-meta">
          <div>
            <span className="policy-meta-label">Effective Date</span>
            <span>{EFFECTIVE_DATE}</span>
          </div>
          <div>
            <span className="policy-meta-label">Last Updated</span>
            <span>{EFFECTIVE_DATE}</span>
          </div>
          <div>
            <span className="policy-meta-label">Contact</span>
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </div>
        </div>
      </header>

      <main className="policy-shell">
        <aside className="policy-toc" aria-label="Terms of use sections">
          <p className="policy-toc-label">On this page</p>
          <nav>
            {contents.map((item) => (
              <a key={item.id} href={`#${item.id}`}>
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        <article className="policy-card">
          <p>
            These Terms of Use (&quot;Terms&quot;) govern your access to and use
            of VoteFeed, including our website, applications, content, features,
            and related services (collectively, the &quot;Service&quot;).
          </p>
          <p>
            VoteFeed is operated by {LEGAL_ENTITY} (&quot;VoteFeed,&quot;
            &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;).
          </p>
          <p>
            By accessing or using the Service, you agree to be bound by these
            Terms. If you do not agree, do not use the Service.
          </p>

          <TermsSection id="acceptance" title="1. Acceptance of Terms">
            <p>
              These Terms apply to all users of the Service, including guests
              and registered account holders.
            </p>
            <p>
              Your use of the Service is also subject to our Privacy Policy.
              Please read that policy carefully to understand how we collect,
              use, and disclose information.
            </p>
          </TermsSection>

          <TermsSection id="eligibility" title="2. Eligibility and Accounts">
            <p>You must be at least 13 years old to use the Service.</p>
            <p>
              If you are at least 13 but under the age of legal majority where
              you live, you may use the Service only with permission and
              supervision from a parent or legal guardian.
            </p>
            <p>You may not use the Service if:</p>
            <ul>
              <li>your use would violate applicable law;</li>
              <li>
                you have previously been suspended or removed from the Service
                and we have not given written permission for your return; or
              </li>
              <li>
                you are using the Service on behalf of another person in a
                misleading or unauthorized way.
              </li>
            </ul>
            <p>
              Some features require an account. You are responsible for
              maintaining the confidentiality of your account credentials and for
              activity that occurs under your account to the extent permitted by
              law.
            </p>
          </TermsSection>

          <TermsSection id="service" title="3. What VoteFeed Is">
            <p>
              VoteFeed is a civic information and engagement platform that helps
              users identify their U.S. House Representative, review legislative
              and voting-related information, and submit reactions or comments
              tied to legislative content.
            </p>
            <p>VoteFeed is not:</p>
            <ul>
              <li>a government website;</li>
              <li>an official congressional or governmental service;</li>
              <li>legal advice, lobbying advice, or campaign advice; or</li>
              <li>
                a substitute for official government records, bill text, or
                congressional reporting.
              </li>
            </ul>
            <p>
              If there is a conflict between information on VoteFeed and an
              official source, you should rely on the official source.
            </p>
          </TermsSection>

          <TermsSection
            id="content"
            title="4. User Content and Acceptable Use"
          >
            <p>
              &quot;User Content&quot; means content you submit, post, transmit,
              or otherwise make available through the Service, including
              comments, reactions, and similar submissions.
            </p>
            <p>
              You retain ownership of your User Content, subject to the rights
              you grant us in these Terms.
            </p>
            <p>You are solely responsible for your User Content.</p>
            <p>By submitting User Content, you represent and warrant that:</p>
            <ul>
              <li>you own it or have the necessary rights to submit it;</li>
              <li>
                your submission does not violate any law or any third
                party&apos;s rights;
              </li>
              <li>
                your submission is not fraudulent, misleading, defamatory,
                threatening, harassing, or unlawful; and
              </li>
              <li>
                your submission does not contain confidential, private, or
                sensitive information that you are not authorized to disclose.
              </li>
            </ul>
            <p>You agree not to use the Service to:</p>
            <ul>
              <li>impersonate another person or organization;</li>
              <li>submit unlawful, abusive, hateful, or threatening content;</li>
              <li>
                disclose another person&apos;s private information without
                authorization;
              </li>
              <li>spam, scam, or manipulate engagement;</li>
              <li>
                introduce malware, malicious code, or harmful technical
                behavior;
              </li>
              <li>
                scrape, harvest, or extract Service data in an unauthorized way;
              </li>
              <li>
                interfere with the operation, security, or integrity of the
                Service; or
              </li>
              <li>violate applicable law or these Terms.</li>
            </ul>
          </TermsSection>

          <TermsSection id="moderation" title="5. Moderation and Enforcement">
            <p>
              We may, but are not required to, monitor, review, screen, remove,
              edit, restrict, or disable access to User Content or accounts at
              our discretion.
            </p>
            <p>We may take action if we believe content or conduct:</p>
            <ul>
              <li>violates these Terms;</li>
              <li>creates legal, reputational, or security risk;</li>
              <li>harms users, VoteFeed, or third parties; or</li>
              <li>
                is abusive, deceptive, clearly false in a harmful way, or
                otherwise inappropriate for the Service.
              </li>
            </ul>
            <p>
              Nothing in these Terms requires us to host, publish, or continue
              to display any particular content.
            </p>
          </TermsSection>

          <TermsSection id="data-sources" title="6. Public Data and AI Features">
            <p>
              VoteFeed relies on third-party and public sources to provide
              district, representative, bill, and voting information.
            </p>
            <p>You understand and agree that:</p>
            <ul>
              <li>
                district matching may fail for some addresses or return
                incomplete results;
              </li>
              <li>
                public legislative data may change, be delayed, or contain
                errors; and
              </li>
              <li>
                representative, bill, and vote information may not always
                reflect the latest official status immediately.
              </li>
            </ul>
            <p>
              VoteFeed may also provide AI-generated summaries or
              simplifications of public legislative content. These summaries are
              for general informational and educational purposes only and may be
              incomplete or inaccurate.
            </p>
          </TermsSection>

          <TermsSection id="third-parties" title="7. Third-Party Services">
            <p>
              The Service may integrate with, depend on, or link to third-party
              services, providers, or websites.
            </p>
            <p>
              We are not responsible for third-party services, content, terms,
              or privacy practices. Your use of third-party services may be
              governed by their own terms and policies.
            </p>
          </TermsSection>

          <TermsSection id="ip" title="8. Intellectual Property">
            <p>
              The Service, including its design, software, text, graphics,
              logos, branding, compilations, and other non-user content, is
              owned by VoteFeed or its licensors and is protected by applicable
              intellectual property laws.
            </p>
            <p>
              Subject to these Terms, we grant you a limited, non-exclusive,
              non-transferable, revocable license to access and use the Service
              for its intended personal, non-commercial use.
            </p>
            <p>You may not:</p>
            <ul>
              <li>
                copy, reproduce, distribute, or publicly display the Service
                except as allowed by law or with our written permission;
              </li>
              <li>
                modify, reverse engineer, or create derivative works from the
                Service except where prohibited by law from restricting that
                activity; or
              </li>
              <li>
                use our name, branding, or content in a way that suggests
                affiliation, endorsement, or sponsorship without permission.
              </li>
            </ul>
          </TermsSection>

          <TermsSection id="disclaimers" title="9. Disclaimers">
            <p>
              THE SERVICE IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS
              AVAILABLE&quot; BASIS TO THE MAXIMUM EXTENT PERMITTED BY LAW.
            </p>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, VOTEFEED DISCLAIMS ALL
              WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE,
              INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
              PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, ACCURACY, AND QUIET
              ENJOYMENT.
            </p>
            <p>
              We do not warrant that the Service will always be available,
              uninterrupted, secure, current, complete, or error-free.
            </p>
          </TermsSection>

          <TermsSection id="liability" title="10. Limitation of Liability">
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, VOTEFEED AND ITS OWNERS,
              OFFICERS, MEMBERS, EMPLOYEES, CONTRACTORS, AGENTS, AND AFFILIATES
              WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
              CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF
              PROFITS, REVENUE, DATA, GOODWILL, OR BUSINESS OPPORTUNITY, ARISING
              OUT OF OR RELATED TO YOUR USE OF OR INABILITY TO USE THE SERVICE.
            </p>
            <p>
              Nothing in these Terms excludes liability that cannot legally be
              excluded under applicable law.
            </p>
          </TermsSection>

          <TermsSection id="changes" title="11. Changes to These Terms">
            <p>We may update these Terms from time to time.</p>
            <p>
              If we make material changes, we may provide notice by updating the
              Effective Date or Last Updated date, posting the revised Terms on
              the Service, or providing additional notice where appropriate.
            </p>
            <p>
              Your continued use of the Service after updated Terms become
              effective means you agree to the revised Terms, to the extent
              permitted by law.
            </p>
          </TermsSection>

          <TermsSection id="contact" title="12. Contact Information">
            <p>If you have questions about these Terms, contact us at:</p>
            <div className="policy-contact-card">
              <p>
                <strong>VoteFeed / {LEGAL_ENTITY}</strong>
              </p>
              <p>
                <strong>Email:</strong>{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </p>
              <p>
                <strong>Mailing Address:</strong> {MAILING_ADDRESS}
              </p>
              <p>
                <strong>Contact Name:</strong> {CONTACT_NAME}
              </p>
            </div>
          </TermsSection>
        </article>
      </main>
    </div>
  );
}
