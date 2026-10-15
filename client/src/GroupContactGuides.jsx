import { useState } from "react";
import { Copy, ExternalLink, Mail, Phone } from "lucide-react";

export default function GroupContactGuides({ action, members, drafts, status, error, onRetry }) {
  const [copyStatus, setCopyStatus] = useState({});
  const isCall = action === "call";
  return <section id={isCall ? "bill-call-script-panel" : "bill-message-template-panel"}
    className="action-guide-card comment-action-panel" aria-label={isCall ? "Call your Senators" : "Message your Senators"}>
    {members.map(member => {
      const href = isCall ? member.dialHref : member.contactUrl;
      const draft = drafts?.members?.find(item => item.memberId === member.id);
      const text = isCall ? draft?.callScript : draft?.messageTemplate;
      return <section className="group-contact-guide" key={member.id} aria-label={member.name}>
        {href ? <a className="action-guide-inline-link" href={href}
          target={isCall ? undefined : "_blank"} rel={isCall ? undefined : "noreferrer"}>
          {isCall ? <Phone size={16} /> : <Mail size={16} />}
          {isCall ? `Call Sen. ${member.name} at ${member.phone}` : `Message Sen. ${member.name}`}
          {!isCall && <ExternalLink size={16} />}
        </a> : <span className="action-guide-inline-missing">{isCall ? "Call information" : "Contact page"} unavailable for Sen. {member.name}</span>}
        {status === "ready" && text && <>
          {!isCall && <button type="button" className="template-copy-btn"
            aria-label={`Copy message for Sen. ${member.name}`} onClick={async () => {
              try { await navigator.clipboard.writeText(text); setCopyStatus(prev => ({ ...prev, [member.id]: "Copied to clipboard." })); }
              catch { setCopyStatus(prev => ({ ...prev, [member.id]: "Copy failed. Try again." })); }
            }}><Copy size={14} /> Copy message</button>}
          <span role="status">{copyStatus[member.id]}</span>
          <pre className="action-guide-template">{text}</pre>
        </>}
      </section>;
    })}
    {status === "loading" && <p role="status">Preparing your {isCall ? "call scripts" : "messages"}…</p>}
    {status === "error" && <div role="alert"><p className="error-text">{error}</p><button type="button" className="ghost-btn" onClick={onRetry}>Retry</button></div>}
  </section>;
}
