import { createContext, useContext, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "convex/react";
import { UserButton } from "@clerk/clerk-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type HomeProperty = {
  propertyId: Id<"properties">;
  address: string;
  status: string;
  hoaId: Id<"hoas"> | null;
  hoaName: string;
};

type HomeContextValue = {
  properties: HomeProperty[];
  selected: HomeProperty | null;
  selectPropertyId: (id: Id<"properties">) => void;
};

const HomeContext = createContext<HomeContextValue | null>(null);

/** Selected property for the homeowner area (defaults to the first owned property). */
export function useHomeProperty(): HomeContextValue {
  const ctx = useContext(HomeContext);
  if (!ctx) throw new Error("useHomeProperty must be used within HomeLayout");
  return ctx;
}

const NAV = [
  { to: "/home", label: "Home", icon: "🏠", end: true },
  { to: "/home/inspection", label: "Inspection", icon: "📋", end: false },
  { to: "/home/rules", label: "Rules", icon: "📖", end: false },
  { to: "/home/chat", label: "Ask AI", icon: "💬", end: false },
  { to: "/home/request", label: "Request", icon: "🛠️", end: false },
];

export default function HomeLayout() {
  const properties = useQuery(api.homeowners.myProperties, {}) as
    | HomeProperty[]
    | undefined;
  const [selectedId, setSelectedId] = useState<Id<"properties"> | null>(null);
  const location = useLocation();

  const selected = useMemo(() => {
    if (!properties || properties.length === 0) return null;
    return properties.find((p) => p.propertyId === selectedId) ?? properties[0];
  }, [properties, selectedId]);

  const ctxValue = useMemo<HomeContextValue>(
    () => ({
      properties: properties ?? [],
      selected,
      selectPropertyId: setSelectedId,
    }),
    [properties, selected],
  );

  if (properties === undefined) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }

  return (
    <HomeContext.Provider value={ctxValue}>
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">{selected?.hoaName || "Your HOA"}</p>
            {properties.length > 1 ? (
              <select
                aria-label="Choose property"
                className="mt-0.5 max-w-full truncate text-sm font-semibold text-slate-900 bg-transparent"
                value={selected?.propertyId ?? ""}
                onChange={(e) => setSelectedId(e.target.value as Id<"properties">)}
              >
                {properties.map((p) => (
                  <option key={p.propertyId} value={p.propertyId}>
                    {p.address}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">
                {selected?.address}
              </p>
            )}
          </div>
          <UserButton afterSignOutUrl="/" />
        </header>

        <main
          className="flex-1 px-4 py-4"
          style={{ paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
          key={location.pathname}
        >
          <Outlet />
        </main>

        <nav
          className="fixed bottom-0 inset-x-0 z-10 bg-white border-t border-slate-200 flex"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
                  isActive ? "text-blue-600" : "text-slate-500"
                }`
              }
            >
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </HomeContext.Provider>
  );
}
