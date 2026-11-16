import SummarySourceToggle from "./SummarySourceToggle";
import OfficialSummary from "./OfficialSummary";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { isAnsweredVote, getCardResponseState, buildCardStanceRequest, reconcileCardStanceResult } from "./voteInteractions";
import { panelBill } from "./billDetailContext";
import { publicCommentsUrl, otherPublicComments, ownedCommentsForFolder, commentRecipientLabel } from "./publicComments";
import BillVoteFolders from "./BillVoteFolders";
import GroupContactGuides from "./GroupContactGuides";
import { sharedContactRequest, validateSharedContactDrafts } from "./sharedContactFlow";
import { officialSummaryHtml } from "./feedSummaries";
import "./Feed.css";
import "./BillPage.css";
import {
  MoreHorizontal,
  Pencil,
  ThumbsUp,
  ThumbsDown,
  ArrowLeft,
  Clock3,
  Copy,
  FileText,
  ExternalLink,
  Info,
  CheckCircle2,
  XCircle,
  Mail,
  Eye,
  Phone,
  MessageSquare,
  Send,
  Trash2,
} from "lucide-react";
import { UserAvatar } from "@clerk/clerk-react";
import { API_BASE } from "./constants";
import { useAuth } from "./authContext";

const getRepLastName = (fullName = "") => {
  const normalized = fullName.trim();
  if (!normalized) return "";
  if (normalized.includes(",")) {
    return normalized.split(",")[0].trim();
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
};



const formatVotedOn = (value) => {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const formatBillLabel = (type, number) => {
  const normalized = String(type || "hr").toLowerCase();
  const labels = {
    hr: "H.R.",
    hres: "H.Res.",
    hjres: "H.J.Res.",
    hconres: "H.Con.Res.",
    s: "S.",
    sres: "S.Res.",
    sjres: "S.J.Res.",
    sconres: "S.Con.Res.",
  };
  return `${labels[normalized] || normalized.toUpperCase()} ${number}`;
};

const formatQuickSummary = (summary = "") => {
  const trimmed = String(summary)
    .replace(/^\s*to\s+/i, "")
    .replace(/[.!?]+\s*$/, "")
    .trim();
  if (!trimmed) return "summarize what this measure would do";
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
};

const formatCommentTimestamp = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const buildRepContactUrl = (websiteUrl) => {
  if (!websiteUrl) return null;
  try {
    const url = new URL(websiteUrl);
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    const lowerPath = normalizedPath.toLowerCase();
    url.pathname = !normalizedPath
      ? "/contact"
      : lowerPath.endsWith("/contact")
        ? normalizedPath
        : `${normalizedPath}/contact`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

const getDialHref = (phone) => {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d]/g, "");
  return digits ? `tel:${digits}` : null;
};

const copyTextToClipboard = async (text) => {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const didCopy = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!didCopy) {
    throw new Error("Copy failed");
  }
};

const requestPublicComments = async ({ billId, isAuthed, authFetch, location }) => {
  const requestUrl = publicCommentsUrl(API_BASE, billId, location);
  const resp = isAuthed ? await authFetch(requestUrl) : await fetch(requestUrl);
  if (!resp.ok) {
    const details = await resp.text();
    throw new Error(details || "Failed to load comments");
  }
  const data = await resp.json();
  return data.comments ?? [];
};

export default function BillDetailPanel({ detail, folder, active, folders, selectedFolder, onFolderChange, onBusy, showOriginal, setShowOriginal, aiSummary, aiLoading, aiError, onRetrySummary }) {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const discussionRequested = hash === "#public-comments";
  const publicDiscussionRef = useRef(null);
  const { billNumber } = useParams();
  const card = folder.id === "All Reps" ? null : folder.cards[0] ?? null;
  // A combined card has one comment composer and one discussion comment.
  // Individual recipients appear only inside the contact guides.
  const member = card?.members[0];
  const roster = [detail.delegation.houseMember, ...detail.delegation.senators].filter(Boolean);
  const rep = roster.find(item => item.bioguideid === member?.bioguideId) ?? null;
  const repFullName = rep?.full_name ?? "";
  const repLastName = getRepLastName(repFullName);
  const { token, authFetch } = useAuth();
  const isAuthed = Boolean(token);
  const guestBarRef = useRef(null);
  const guestHighlightTimeoutRef = useRef(null);
  const copyNoticeTimeoutRef = useRef(null);
  const commentMenuRef = useRef(null);
  const bill = useMemo(() => panelBill(detail, card, member), [detail, card, member]);
  const status = "ready";
  const error = "";
  const [interaction, setInteraction] = useState(null);
  const [ownedInteractions, setOwnedInteractions] = useState([]);
  const [selectedCommentInteractionId, setSelectedCommentInteractionId] = useState(null);
  const [groupInteractions, setGroupInteractions] = useState([]);
  const [interactionsReady, setInteractionsReady] = useState(false);
  const [ownedCommentId, setOwnedCommentId] = useState(null);
  const [commentDraftText, setCommentDraftText] = useState("");
  const commentDraftsRef = useRef(new Map());
  const [commentModerationStatus, setCommentModerationStatus] = useState(null);
  const [isCommentPublic, setIsCommentPublic] = useState(false);
  const [isCommentComposerOpen, setIsCommentComposerOpen] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isSavingCommentPublic, setIsSavingCommentPublic] = useState(false);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("");
  const [interactionError, setInteractionError] = useState("");
  const [isSavingStance, setIsSavingStance] = useState(false);
  const busy = isSavingStance || isSubmittingComment || isSavingCommentPublic;
  useEffect(() => { if (active) onBusy(busy); }, [active, busy, onBusy]);
  const stancePendingRef = useRef(false);
  const [isGuestBarHighlighted, setIsGuestBarHighlighted] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const [messageCopyStatus, setMessageCopyStatus] = useState("idle");
  const [isCommentMenuOpen, setIsCommentMenuOpen] = useState(false);
  const contactDraftRequestRef = useRef(0);
  const [contactDrafts, setContactDrafts] = useState(null);
  const [contactDraftStatus, setContactDraftStatus] = useState("idle");
  const [contactDraftError, setContactDraftError] = useState("");

  useEffect(() => () => { contactDraftRequestRef.current += 1; }, []);
  const [publicVisibilityError, setPublicVisibilityError] = useState("");
  const [publicComments, setPublicComments] = useState([]);
  const [publicCommentsStatus, setPublicCommentsStatus] = useState("idle");
  const [publicCommentsError, setPublicCommentsError] = useState("");
  const [isPublicCommentsOpen, setIsPublicCommentsOpen] = useState(discussionRequested);
  const [usefulPendingByCommentId, setUsefulPendingByCommentId] = useState({});

  const officialHtml = officialSummaryHtml(bill?.summary);
  const billId = bill?.bill_id ?? bill?.id ?? null;
  const fullBillUrl = bill?.legislation_url ?? null;
  const canReadFullBill = Boolean(fullBillUrl);
  const latestVoteDate = bill?.latest_vote_date ?? bill?.voted_on ?? null;
  const memberTitle = String(rep?.chamber || "")
    .toLowerCase()
    .includes("senate")
    ? "Sen."
    : "Rep.";
  const memberVoteId = bill?.member_vote_id ?? null;
  const grouped = card?.members.length === 2;
  const groupStanceKey = grouped ? JSON.stringify(groupInteractions.map(answer => [answer.id, answer.member_vote_id, answer.stance])) : null;
  const groupResponse = grouped ? getCardResponseState(card, groupInteractions) : null;
  const currentStance = grouped ? groupResponse.stance : isAnsweredVote(interaction, memberVoteId) ? interaction.stance : null;
  const billLabel = formatBillLabel(
    bill?.legislation_type ?? bill?.bill_type,
    bill?.legislationnumber ?? bill?.number ?? billNumber,
  );
  const repReference = repFullName
    ? `${memberTitle} ${repLastName || repFullName}`
    : "my representative";
  const responseReference = grouped ? `Sens. ${card.members.map(item => getRepLastName(item.name)).join(" and ")}` : repReference;
  const commentAuthorName = userName || "You";
  const scopedOwnedInteractions = ownedCommentsForFolder(ownedInteractions, folder, detail.delegation);
  const showCommentRecipients = folder.id === "All Reps";
  const commentInteraction = selectedCommentInteractionId === interaction?.id
    ? interaction
    : scopedOwnedInteractions.find(item => item.id === selectedCommentInteractionId)
      ?? scopedOwnedInteractions.find(item => item.id === interaction?.id)
      ?? scopedOwnedInteractions[0] ?? interaction;
  const commentDraftKey = commentInteraction?.id ?? memberVoteId;
  const commentRep = roster.find(item => item.bioguideid === commentInteraction?.rep_bioguide_id);
  const commentRepReference = commentRep?.full_name || repReference;
  const commentRepDialHref = getDialHref(commentRep?.office_phone);
  const commentRepContactUrl = buildRepContactUrl(commentRep?.official_website_url);
  const useGroupedContact = grouped && commentInteraction?.id === interaction?.id;
  const updateCommentInteraction = (update) => {
    const updated = update(commentInteraction);
    setOwnedInteractions(current => {
      const others = current.filter(item => item.id !== updated.id);
      return updated.comment_id ? [updated, ...others] : others;
    });
    if (updated.id === interaction?.id) setInteraction(updated);
  };
  const approvedCommentText = commentInteraction?.comment_approved_text?.trim() ?? "";
  const hasPostedOwnedComment = Boolean(approvedCommentText);
  const discussionComments = otherPublicComments(publicComments);
  const showPostedOwnedComment =
    hasPostedOwnedComment && !isCommentComposerOpen;
  const showOwnedCommentThread =
    Boolean(commentInteraction?.id) && (isCommentComposerOpen || showPostedOwnedComment || Boolean(commentInteraction.comment_id));
  const showPublicCommentsPanel =
    discussionRequested || discussionComments.length > 0 || Boolean(publicCommentsError);
  const publicCommentsToggleLabel =
    discussionComments.length === 1
      ? isPublicCommentsOpen
        ? "Hide 1 comment"
        : "Show 1 comment"
      : isPublicCommentsOpen
        ? `Hide ${discussionComments.length} comments`
        : `Show ${discussionComments.length} comments`;
  const callScript = contactDrafts?.callScript ?? "";
  const messageTemplate = contactDrafts?.messageTemplate ?? "";

  useEffect(() => {
    return () => {
      window.clearTimeout(guestHighlightTimeoutRef.current);
      window.clearTimeout(copyNoticeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isCommentMenuOpen) return;

    const handlePointerDown = (event) => {
      if (commentMenuRef.current?.contains(event.target)) return;
      setIsCommentMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isCommentMenuOpen]);

  const promptGuestInteraction = () => {
    if (isAuthed) return false;
    guestBarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setInteractionError("");
    setIsGuestBarHighlighted(false);
    window.clearTimeout(guestHighlightTimeoutRef.current);
    window.requestAnimationFrame(() => {
      setIsGuestBarHighlighted(true);
    });
    guestHighlightTimeoutRef.current = window.setTimeout(() => {
      setIsGuestBarHighlighted(false);
    }, 1400);
    return true;
  };

  useEffect(() => {
    if (!active || !token || !billId) return;
    let cancelled = false;
    setInteractionsReady(false);
    (async () => {
      try {
        setInteractionError("");
        const meResp = await authFetch(`${API_BASE}/users/me`);
        if (!meResp.ok) throw new Error("Failed to load user");
        const me = await meResp.json();
        const ownedResp = await authFetch(`${API_BASE}/interactions/bills/${billId}/comments/mine`);
        if (!ownedResp.ok) throw new Error("Failed to load your comments");
        const owned = await ownedResp.json();
        const answers = await Promise.all((card?.members ?? []).map(async target => {
          const params = new URLSearchParams({ memberVoteId: String(target.memberVoteId), repBioguideId: target.bioguideId });
          const resp = await authFetch(`${API_BASE}/interactions/users/${me.id}/bill/${billId}?${params}`);
          if (!resp.ok) throw new Error("Failed to load responses");
          const text = await resp.text();
          return text ? JSON.parse(text) : null;
        }));
        if (cancelled) return;
        setOwnedInteractions(owned);
        setUserId(me.id);
        setUserName(`${me.first_name || ""} ${me.last_name || ""}`.trim());
        setGroupInteractions(answers.filter(Boolean));
        setInteraction(answers.find(answer => answer?.rep_bioguide_id === rep?.bioguideid) ?? null);
        setInteractionsReady(true);
      } catch (err) { if (!cancelled) setInteractionError(err.message); }
    })();
    return () => { cancelled = true; };
  }, [active, token, card, billId, authFetch, rep?.bioguideid]);

  useEffect(() => {
    if (!active || !billId) return;
    let cancelled = false;

    (async () => {
      try {
        if (!cancelled) {
          setPublicCommentsStatus("loading");
          setPublicCommentsError("");
        }
        const comments = await requestPublicComments({
          billId,
          isAuthed,
          authFetch,
          location: detail.delegation,
        });
        if (!cancelled) {
          setPublicComments(comments);
          setPublicCommentsStatus("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setPublicCommentsStatus("error");
          setPublicCommentsError(
            err.message || "Failed to load comments",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, billId, isAuthed, authFetch, detail.delegation]);

  useEffect(() => {
    setOwnedCommentId(commentInteraction?.comment_id ?? null);
    setCommentDraftText(commentDraftsRef.current.get(commentDraftKey) ?? commentInteraction?.comment_draft_text ?? "");
    setCommentModerationStatus(commentInteraction?.comment_moderation_status ?? null);
    setIsCommentPublic(Boolean(commentInteraction?.comment_is_public));
  }, [commentDraftKey, commentInteraction?.comment_id, commentInteraction?.comment_draft_text, commentInteraction?.comment_moderation_status, commentInteraction?.comment_is_public]);

  useEffect(() => {
    if (!hasPostedOwnedComment) {
      setSelectedAction(null);
      setIsCommentMenuOpen(false);
    }
  }, [hasPostedOwnedComment]);

  useEffect(() => {
    if (active && discussionRequested && ["ready", "error"].includes(publicCommentsStatus)) {
      publicDiscussionRef.current?.scrollIntoView({ block: "start" });
      publicDiscussionRef.current?.focus({ preventScroll: true });
    }
  }, [active, discussionRequested, publicCommentsStatus]);

  useEffect(() => {
    contactDraftRequestRef.current += 1;
    setContactDrafts(null);
    setContactDraftStatus("idle");
    setContactDraftError("");
  }, [
    groupStanceKey,
    commentInteraction?.id,
    commentInteraction?.stance,
    commentInteraction?.comment_id,
    commentInteraction?.comment_updated_at,
    commentInteraction?.comment_approved_text,
  ]);

  useEffect(() => {
    if (!commentInteraction?.id) {
      setIsCommentComposerOpen(false);
    }
  }, [commentInteraction?.id]);

  useEffect(() => {
    if (selectedAction === "message") return;
    window.clearTimeout(copyNoticeTimeoutRef.current);
    setMessageCopyStatus("idle");
  }, [selectedAction]);

  const toggleSelectedAction = (nextAction) => {
    const resolvedAction = selectedAction === nextAction ? null : nextAction;
    if (resolvedAction && contactDraftStatus === "error") {
      setContactDraftStatus("idle");
      setContactDraftError("");
    }
    setSelectedAction(resolvedAction);
  };

  const loadContactDrafts = useEffectEvent(async () => {
    if (!active || stancePendingRef.current || !commentInteraction?.id || !hasPostedOwnedComment) return null;
    if (contactDrafts?.members?.length === 2 || (contactDrafts?.callScript && contactDrafts?.messageTemplate)) {
      return contactDrafts;
    }
    if (contactDraftStatus === "loading") return null;

    const requestId = ++contactDraftRequestRef.current;
    try {
      setContactDraftError("");
      setContactDraftStatus("loading");
      const resp = await authFetch(
        `${API_BASE}/interactions/${commentInteraction.id}/comment/contact-drafts${useGroupedContact ? "/group" : ""}`,
        useGroupedContact ? { method: "POST", body: JSON.stringify(sharedContactRequest(card, groupInteractions)) } : undefined,
      );
      if (!resp.ok) {
        const details = await resp.text();
        let message = details;
        try { message = JSON.parse(details).error || details; } catch { /* Plain-text legacy errors. */ }
        throw new Error(message || "Failed to prepare contact drafts");
      }
      const drafts = await resp.json();
      if (useGroupedContact) validateSharedContactDrafts(card, drafts);
      if (requestId !== contactDraftRequestRef.current || stancePendingRef.current) return null;
      setContactDrafts(drafts);
      setContactDraftStatus("ready");
      return drafts;
    } catch (err) {
      if (requestId !== contactDraftRequestRef.current || stancePendingRef.current) return null;
      setContactDraftStatus("error");
      setContactDraftError(err.message || "Failed to prepare contact drafts");
      return null;
    }
  });

  useEffect(() => {
    if (
      !active ||
      isSavingStance ||
      (selectedAction !== "call" && selectedAction !== "message") ||
      !hasPostedOwnedComment ||
      contactDrafts?.callScript ||
      contactDrafts?.messageTemplate ||
      contactDrafts?.members?.length ||
      contactDraftStatus !== "idle"
    ) {
      return;
    }

    void loadContactDrafts();
  }, [
    active,
    selectedAction,
    isSavingStance,
    hasPostedOwnedComment,
    contactDrafts,
    contactDraftStatus,
    commentInteraction?.id,
  ]);

  const handleCopyMessage = async () => {
    if (stancePendingRef.current) return;
    if (!messageTemplate) return;

    try {
      await copyTextToClipboard(messageTemplate);
      setMessageCopyStatus("success");
    } catch {
      setMessageCopyStatus("error");
    }

    window.clearTimeout(copyNoticeTimeoutRef.current);
    copyNoticeTimeoutRef.current = window.setTimeout(() => {
      setMessageCopyStatus("idle");
    }, 1800);
  };

  const mergeCommentIntoInteraction = (currentInteraction, savedComment) =>
    currentInteraction
      ? {
          ...currentInteraction,
          comment_id: savedComment.id ?? null,
          comment_draft_text: savedComment.draft_text ?? "",
          comment_approved_text: savedComment.approved_text ?? null,
          comment_moderation_status: savedComment.moderation_status ?? "draft",
          comment_moderation_reason: savedComment.moderation_reason ?? null,
          comment_moderation_categories:
            savedComment.moderation_categories ?? null,
          comment_is_public: Boolean(savedComment.is_public),
          comment_last_submitted_at: savedComment.last_submitted_at ?? null,
          comment_last_moderated_at: savedComment.last_moderated_at ?? null,
          comment_published_at: savedComment.published_at ?? null,
          comment_updated_at: savedComment.updated_at ?? null,
        }
      : currentInteraction;

  const clearCommentFromInteraction = (currentInteraction) =>
    currentInteraction
      ? {
          ...currentInteraction,
          comment_id: null,
          comment_draft_text: "",
          comment_approved_text: null,
          comment_moderation_status: null,
          comment_moderation_reason: null,
          comment_moderation_categories: null,
          comment_is_public: false,
          comment_last_submitted_at: null,
          comment_last_moderated_at: null,
          comment_published_at: null,
          comment_updated_at: null,
        }
      : currentInteraction;

  const handleSubmitCommentForModeration = async () => {
    if (stancePendingRef.current) return;
    if (!commentInteraction?.id) return;
    if (!commentDraftText.trim()) return;

    try {
      setInteractionError("");
      setIsSubmittingComment(true);
      const resp = await authFetch(
        `${API_BASE}/interactions/${commentInteraction.id}/comment/submit`,
        {
          method: "POST",
          body: JSON.stringify({ draft_text: commentDraftText }),
        },
      );
      if (!resp.ok) throw new Error("Failed to submit comment for moderation");
      const moderatedComment = await resp.json();
      commentDraftsRef.current.delete(commentDraftKey);
      updateCommentInteraction((currentInteraction) =>
        mergeCommentIntoInteraction(currentInteraction, moderatedComment),
      );
      if (moderatedComment?.moderation_status === "approved" && billId) {
        try {
          const comments = await requestPublicComments({
            billId,
            isAuthed,
            authFetch,
            location: detail.delegation,
          });
          setPublicComments(comments);
          setPublicCommentsStatus("ready");
          setPublicCommentsError("");
        } catch (reloadErr) {
          setPublicCommentsStatus("error");
          setPublicCommentsError(
            reloadErr.message || "Failed to load comments",
          );
        }
      }
      if (moderatedComment?.moderation_status === "approved") {
        setIsCommentComposerOpen(false);
      }
    } catch (err) {
      setInteractionError(
        err.message || "Failed to submit comment for moderation",
      );
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleEditApprovedComment = () => {
    if (stancePendingRef.current) return;
    if (!approvedCommentText) return;
    setInteractionError("");
    commentDraftsRef.current.set(commentDraftKey, approvedCommentText);
    setCommentDraftText(approvedCommentText);
    setSelectedAction(null);
    setIsCommentMenuOpen(false);
    setIsCommentComposerOpen(true);
  };

  const handleDeleteComment = async () => {
    if (stancePendingRef.current) return;
    if (!commentInteraction?.id) return;

    try {
      setInteractionError("");
      const resp = await authFetch(`${API_BASE}/interactions/${commentInteraction.id}/comment`, {
        method: "DELETE",
      });
      if (!resp.ok) throw new Error("Failed to delete comment");
      commentDraftsRef.current.delete(commentDraftKey);
      setSelectedAction(null);
      setIsCommentMenuOpen(false);
      setIsCommentComposerOpen(false);
      updateCommentInteraction((currentInteraction) =>
        clearCommentFromInteraction(currentInteraction),
      );
      if (billId) {
        try {
          const comments = await requestPublicComments({
            billId,
            isAuthed,
            authFetch,
            location: detail.delegation,
          });
          setPublicComments(comments);
          setPublicCommentsStatus("ready");
          setPublicCommentsError("");
        } catch (reloadErr) {
          setPublicCommentsStatus("error");
          setPublicCommentsError(
            reloadErr.message || "Failed to load comments",
          );
        }
      }
    } catch (err) {
      setInteractionError(err.message || "Failed to delete comment");
    }
  };

  const handleToggleCommentPublic = async (nextValue) => {
    if (stancePendingRef.current) return;
    if (!ownedCommentId) return;

    try {
      setPublicVisibilityError("");
      setIsSavingCommentPublic(true);
      const resp = await authFetch(`${API_BASE}/comments/${ownedCommentId}/public`, {
        method: "PUT",
        body: JSON.stringify({ is_public: nextValue }),
      });
      if (!resp.ok) {
        const details = await resp.text();
        throw new Error(details || "Failed to update comment visibility");
      }

      const updatedComment = await resp.json();
      updateCommentInteraction((currentInteraction) =>
        mergeCommentIntoInteraction(currentInteraction, updatedComment),
      );

      if (billId) {
        try {
          const comments = await requestPublicComments({
            billId,
            isAuthed,
            authFetch,
            location: detail.delegation,
          });
          setPublicComments(comments);
          setPublicCommentsStatus("ready");
          setPublicCommentsError("");
        } catch (reloadErr) {
          setPublicCommentsStatus("error");
          setPublicCommentsError(
            reloadErr.message || "Failed to load comments",
          );
        }
      }
    } catch (err) {
      setPublicVisibilityError(
        err.message || "Failed to update comment visibility",
      );
    } finally {
      setIsSavingCommentPublic(false);
    }
  };

  const handleToggleUseful = async (commentId) => {
    if (!isAuthed) {
      promptGuestInteraction();
      return;
    }

    try {
      setPublicCommentsError("");
      setUsefulPendingByCommentId((current) => ({
        ...current,
        [commentId]: true,
      }));
      const resp = await authFetch(`${API_BASE}/comments/${commentId}/useful`, {
        method: "PUT",
      });
      if (!resp.ok) {
        const details = await resp.text();
        throw new Error(details || "Failed to update useful reaction");
      }

      const updated = await resp.json();
      setPublicComments((currentComments) =>
        currentComments.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                useful_count: updated.useful_count,
                viewer_has_marked_useful: updated.viewer_has_marked_useful,
              }
            : comment,
        ),
      );
    } catch (err) {
      setPublicCommentsError(err.message || "Failed to update useful reaction");
    } finally {
      setUsefulPendingByCommentId((current) => {
        const next = { ...current };
        delete next[commentId];
        return next;
      });
    }
  };

  const applySavedStances = (savedInteractions) => {
    const saved = savedInteractions.find(answer => answer.rep_bioguide_id === rep?.bioguideid);
    setInteraction(current => ({ ...current, ...saved }));
    setOwnedInteractions(current => current.map(item => {
      const savedAnswer = savedInteractions.find(answer => answer.id === item.id);
      return savedAnswer ? { ...item, ...savedAnswer } : item;
    }));
  };

  const handleStanceClick = async (nextStance) => {
    if (!token) {
      promptGuestInteraction();
      return;
    }
    if (!card || !billId || !interactionsReady) return;
    if (!rep?.bioguideid) {
      setInteractionError(
        "Loading your representative details. Try again in a moment.",
      );
      return;
    }

    if (!memberVoteId || stancePendingRef.current || isSubmittingComment || isSavingCommentPublic) return;
    stancePendingRef.current = true;
    setIsSavingStance(true);
    contactDraftRequestRef.current += 1;
    setContactDrafts(null);
    setContactDraftStatus("idle");
    setContactDraftError("");

    try {
      setInteractionError("");
      if (grouped) {
        const request = buildCardStanceRequest(card, groupInteractions, nextStance);
        const resp = await authFetch(`${API_BASE}/interactions/stances/batch`, {
          method: "PUT", body: JSON.stringify(request),
        });
        if (!resp.ok) throw new Error("Failed to save both Senator responses. Please retry.");
        const result = await resp.json();
        const confirmed = reconcileCardStanceResult(groupInteractions, request, result.interactions);
        setGroupInteractions(confirmed);
        applySavedStances(confirmed);
        return;
      }
        if (isAnsweredVote(interaction, memberVoteId) && interaction.stance === nextStance) {
          const resp = await authFetch(
            `${API_BASE}/interactions/${interaction.id}/stance`,
            { method: "PUT", body: JSON.stringify({ stance: null, member_vote_id: memberVoteId }) },
          );
          if (!resp.ok) throw new Error("Failed to clear stance");
          const cleared = await resp.json();
          applySavedStances([cleared]);
          return;
        }

      const resp = await authFetch(
        interaction
          ? `${API_BASE}/interactions/${interaction.id}/stance`
          : `${API_BASE}/interactions/addstance`,
        {
          method: interaction ? "PUT" : "POST",
          body: JSON.stringify(
            interaction
              ? { stance: nextStance, member_vote_id: memberVoteId }
              : {
                  user_id: userId,
                  bill_id: billId,
                  rep_bioguide_id: rep.bioguideid,
                  member_vote_id: memberVoteId,
                  stance: nextStance,
                },
          ),
        },
      );
      if (!resp.ok) {
        const payload = await resp.json().catch(() => null);
        throw new Error(payload?.error || "Failed to save stance");
      }
      const saved = await resp.json();
      applySavedStances([saved]);
    } catch (err) {
      setInteractionError(err.message || "Failed to save stance");
    } finally {
      stancePendingRef.current = false;
      setIsSavingStance(false);
    }
  };
  if (!active) return null;
  return (
    <>
      <button className="back-link" onClick={() => navigate(-1)}>
        <ArrowLeft size={18}></ArrowLeft> Back to Feed
      </button>
      {!isAuthed && (
        <div
          ref={guestBarRef}
          className={`guest-bar ${
            isGuestBarHighlighted ? "guest-bar-highlighted" : ""
          }`}
        >
          <div className="guest-left">
            <Info className="guest-icon" strokeWidth={1.75}></Info>
            <div>
              <div className="guest-title">Viewing as Guest</div>
              <div className="guest-sub">Your interactions won't be saved.</div>
            </div>
          </div>
          <button className="guest-cta" onClick={() => navigate("/signup")}>
            Sign Up / Sign In
          </button>
        </div>
      )}
      <div className="leg-card">
        <div className="leg-top">
          <div className="leg-meta-row">
            <span className="pill primary">{billLabel}</span>
            {latestVoteDate && (
              <span className="leg-date">
                <Clock3 size={14}></Clock3>
                {formatVotedOn(latestVoteDate)}
              </span>
            )}
          </div>
          <SummarySourceToggle officialHtml={officialHtml} showOriginal={showOriginal} onToggle={() => setShowOriginal(!showOriginal)} />
        </div>
        {status === "loading" && <p>Loading summary</p>}
        {status === "error" && <p className="error-text">{error}</p>}
        {(showOriginal || aiError) && officialHtml && (
          <OfficialSummary html={officialHtml} />
        )}
        {showOriginal && !officialHtml && <p className="leg-body">The official summary is unavailable.</p>}
        {status === "ready" &&
          !showOriginal &&
          !aiError &&
          (aiLoading || !aiSummary) && (
          <div className="leg-body">Creating summary.</div>
        )}
        {status === "ready" &&
          !showOriginal &&
          !aiLoading &&
          !aiError &&
          aiSummary && (
          <div className="leg-body simple-vote-summary">
            {formatQuickSummary(aiSummary)}.
          </div>
        )}
        {aiError && <p className="error-text">{aiError} <button type="button" onClick={onRetrySummary}>Retry simplified summary</button></p>}
        <BillVoteFolders tabs={folders} selected={selectedFolder} onSelect={onFolderChange} disabled={busy} />
        {grouped && ["mixed", "partial"].includes(groupResponse.status) && <p className="bill-response-notice" role="status">Your responses differ or are incomplete. Choosing Agree or Disagree applies to both Senators.</p>}
        {canReadFullBill && (
          <div className="bill-reference-row">
            <a
              className="bill-text-link"
              href={fullBillUrl}
              target="_blank"
              rel="noopener"
            >
              <span className="bill-text-link-copy">
                <FileText size={18}></FileText>
                <span>Read Full Bill Text</span>
              </span>
              <ExternalLink size={16}></ExternalLink>
            </a>
          </div>
        )}
        {card && <div className="vote-actions">
          <button
            type="button"
            className={`ghost-btn ${
              currentStance === "approve" ? "active approve" : ""
            }`}
            onClick={() => handleStanceClick("approve")}
            disabled={isAuthed && (!memberVoteId || !interactionsReady || busy)}
            aria-label={`Agree with ${responseReference}`}
            aria-pressed={currentStance === "approve"}
            title={`Click to record that you agree with how ${responseReference} voted on ${billLabel}.`}
          >
            <ThumbsUp size={16} />
            {currentStance === "approve" && (
              <span>I agree with {responseReference}</span>
            )}
          </button>
          <button
            type="button"
            className={`ghost-btn ${
              currentStance === "disapprove" ? "active disapprove" : ""
            }`}
            onClick={() => handleStanceClick("disapprove")}
            disabled={isAuthed && (!memberVoteId || !interactionsReady || busy)}
            aria-label={`Disagree with ${responseReference}`}
            aria-pressed={currentStance === "disapprove"}
            title={`Click to record that you disagree with how ${responseReference} voted on ${billLabel}.`}
          >
            <ThumbsDown size={16} />
            {currentStance === "disapprove" && (
              <span>I disagree with {responseReference}</span>
            )}
          </button>
          {interaction?.id && !interaction.comment_id && !scopedOwnedInteractions.some(item => item.id === interaction.id) && (
            <button
              type="button"
              className={`ghost-btn ${isCommentComposerOpen ? "active" : ""}`}
              disabled={isSavingStance}
              onClick={() => {
                setSelectedCommentInteractionId(interaction.id);
                setIsCommentComposerOpen(currentValue => !currentValue);
              }}
              aria-label={
                isCommentComposerOpen ? "Hide comment composer" : "Write comment"
              }
              aria-expanded={isCommentComposerOpen}
              aria-controls="bill-comment-composer"
              title="Write comment"
            >
              <MessageSquare size={16}></MessageSquare>
              {isCommentComposerOpen && <span>Comment</span>}
            </button>
          )}
        </div>}

            {(showOwnedCommentThread || scopedOwnedInteractions.length > 0 || showPublicCommentsPanel) && (
          <section id="public-comments" ref={publicDiscussionRef} tabIndex={-1} aria-label="Comments" className="comment-thread">
            <div className="comment-thread-header"><h2 className="comment-thread-title">Comments</h2></div>
            {scopedOwnedInteractions.filter(item => item.id !== commentInteraction?.id).map(item => (
              <article key={item.comment_id} className="comment-card">
                <div className="comment-row">
                  <div className="comment-author-avatar" aria-label="Profile photo"><span className="comment-avatar-initial" aria-hidden="true">{commentAuthorName.charAt(0).toUpperCase()}</span><UserAvatar rounded={true} /></div>
                  <div className="comment-card-body">
                    <div className="comment-author-name">
                      {commentAuthorName}
                      {showCommentRecipients && commentRecipientLabel(item, roster, detail.cards) && <span className="comment-recipient"> to {commentRecipientLabel(item, roster, detail.cards)}</span>}
                    </div>
                    <div className="comment-text">{item.comment_approved_text || item.comment_draft_text}</div>
                    <button type="button" className="ghost-btn comment-edit-btn" disabled={busy} onClick={() => {
                      setSelectedCommentInteractionId(item.id);
                      setIsCommentComposerOpen(true);
                      setSelectedAction(null);
                    }}>Edit comment</button>
                  </div>
                </div>
              </article>
            ))}
            {showOwnedCommentThread && (
              <fieldset className="owned-comment-thread" aria-label="Your comment and contact actions" disabled={isSavingStance}>

            {!hasPostedOwnedComment && !isCommentComposerOpen && (
              <button type="button" className="ghost-btn" onClick={() => setIsCommentComposerOpen(true)}>
                Continue editing your comment
              </button>
            )}

            {isCommentComposerOpen && (
              <div className="comment-composer-shell">
                <div
                  className="comment-author-avatar comment-composer-avatar"
                  aria-label="Profile photo"
                >
                  <span className="comment-avatar-initial" aria-hidden="true">{commentAuthorName.charAt(0).toUpperCase()}</span>
                    <UserAvatar rounded={true}></UserAvatar>
                </div>
                <section id="bill-comment-composer" className="comment-box">
                  <textarea
                    value={commentDraftText}
                    onChange={(event) => {
                      commentDraftsRef.current.set(commentDraftKey, event.target.value);
                      setCommentDraftText(event.target.value);
                    }}
                    placeholder="Write your comment here..."
                    aria-label="Comment draft"
                  ></textarea>
                  <div className="comment-actions">
                    <button type="button" className="ghost-btn" disabled={isSubmittingComment}
                      onClick={() => setIsCommentComposerOpen(false)}>
                      Cancel edit
                    </button>
                    <button
                      type="button"
                      className="primary-btn comment-submit-btn"
                      onClick={handleSubmitCommentForModeration}
                      disabled={
                        isSubmittingComment ||
                        !commentDraftText.trim()
                      }
                      aria-label="Submit comment"
                      title="Submit comment"
                    >
                      <Send size={16}></Send>
                      <span>{isSubmittingComment ? "Submitting..." : "Submit"}</span>
                    </button>
                  </div>
                  {commentModerationStatus === "blocked" &&
                    commentInteraction?.comment_moderation_reason && (
                      <p className="error-text comment-error-text">
                        {commentInteraction.comment_moderation_reason}
                      </p>
                    )}
                </section>
              </div>
            )}

            {showPostedOwnedComment && (
              <section className="comment-card">
                <div className="comment-row">
                  <div className="comment-author-avatar" aria-label="Profile photo">
                    <span className="comment-avatar-initial" aria-hidden="true">{commentAuthorName.charAt(0).toUpperCase()}</span>
                    <UserAvatar rounded={true}></UserAvatar>
                  </div>
                  <div className="comment-card-body">
                    <div className="comment-ahead">
                      <div className="comment-card-meta">
                        <div className="comment-author-name">
                          {commentAuthorName}
                          {showCommentRecipients && commentRecipientLabel(commentInteraction, roster, detail.cards) && <span className="comment-recipient"> to {commentRecipientLabel(commentInteraction, roster, detail.cards)}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="comment-text">{approvedCommentText}</div>
                      <div
                        ref={commentMenuRef}
                        className="comment-owner-actions"
                      >
                        <button
                          type="button"
                          className={`ghost-btn comment-owner-icon-btn ${selectedAction === "call" ? "active" : ""}`}
                          onClick={() => toggleSelectedAction("call")}
                          aria-label={
                            selectedAction === "call"
                              ? "Hide call script"
                              : "Show call script"
                          }
                          aria-expanded={selectedAction === "call"}
                          aria-pressed={selectedAction === "call"}
                          aria-controls="bill-call-script-panel"
                          title="Call script"
                        >
                          <Phone size={15}></Phone>
                        </button>
                        <button
                          type="button"
                          className={`ghost-btn comment-owner-icon-btn ${selectedAction === "message" ? "active" : ""}`}
                          onClick={() => toggleSelectedAction("message")}
                          aria-label={
                            selectedAction === "message"
                              ? "Hide message template"
                              : "Show message template"
                          }
                          aria-expanded={selectedAction === "message"}
                          aria-pressed={selectedAction === "message"}
                          aria-controls="bill-message-template-panel"
                          title="Message template"
                        >
                          <Mail size={15}></Mail>
                        </button>
                        <button
                          type="button"
                          className={`ghost-btn comment-owner-icon-btn ${
                            isCommentPublic ? "active" : ""
                          }`}
                          onClick={() =>
                            handleToggleCommentPublic(!isCommentPublic)
                          }
                          disabled={isSavingCommentPublic}
                          aria-label={
                            isCommentPublic
                              ? "Public to other VoteFeed users"
                              : "Make public to other VoteFeed users"
                          }
                          aria-pressed={isCommentPublic}
                          title={
                            isCommentPublic
                              ? "Public to other VoteFeed users"
                              : "Make public to other VoteFeed users"
                          }
                        >
                          <Eye size={15}></Eye>
                        </button>
                        <button
                          type="button"
                          className={`ghost-btn comment-owner-icon-btn ${
                            isCommentMenuOpen ? "active" : ""
                          }`}
                          onClick={() =>
                            setIsCommentMenuOpen((currentValue) => !currentValue)
                          }
                          aria-label={
                            isCommentMenuOpen
                              ? "Hide comment actions"
                              : "Show comment actions"
                          }
                          aria-expanded={isCommentMenuOpen}
                          aria-haspopup="menu"
                          title="Comment actions"
                        >
                          <MoreHorizontal size={16}></MoreHorizontal><span>More</span>
                        </button>
                        {isCommentMenuOpen && (
                          <div className="comment-owner-menu" role="menu">
                            <button
                              type="button"
                              className="comment-owner-menu-item"
                              onClick={handleEditApprovedComment}
                              role="menuitem"
                            >
                              <Pencil size={16}></Pencil>
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              className="comment-owner-menu-item comment-owner-menu-item-danger"
                              onClick={handleDeleteComment}
                              role="menuitem"
                            >
                              <Trash2 size={16}></Trash2>
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </div>

                    {publicVisibilityError && (
                      <p className="error-text comment-error-text">
                        {publicVisibilityError}
                      </p>
                    )}
                    {useGroupedContact && !isSavingStance && ["call", "message"].includes(selectedAction) && (
                      <GroupContactGuides action={selectedAction} status={contactDraftStatus} error={contactDraftError}
                        drafts={contactDrafts} onRetry={() => { setContactDraftStatus("idle"); setContactDraftError(""); }}
                        members={card.members.map(target => {
                          const person = roster.find(item => item.bioguideid === target.bioguideId);
                          return { id: target.bioguideId, name: getRepLastName(target.name),
                            phone: person?.office_phone, dialHref: getDialHref(person?.office_phone),
                            contactUrl: buildRepContactUrl(person?.official_website_url) };
                        })} />
                    )}
                    {!useGroupedContact && !isSavingStance && selectedAction === "call" && (
                      <section
                        id="bill-call-script-panel"
                        className="action-guide-card comment-action-panel"
                      >
                        {commentRepDialHref ? (
                          <a className="action-guide-inline-link" href={commentRepDialHref}>
                            <Phone size={16}></Phone>
                            Call {commentRepReference} at {commentRep?.office_phone}
                          </a>
                        ) : (
                          <span className="action-guide-inline-missing">
                            <Phone size={16}></Phone>
                            Call info unavailable for {commentRepReference}
                          </span>
                        )}
                        {contactDraftStatus === "loading" && (
                          <p className="comment-action-status">
                            Preparing your call script...
                          </p>
                        )}
                        {contactDraftStatus === "error" && contactDraftError && (
                          <p className="error-text comment-error-text">
                            {contactDraftError}
                          </p>
                        )}
                        {contactDraftStatus === "ready" && callScript && (
                          <pre className="action-guide-template">{callScript}</pre>
                        )}
                      </section>
                    )}
                    {!useGroupedContact && !isSavingStance && selectedAction === "message" && (
                      <section
                        id="bill-message-template-panel"
                        className="action-guide-card comment-action-panel"
                      >
                        {commentRepContactUrl ? (
                          <a
                            className="action-guide-inline-link"
                            href={commentRepContactUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Mail size={16}></Mail>
                            Message {commentRepReference}
                            <ExternalLink size={16}></ExternalLink>
                          </a>
                        ) : (
                          <span className="action-guide-inline-missing">
                            <Mail size={16}></Mail>
                            Contact page unavailable for {commentRepReference}
                          </span>
                        )}
                        {contactDraftStatus === "loading" && (
                          <p className="comment-action-status">
                            Preparing your message draft...
                          </p>
                        )}
                        {contactDraftStatus === "error" && contactDraftError && (
                          <p className="error-text comment-error-text">
                            {contactDraftError}
                          </p>
                        )}
                        {contactDraftStatus === "ready" && messageTemplate && (
                          <div className="action-guide-template-wrap">
                            <div className="action-guide-template-tools">
                              <button
                                type="button"
                                className="template-copy-btn"
                                onClick={handleCopyMessage}
                                aria-label="Copy message template"
                                title="Copy message template"
                              >
                                <Copy size={14}></Copy>
                              </button>
                              <span
                                className={`template-copy-status ${
                                  messageCopyStatus === "success"
                                    ? "success"
                                    : messageCopyStatus === "error"
                                      ? "error"
                                      : ""
                                }`}
                                role="status"
                                aria-live="polite"
                              >
                                {messageCopyStatus === "success"
                                  ? "Copied to clipboard."
                                  : messageCopyStatus === "error"
                                    ? "Copy failed. Try again."
                                    : ""}
                              </span>
                            </div>
                            <pre className="action-guide-template action-guide-template-copyable">
                              {messageTemplate}
                            </pre>
                          </div>
                        )}
                      </section>
                    )}
                  </div>
                </div>
              </section>
            )}
          </fieldset>
        )}
        {showPublicCommentsPanel && (
          <div
            className="public-comments-panel"
            aria-busy={publicCommentsStatus === "loading"}
          >
            <div className="comment-thread-header">
              {discussionComments.length > 0 && (
                <button
                  type="button"
                  className={`ghost-btn public-comments-toggle ${
                    isPublicCommentsOpen ? "active" : ""
                  }`}
                  onClick={() =>
                    setIsPublicCommentsOpen((currentValue) => !currentValue)
                  }
                  aria-expanded={isPublicCommentsOpen}
                  aria-controls="public-comments-list"
                >
                  {publicCommentsToggleLabel}
                </button>
              )}
            </div>
            {publicCommentsStatus === "loading" && <p role="status">Loading comments…</p>}
            {publicCommentsStatus === "ready" && discussionComments.length === 0 && scopedOwnedInteractions.length === 0 && !showOwnedCommentThread && <p>No comments yet.</p>}
            {isPublicCommentsOpen && discussionComments.length > 0 && (
              <div id="public-comments-list" className="public-comments-list">
                {discussionComments.map((comment) => {
                  const isUsefulPending = Boolean(
                    usefulPendingByCommentId[comment.id],
                  );
                  const publishedLabel = formatCommentTimestamp(
                    comment.published_at,
                  );

                  return (
                    <article key={comment.id} className="public-comment-item" data-initial={comment.author_display_name?.charAt(0).toUpperCase() || "C"}>
                      <div className="public-comment-top">
                        <div className="public-comment-meta">
                          <div className="public-comment-author">
                            {comment.author_display_name}
                            {showCommentRecipients && commentRecipientLabel(comment, roster) && <span className="comment-recipient"> to {commentRecipientLabel(comment, roster)}</span>}
                          </div>
                          {publishedLabel && (
                            <span className="public-comment-time">
                              {publishedLabel}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className={`ghost-btn public-useful-btn ${
                            comment.viewer_has_marked_useful ? "active" : ""
                          }`}
                          onClick={() => handleToggleUseful(comment.id)}
                          disabled={isUsefulPending}
                          aria-pressed={comment.viewer_has_marked_useful}
                          aria-label={
                            comment.viewer_has_marked_useful
                              ? "Remove useful mark from comment"
                              : "Mark comment as useful"
                          }
                          title={
                            comment.viewer_has_marked_useful
                              ? "Remove useful mark"
                              : "Mark comment as useful"
                          }
                        >
                          <ThumbsUp size={14}></ThumbsUp>
                          <span>Useful</span>
                          <span className="public-useful-count">
                            {comment.useful_count}
                          </span>
                        </button>
                      </div>
                      <div className="public-comment-text">{comment.text}</div>
                    </article>
                  );
                })}
              </div>
            )}
            {publicCommentsError && (
              <p className="error-text comment-error-text">
                {publicCommentsError}
              </p>
            )}
          </div>
        )}
          </section>
        )}
        {interactionError && <p className="error-text">{interactionError}</p>}
      </div>
    </>
  );
}
