import { Link } from "react-router-dom";
import "./PrivacyPolicy.css";

const EFFECTIVE_DATE = "April 7, 2026";
const CONTACT_EMAIL = "merlinvaldezeducation@gmail.com";
const CONTACT_NAME = "Merlin Valdez";
const LEGAL_ENTITY = "Fahami Valdez Learning Services LLC";
const MAILING_ADDRESS = "66 Saint Nicholas Avenue Apt 2F, New York, NY";

const contents = [
  { id: "scope", label: "1. Scope" },
  { id: "information-we-collect", label: "2. Information We Collect" },
  { id: "how-we-use-information", label: "3. How We Use Information" },
  { id: "ai-summaries", label: "4. AI-Generated Legislative Summaries" },
  { id: "how-we-disclose-information", label: "5. How We Disclose Information" },
  { id: "sale-sharing", label: "6. Sale, Sharing, and Targeted Advertising" },
  { id: "data-retention", label: "7. Data Retention" },
  { id: "rights-and-choices", label: "8. Your Choices and Rights" },
  { id: "dnt", label: "9. Do Not Track and CalOPPA Notice" },
  { id: "security", label: "10. Data Security" },
  { id: "children", label: "11. Children's Privacy" },
  { id: "third-parties", label: "12. Third-Party Services and Links" },
  { id: "changes", label: "13. Changes to This Privacy Policy" },
  { id: "contact", label: "14. Contact Us" },
];

function PolicySection({ id, title, children }) {
  return (
    <section id={id} className="policy-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPolicy() {
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
          <p className="policy-kicker">Privacy Policy</p>
          <h1>How VoteFeed collects, uses, and protects your information.</h1>
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
        <aside className="policy-toc" aria-label="Privacy policy sections">
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
            VoteFeed (&quot;VoteFeed,&quot; &quot;we,&quot; &quot;us,&quot; or
            &quot;our&quot;) provides a web-based civic information and
            engagement platform that helps users identify their U.S. House
            Representative, review voting records, and interact with legislative
            content.
          </p>
          <p>
            This Privacy Policy explains how we collect, use, disclose, and
            retain information when you visit VoteFeed, create an account, use
            district lookup features, review legislative content, submit
            reactions or comments, or otherwise interact with our services
            (collectively, the &quot;Service&quot;).
          </p>
          <p>
            If you do not agree with this Privacy Policy, do not use the
            Service.
          </p>

          <PolicySection id="scope" title="1. Scope">
            <p>
              This Privacy Policy applies to information collected through
              VoteFeed&apos;s website, application features, and related
              services.
            </p>
            <p>This Privacy Policy does not govern:</p>
            <ul>
              <li>
                information collected by third parties on their own websites or
                services, except as described here;
              </li>
              <li>
                public legislative information and government records that we
                obtain from public sources; or
              </li>
              <li>
                content, services, or policies of third-party sites linked from
                the Service.
              </li>
            </ul>
          </PolicySection>

          <PolicySection
            id="information-we-collect"
            title="2. Information We Collect"
          >
            <p>We collect information in several ways.</p>

            <h3>A. Information You Provide Directly</h3>
            <p>We may collect information you provide to us, including:</p>
            <ul>
              <li>your first name and last name;</li>
              <li>your email address;</li>
              <li>
                your street address, city, state, and ZIP code when you use
                district lookup or onboarding features;
              </li>
              <li>
                your account registration and authentication information as made
                available through our authentication provider;
              </li>
              <li>
                your reactions to legislation, including whether you approve or
                disapprove of a bill; and
              </li>
              <li>
                comments or other text you submit in connection with a bill or
                interaction.
              </li>
            </ul>

            <h3>B. Address and District Lookup Information</h3>
            <p>
              VoteFeed allows users, including guest users, to enter a U.S.
              address in order to determine the user&apos;s congressional
              district and assigned Representative.
            </p>
            <p>As currently implemented:</p>
            <ul>
              <li>we use the address you submit to perform district lookup;</li>
              <li>
                we transmit that address to a third-party geocoding service
                operated by the U.S. Census Bureau; and
              </li>
              <li>
                we use the lookup result to derive your state and congressional
                district.
              </li>
            </ul>
            <p>
              As of the Effective Date, VoteFeed does not intentionally store
              your full street address as a persistent field in the main user
              profile table of our application database. Instead, we currently
              store the derived state and congressional district associated with
              your account. Even so, address information may still be processed
              transiently by our systems and by third parties involved in the
              lookup transaction.
            </p>

            <h3>
              C. Information We Receive From Authentication and Session
              Providers
            </h3>
            <p>
              We use Clerk for account authentication, sign-in, sign-up, and
              session management.
            </p>
            <p>Through that integration, we may receive or process:</p>
            <ul>
              <li>your Clerk user identifier;</li>
              <li>your name and primary email address;</li>
              <li>your authentication status; and</li>
              <li>
                session-related metadata and tokens necessary to authenticate
                requests to our backend.
              </li>
            </ul>
            <p>
              Clerk may also use cookies and related technologies that are
              necessary for authentication and account session management.
            </p>
          </PolicySection>

          <PolicySection
            id="how-we-use-information"
            title="3. How We Use Information"
          >
            <h3>D. Information Collected Automatically</h3>
            <p>
              When you use the Service, we and our service providers may
              automatically collect certain technical and usage information, such
              as browser type and version, operating system, device
              characteristics, pages or routes viewed, timestamps and
              interaction events, diagnostic information, and request metadata
              such as IP address or similar identifiers as processed by our
              hosting, analytics, and infrastructure providers.
            </p>

            <h3>E. Browser Storage, Cookies, and Similar Technologies</h3>
            <p>We currently use browser and session technologies, including:</p>
            <ul>
              <li>
                authentication and session cookies or similar technologies
                through Clerk;
              </li>
              <li>Vercel Web Analytics for site usage measurement;</li>
              <li>
                browser storage such as <code>localStorage</code> to remember
                theme preferences; and
              </li>
              <li>
                browser storage such as <code>sessionStorage</code> for
                short-lived interface state.
              </li>
            </ul>

            <h3>F. Information Generated Through Your Use of the Service</h3>
            <p>
              When you use VoteFeed, we create and store records related to your
              activity, including your account profile record, your derived
              district and state, your bill interactions, your comment
              submissions, and your interaction history tied to your account.
            </p>

            <h3>G. Information From Public and Third-Party Sources</h3>
            <p>
              We also use information from public and third-party sources to
              operate the Service, including the U.S. Census Bureau geocoding
              service for district lookup, Congress.gov and related public
              legislative sources for bill and vote information, and public
              legislative summaries used to power bill and voting record
              features.
            </p>

            <p>
              We may use personal information and related data for the following
              purposes:
            </p>
            <ul>
              <li>to provide, operate, maintain, and secure the Service;</li>
              <li>to authenticate users and manage accounts;</li>
              <li>
                to determine a user&apos;s congressional district and associated
                Representative;
              </li>
              <li>
                to personalize a user&apos;s feed based on district and
                legislative context;
              </li>
              <li>
                to display legislative, representative, and interaction-related
                content;
              </li>
              <li>to save, update, and delete user reactions and comments;</li>
              <li>to support guest browsing and logged-in features;</li>
              <li>
                to understand usage patterns, improve performance, and debug
                issues;
              </li>
              <li>
                to detect, prevent, investigate, and respond to fraud, abuse,
                misuse, or security incidents;
              </li>
              <li>
                to enforce our policies, protect rights and safety, and comply
                with legal obligations; and
              </li>
              <li>
                to improve the design, reliability, and functionality of
                VoteFeed.
              </li>
            </ul>
          </PolicySection>

          <PolicySection
            id="ai-summaries"
            title="4. AI-Generated Legislative Summaries"
          >
            <p>
              VoteFeed includes AI-generated bill summary features for public
              legislative material.
            </p>
            <p>As currently implemented:</p>
            <ul>
              <li>
                the AI summary workflow is used to generate summaries of public
                legislative bill content;
              </li>
              <li>
                the input to that workflow is public bill summary material, not
                your profile fields or your address; and
              </li>
              <li>
                as of the Effective Date, VoteFeed does not intentionally use
                your submitted comments as prompts for the current AI bill
                summary feature.
              </li>
            </ul>
            <p>
              We may use third-party AI service providers to process legislative
              content for this purpose. If we later use AI tools on
              user-submitted content, we will update this Privacy Policy before
              doing so.
            </p>
          </PolicySection>

          <PolicySection
            id="how-we-disclose-information"
            title="5. How We Disclose Information"
          >
            <p>We may disclose information in the following circumstances.</p>

            <h3>A. Service Providers and Vendors</h3>
            <p>
              We may disclose information to vendors and service providers that
              help us run VoteFeed, including providers for authentication and
              identity management such as Clerk, hosting and analytics providers
              such as Vercel, database infrastructure such as PostgreSQL and
              Supabase-related services, district lookup through the U.S.
              Census Bureau geocoder, and AI processing providers used for
              public legislative summaries.
            </p>

            <h3>B. User-Generated Content and Interactions</h3>
            <p>
              VoteFeed is an interactive civic platform. Information you choose
              to submit, including comments and bill reactions, may be stored in
              connection with your account and may be accessible within the
              Service, through support or moderation workflows, or through other
              disclosures described in this Privacy Policy.
            </p>
            <p>
              For that reason, you should not submit information in comments
              that you consider private, sensitive, or confidential.
            </p>

            <h3>C. Legal Compliance and Protection</h3>
            <p>
              We may disclose information if we believe disclosure is reasonably
              necessary to comply with applicable law, regulation, legal
              process, or governmental request, to protect the rights, property,
              safety, users, or security of VoteFeed or others, or to
              investigate or respond to suspected fraud, abuse, harassment,
              threats, or unlawful conduct.
            </p>

            <h3>D. Business Transactions</h3>
            <p>
              If VoteFeed is involved in a merger, acquisition, financing, asset
              sale, reorganization, bankruptcy, or similar transaction,
              information may be disclosed as part of that process, subject to
              applicable law.
            </p>
          </PolicySection>

          <PolicySection
            id="sale-sharing"
            title="6. Sale, Sharing, and Targeted Advertising"
          >
            <p>As of the Effective Date:</p>
            <ul>
              <li>
                we do not sell personal information for monetary consideration;
              </li>
              <li>
                we do not knowingly share personal information for
                cross-context behavioral advertising; and
              </li>
              <li>
                we do not use third-party advertising networks on the Service to
                track you across unrelated sites for behavioral advertising
                purposes.
              </li>
            </ul>
            <p>
              If that changes, we will update this Privacy Policy and provide
              any notices required by law.
            </p>
          </PolicySection>

          <PolicySection id="data-retention" title="7. Data Retention">
            <p>
              We retain information for as long as reasonably necessary for the
              purposes described in this Privacy Policy, including to provide
              the Service, maintain your account, comply with law, resolve
              disputes, and enforce agreements.
            </p>
            <p>In general:</p>
            <ul>
              <li>
                account profile data may be retained while your account remains
                active and for a reasonable period afterward;
              </li>
              <li>
                derived district and state data may be retained as part of your
                account record;
              </li>
              <li>
                comments and bill interaction records may be retained until
                deleted, account closure, moderation action, or as otherwise
                needed for Service integrity;
              </li>
              <li>
                analytics and infrastructure records may be retained according
                to internal needs and vendor retention settings; and
              </li>
              <li>
                local browser storage remains on your device until deleted by
                you or overwritten by the application.
              </li>
            </ul>
            <p>
              Although we currently do not intentionally store full street
              addresses as a persistent main profile field in our application
              database, address information may be processed during lookup flows
              and may be retained temporarily in system operations, transit, or
              provider-side processing as permitted by law and provider
              practices.
            </p>
          </PolicySection>

          <PolicySection
            id="rights-and-choices"
            title="8. Your Choices and Rights"
          >
            <p>
              Depending on your location and applicable law, you may have rights
              relating to your personal information, including rights to access
              information we hold about you, request correction of inaccurate
              information, request deletion of information, request information
              about categories of data collected and disclosed, and request a
              copy of certain information in a portable form.
            </p>
            <p>You may also have choices to:</p>
            <ul>
              <li>stop using the Service;</li>
              <li>sign out of your account;</li>
              <li>
                delete or edit comments and reactions through available product
                features where supported;
              </li>
              <li>
                clear browser cookies or browser storage through your browser
                settings; and
              </li>
              <li>
                disable certain analytics technologies through browser tools or
                settings where applicable.
              </li>
            </ul>
            <p>
              To make a privacy request, contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> or by
              mail at {MAILING_ADDRESS}. We may need to verify your identity
              before processing certain requests.
            </p>
          </PolicySection>

          <PolicySection id="dnt" title="9. Do Not Track and CalOPPA Notice">
            <p>
              Some browsers offer a &quot;Do Not Track&quot; (&quot;DNT&quot;)
              setting. At this time, VoteFeed does not respond to DNT signals
              with a separate or modified technical treatment, in part because
              no consistent industry standard for DNT handling exists.
            </p>
            <p>As of the Effective Date:</p>
            <ul>
              <li>
                VoteFeed does not use third-party behavioral advertising
                networks for cross-site advertising; and
              </li>
              <li>
                third parties such as our authentication, infrastructure, and
                analytics providers may collect technical information when you
                use the Service in order to provide their services to us.
              </li>
            </ul>
          </PolicySection>

          <PolicySection id="security" title="10. Data Security">
            <p>
              We use reasonable administrative, technical, and organizational
              measures designed to protect information against unauthorized
              access, loss, misuse, alteration, or disclosure.
            </p>
            <p>
              No method of transmitting data over the internet or storing data
              is completely secure. Therefore, we cannot guarantee absolute
              security.
            </p>
          </PolicySection>

          <PolicySection id="children" title="11. Children&apos;s Privacy">
            <p>
              VoteFeed is a general-audience service and is not directed to
              children under 13.
            </p>
            <p>
              We do not knowingly collect personal information from children
              under 13. If you are under 13, do not use the Service or provide
              any personal information to us.
            </p>
            <p>
              If you believe a child under 13 has provided personal information
              to us, contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, and we
              will take appropriate steps to investigate and, if appropriate,
              delete the information.
            </p>
          </PolicySection>

          <PolicySection
            id="third-parties"
            title="12. Third-Party Services and Links"
          >
            <p>
              The Service may integrate with or rely on third-party services.
              Those services have their own privacy policies and practices, and
              we encourage you to review them.
            </p>
            <p>Relevant providers may include:</p>
            <ul>
              <li>Clerk;</li>
              <li>Vercel;</li>
              <li>Supabase or other database and infrastructure providers;</li>
              <li>the U.S. Census Bureau geocoding service;</li>
              <li>Congress.gov and related public data sources; and</li>
              <li>
                OpenAI or other AI processing providers used for public
                legislative summaries.
              </li>
            </ul>
            <p>
              We are not responsible for the privacy practices of third parties
              except as required by law.
            </p>
          </PolicySection>

          <PolicySection
            id="changes"
            title="13. Changes to This Privacy Policy"
          >
            <p>We may update this Privacy Policy from time to time.</p>
            <p>If we make material changes, we may provide notice by:</p>
            <ul>
              <li>updating the Effective Date or Last Updated date;</li>
              <li>posting the revised Privacy Policy on the Service; or</li>
              <li>
                providing additional notice where appropriate, such as through
                the website or account-related messaging.
              </li>
            </ul>
            <p>
              Your continued use of the Service after changes become effective
              means you accept the updated Privacy Policy, to the extent
              permitted by law.
            </p>
          </PolicySection>

          <PolicySection id="contact" title="14. Contact Us">
            <p>
              If you have questions, requests, or concerns about this Privacy
              Policy or our privacy practices, contact us at:
            </p>
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
            <p>
              If you are a California resident and need a California-specific
              privacy disclosure or request method, you may also use the contact
              information above.
            </p>
          </PolicySection>
        </article>
      </main>
    </div>
  );
}
