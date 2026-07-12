import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import PlatformGuard from "@/components/PlatformGuard";

export default function PlatformCompanies() {
  return (
    <PlatformGuard>
      <PlatformCompaniesContent />
    </PlatformGuard>
  );
}

function PlatformCompaniesContent() {
  const companies = useQuery(api.companyAdmin.listCompanies, {});
  const createCompany = useMutation(api.companyAdmin.createCompany);
  const addMember = useMutation(api.companyAdmin.addCompanyMember);

  const [name, setName] = useState("");
  const [memberCompanyId, setMemberCompanyId] = useState<Id<"managementCompanies"> | null>(null);
  const [memberClerkId, setMemberClerkId] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState<"owner" | "manager">("manager");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createCompany({ name: name.trim() });
      setName("");
      flash("Company created.");
    } catch (err) {
      flash(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberCompanyId || !memberClerkId.trim()) return;
    setSaving(true);
    try {
      const result = await addMember({
        companyId: memberCompanyId,
        clerkUserId: memberClerkId.trim(),
        role: memberRole,
        email: memberEmail.trim() || undefined,
        fullName: memberName.trim() || undefined,
      });
      flash(result.moved ? "Member moved to this company." : "Member added.");
      setMemberClerkId("");
      setMemberEmail("");
      setMemberName("");
    } catch (err) {
      flash(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f4ff]">
      <div className="gradient-hero px-4 pt-8 pb-6">
        <div className="max-w-4xl mx-auto">
          <Link to="/platform/hoas" className="text-sm text-sky-100 hover:text-white">
            ← All neighborhoods
          </Link>
          <h1 className="text-2xl font-extrabold text-white mt-2">Management Companies</h1>
          <p className="text-sky-100 text-sm mt-1">
            Firms that operate a portfolio of neighborhoods. Assign neighborhoods to a company from
            each neighborhood's detail page.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {toast && (
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
            {toast}
          </div>
        )}

        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">Create company</h2>
          <form className="mt-4 flex flex-wrap gap-3" onSubmit={handleCreate}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Company name"
              required
              className="flex-1 min-w-56 rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Create"}
            </button>
          </form>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">Add staff member</h2>
          <p className="text-sm text-gray-500 mt-1">
            Attach an existing Clerk user as company staff (they sign in and land at /portfolio).
          </p>
          <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={handleAddMember}>
            <select
              value={memberCompanyId ?? ""}
              onChange={(e) =>
                setMemberCompanyId((e.target.value || null) as Id<"managementCompanies"> | null)
              }
              required
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">Choose company…</option>
              {(companies ?? []).map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              value={memberClerkId}
              onChange={(e) => setMemberClerkId(e.target.value)}
              placeholder="Clerk user id (user_…)"
              required
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              placeholder="Full name (optional)"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              placeholder="Email (optional)"
              type="email"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <select
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value as "owner" | "manager")}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Add member"}
            </button>
          </form>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">Companies</h2>
          <ul className="mt-3 space-y-4">
            {(companies ?? []).map((c) => (
              <li key={c._id} className="border-b border-gray-50 pb-3 last:border-0">
                <p className="font-semibold text-gray-800">
                  {c.name} <span className="text-xs font-normal text-gray-400">({c.slug})</span>
                </p>
                <p className="text-xs text-gray-500">
                  {c.hoaCount} neighborhoods · {c.memberCount} staff
                </p>
                {c.hoas.length > 0 && (
                  <p className="mt-1 text-xs text-gray-600">
                    Portfolio: {c.hoas.map((h) => h.name).join(", ")}
                  </p>
                )}
                {c.members.length > 0 && (
                  <p className="mt-0.5 text-xs text-gray-600">
                    Staff:{" "}
                    {c.members
                      .map((m) => `${m.fullName || m.email || m.clerkUserId} (${m.role})`)
                      .join(", ")}
                  </p>
                )}
              </li>
            ))}
            {companies !== undefined && companies.length === 0 && (
              <li className="text-sm text-gray-400">No companies yet — create one above.</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
