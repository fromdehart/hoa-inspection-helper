import { useEffect, useRef } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

function clerkDisplayName(user: NonNullable<ReturnType<typeof useUser>["user"]>): string | null {
  const full = user.fullName?.trim();
  if (full) return full;
  const first = user.firstName?.trim();
  const last = user.lastName?.trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  if (combined) return combined;
  return null;
}

/**
 * Convex `userHoaMemberships.fullName` is optional on invite/import; attribution reads from that row.
 * Sync Clerk profile into membership so "Added by …" shows real names after sign-in.
 */
export function MembershipDisplayNameSync() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const sync = useMutation(api.members.syncMyMembershipDisplayName);
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;

    const name = clerkDisplayName(user);
    if (!name || lastSent.current === name) return;

    lastSent.current = name;
    void sync({ fullName: name }).catch(() => {
      lastSent.current = null;
    });
  }, [isLoaded, isSignedIn, user, sync]);

  return null;
}
