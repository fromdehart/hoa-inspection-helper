import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { getSessionId } from "@/utils/track";
import confetti from "canvas-confetti";

const GOAL = 250;

export function VoteATron3000() {
  const challengeId = (import.meta.env.VITE_CHALLENGE_ID as string) ?? "";
  const sessionId = getSessionId();
  const votes = useQuery(api.votes.getVotes, challengeId ? { challengeId } : "skip");
  const castVote = useMutation(api.votes.castVote);

  const [alreadyVoted, setAlreadyVoted] = useState(false);
  const [pending, setPending] = useState(false);
  const [boopWiggle, setBoopWiggle] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const celebrationShown = useRef(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [popoverOpen]);

  const count = votes?.count ?? 0;
  const reachedGoal = count >= GOAL;
  const progressPercent = Math.min(100, (count / GOAL) * 100);

  useEffect(() => {
    if (count < GOAL) return;
    const storageKey = `voteCelebrationShown-${challengeId}`;
    if (celebrationShown.current || (typeof sessionStorage !== "undefined" && sessionStorage.getItem(storageKey))) return;
    celebrationShown.current = true;
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(storageKey, "1");
    setShowCelebration(true);
    confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
    const t = setTimeout(() => setShowCelebration(false), 5000);
    return () => clearTimeout(t);
  }, [count, challengeId]);

  const handleVote = async () => {
    if (!challengeId || alreadyVoted || pending) return;
    setPending(true);
    try {
      const result = await castVote({ challengeId, sessionId });
      if (result.alreadyVoted) {
        setAlreadyVoted(true);
      }
    } finally {
      setPending(false);
    }
  };

  const handleClick = () => {
    setBoopWiggle(true);
    setTimeout(() => setBoopWiggle(false), 300);
    handleVote();
  };

  if (!challengeId) return null;

  return (
    <>
      <footer
        className="fixed bottom-0 left-0 right-0 z-50 border-t-4 border-black px-3 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] sm:px-4"
        style={{
          fontFamily: "system-ui, sans-serif",
          backgroundColor: "var(--accent-sky)",
        }}
        aria-label="Vote-a-Tron 3000"
      >
        <div className="mx-auto max-w-4xl">
          {/* Mobile: stacked layout. Desktop: single row */}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-between">
            {/* Row 1 (mobile): Title + ?. Row 1 (desktop): Title + count. Row 2: Count + progress, then ? (desktop only). Single popover for both. */}
            <div
              className="relative flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 sm:flex-initial sm:min-w-0"
              ref={popoverRef}
            >
              {/* Mobile: title + ? next to each other */}
              <div className="flex min-w-0 flex-shrink-0 items-center gap-2 sm:hidden">
                <span className="truncate text-lg font-black text-black">
                  Vote-a-Tron 3000
                </span>
                <button
                  type="button"
                  onClick={() => setPopoverOpen((o) => !o)}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-black bg-white text-sm font-bold text-black hover:bg-black hover:text-white focus:outline-none active:scale-95"
                  aria-label="Learn more"
                  aria-expanded={popoverOpen}
                >
                  ?
                </button>
              </div>
              {/* Desktop: title + count */}
              <div className="hidden min-w-0 flex-shrink-0 items-baseline gap-2 sm:flex sm:gap-3">
                <span className="truncate text-lg font-black text-black sm:text-2xl md:text-3xl">
                  Vote-a-Tron 3000
                </span>
                <span
                  className="flex-shrink-0 text-lg font-black text-black sm:text-2xl md:text-3xl"
                  aria-live="polite"
                >
                  {count.toLocaleString()} / {GOAL.toLocaleString()}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-auto sm:flex-initial">
                <span
                  className="flex-shrink-0 text-base font-black text-black sm:hidden"
                  aria-live="polite"
                >
                  {count.toLocaleString()} / {GOAL.toLocaleString()}
                </span>
                <div className="min-w-0 flex-1 overflow-hidden rounded-full border-2 border-black bg-white sm:h-6 sm:w-40 sm:flex-initial md:w-48">
                  <div
                    className="h-5 w-full rounded-full transition-all duration-300 sm:h-full"
                    style={{
                      width: `${progressPercent}%`,
                      backgroundColor: "var(--accent-lime)",
                    }}
                  />
                </div>
                {/* Desktop only: ? next to progress bar */}
                <div className="relative hidden h-6 w-6 shrink-0 items-center sm:flex">
                  <button
                    type="button"
                    onClick={() => setPopoverOpen((o) => !o)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-black bg-white text-sm font-bold text-black hover:bg-black hover:text-white focus:outline-none active:scale-95"
                    aria-label="Learn more"
                    aria-expanded={popoverOpen}
                  >
                    ?
                  </button>
                </div>
              </div>
              {popoverOpen && (
                <div
                  className="absolute bottom-full left-0 z-10 mb-2 w-[calc(100vw-2rem)] max-w-[20rem] rounded-xl border-2 border-black bg-white p-3 shadow-[4px_4px_0_0_#000] sm:left-1/2 sm:-translate-x-1/2"
                  role="dialog"
                  aria-label="Vote-a-Tron info"
                >
                  <p className="break-words text-sm font-medium text-black">
                    This project was developed with one attempt by an AI coding agent, give a Boop if you like this and want to see it really come to life! If you're the 1,000th booper, you'll get a special surprise!
                  </p>
                </div>
              )}
            </div>
            {/* Row 2 (mobile) / inline (desktop): Boop button — shrink-0 so it never wraps to next line */}
            <div className="flex shrink-0 basis-auto items-center sm:gap-2">
              {alreadyVoted ? (
                <span className="w-full rounded-xl border-2 border-black bg-white px-4 py-3 text-center text-lg font-bold text-gray-700 shadow-[3px_3px_0_0_#000] sm:w-auto sm:py-2 sm:text-xl">
                  Already booped!
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleClick}
                  disabled={pending}
                  className={`w-full min-h-[44px] rounded-xl border-4 border-black px-6 py-3 text-lg font-black shadow-[4px_4px_0_0_#000] transition-all disabled:opacity-60 active:scale-[0.98] sm:w-auto sm:min-h-0 sm:py-3 sm:text-xl md:text-2xl ${
                    boopWiggle ? "animate-boop" : ""
                  }`}
                  style={{
                    backgroundColor: reachedGoal ? "var(--accent-lime, #b4f000)" : "var(--accent-coral, #ff5a5f)",
                    color: "black",
                  }}
                >
                  {pending ? "…" : reachedGoal ? "🎉 Keep Booping!" : "Boop!"}
                </button>
              )}
            </div>
          </div>
        </div>
      </footer>

      {showCelebration && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="alert"
          aria-live="assertive"
        >
          <div
            className="animate-bounce-in mx-4 max-w-[calc(100vw-2rem)] rounded-3xl border-4 border-black px-6 py-8 text-center shadow-2xl sm:mx-0 sm:px-8 sm:py-10"
            style={{ backgroundColor: "var(--accent-coral)" }}
          >
            <p className="text-2xl font-black text-black sm:text-4xl md:text-5xl">We hit 1,000 votes!</p>
            <p className="mt-2 text-xl font-bold text-black sm:text-2xl">🎉 Thank you! 🎉</p>
            <button
              type="button"
              onClick={() => setShowCelebration(false)}
              className="mt-6 min-h-[44px] rounded-xl border-2 border-black bg-white px-6 py-3 text-base font-bold text-black sm:min-h-0 sm:py-2 sm:text-lg"
            >
              OK
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes boop {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        .animate-boop { animation: boop 0.3s ease; }
        @keyframes bounce-in {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); opacity: 1; }
        }
        .animate-bounce-in { animation: bounce-in 0.5s ease; }
      `}</style>
    </>
  );
}
