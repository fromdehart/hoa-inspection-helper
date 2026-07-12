import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { api } from "../../../convex/_generated/api";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

type ActiveNav = "properties" | "walkthrough" | "cases" | "settings";

const NAV: Array<{ key: ActiveNav; label: string; to: string; requiresCases?: boolean }> = [
  { key: "properties", label: "Properties", to: "/admin/properties" },
  { key: "walkthrough", label: "Walkthrough", to: "/admin/walkthrough" },
  { key: "cases", label: "Cases", to: "/admin/cases", requiresCases: true },
  { key: "settings", label: "Settings", to: "/admin/settings" },
];

/**
 * Shared admin chrome: white topbar on paper ground with the four-item nav,
 * quick-find palette, and avatar menu. Every admin page renders inside this.
 */
export default function AdminShell({
  active,
  children,
}: {
  active: ActiveNav;
  children: React.ReactNode;
}) {
  const viewer = useQuery(api.tenancy.viewerContext);
  const { user } = useUser();
  const { signOut } = useClerk();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const casesEnabled = viewer?.features?.includes("cases") ?? false;

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // Query only while the palette is open so the shell adds no per-page cost.
  const searchProperties = useQuery(api.properties.list, searchOpen ? {} : "skip");
  const searchCases = useQuery(
    api.cases.listForHoa,
    searchOpen && casesEnabled ? {} : "skip",
  );

  const initials = (() => {
    const name = user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "";
    const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
    return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase() || "·";
  })();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header
        className="sticky top-0 z-20 border-b bg-white"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4">
          <span className="inline-flex items-center gap-2 text-sm font-bold">
            <span className="h-4 w-4 rounded bg-petrol" />
            Happier Block
          </span>
          {viewer?.hoaName && (
            <span className="hidden rounded-md bg-petrol-soft px-2.5 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-petrol sm:inline">
              Admin · {viewer.hoaName}
            </span>
          )}
          <nav className="flex gap-0.5">
            {NAV.filter((n) => !n.requiresCases || casesEnabled).map((n) => (
              <NavLink
                key={n.key}
                to={n.to}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-ink-2 hover:text-ink",
                  active === n.key && "bg-secondary text-ink",
                )}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="ml-auto hidden min-w-[220px] items-center gap-2 rounded-lg border bg-paper px-3 py-1.5 text-[13px] text-ink-2 md:inline-flex"
          >
            ⌕ Search address, owner, case…
          </button>
          <div className="relative ml-auto md:ml-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-petrol text-[11px] font-bold text-white"
              aria-label="Account menu"
            >
              {initials}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 z-30 w-44 rounded-lg border bg-white py-1 shadow-medium">
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-secondary"
                  onClick={() => navigate("/inspector/streets")}
                >
                  Field mode
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-secondary"
                  onClick={() => navigate("/admin/settings")}
                >
                  Settings
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-destructive hover:bg-secondary"
                  onClick={() => void signOut({ redirectUrl: "/" })}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-5">{children}</main>

      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder="Search address, owner, case…" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          {searchProperties && searchProperties.length > 0 && (
            <CommandGroup heading="Properties">
              {searchProperties.map((p) => (
                <CommandItem
                  key={p._id}
                  value={`${p.address} ${p.homeownerNames ?? ""}`}
                  onSelect={() => {
                    setSearchOpen(false);
                    navigate(`/admin/property/${p._id}`);
                  }}
                >
                  <span className="font-medium">{p.address}</span>
                  {p.homeownerNames && (
                    <span className="ml-2 text-xs text-ink-2">{p.homeownerNames}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {searchCases && searchCases.length > 0 && (
            <CommandGroup heading="Cases">
              {searchCases.map((c) => (
                <CommandItem
                  key={c._id}
                  value={`${c.title} ${c.address}`}
                  onSelect={() => {
                    setSearchOpen(false);
                    navigate(`/admin/property/${c.propertyId}/case/${c._id}`);
                  }}
                >
                  <span className="font-medium">{c.title}</span>
                  <span className="ml-2 text-xs text-ink-2">{c.address}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </div>
  );
}
