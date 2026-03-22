import { useState } from "react";
import { trackEvent } from "@/utils/track";

const shareText =
  import.meta.env.VITE_SHARE_TEXT ?? "Check out this One Shot demo.";

export function ShareButtons() {
  const [copied, setCopied] = useState(false);

  const url =
    typeof window !== "undefined" ? encodeURIComponent(window.location.href) : "";
  const text = encodeURIComponent(shareText);

  const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${url}`;
  const twitterUrl = `https://twitter.com/intent/tweet?url=${url}&text=${text}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        typeof window !== "undefined" ? window.location.href : ""
      );
      setCopied(true);
      trackEvent("share_copy_link", {});
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleLinkedIn = () => {
    trackEvent("share_linkedin", {});
    window.open(linkedInUrl, "_blank", "noopener,noreferrer");
  };

  const handleTwitter = () => {
    trackEvent("share_twitter", {});
    window.open(twitterUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="mt-12 p-6 rounded-2xl border-2 border-gray-100 bg-white/80 backdrop-blur">
      <h2 className="text-lg font-semibold mb-3">Share with friends</h2>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleCopyLink}
          className="px-4 py-2 rounded-xl text-sm font-medium border-2 border-gray-200 hover:border-[var(--accent-sky)] hover:bg-gray-50 transition-colors"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={handleLinkedIn}
          className="px-4 py-2 rounded-xl text-sm font-medium border-2 border-gray-200 hover:border-[#0a66c2] hover:bg-gray-50 transition-colors"
        >
          LinkedIn
        </button>
        <button
          type="button"
          onClick={handleTwitter}
          className="px-4 py-2 rounded-xl text-sm font-medium border-2 border-gray-200 hover:border-[#1d9bf0] hover:bg-gray-50 transition-colors"
        >
          Twitter / X
        </button>
      </div>
    </section>
  );
}
