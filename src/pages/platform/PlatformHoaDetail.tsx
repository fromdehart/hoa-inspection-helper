import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import PlatformGuard from "@/components/PlatformGuard";

export default function PlatformHoaDetail() {
  return (
    <PlatformGuard>
      <PlatformHoaDetailContent />
    </PlatformGuard>
  );
}

function PlatformHoaDetailContent() {
  const { hoaId } = useParams<{ hoaId: string }>();
  const navigate = useNavigate();
  const hoa = useQuery(
    api.platform.getHoa,
    hoaId ? { hoaId: hoaId as Id<"hoas"> } : "skip",
  );
  const assignHoaAdmin = useAction(api.platformNode.assignHoaAdmin);
  const setActingHoa = useMutation(api.platform.setActingHoa);
  const setHoaStatus = useMutation(api.platform.setHoaStatus);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4000);
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hoaId || !email.trim()) {
      flash("Email is required.");
      return;
    }
    setSaving(true);
    try {
      await assignHoaAdmin({
        hoaId: hoaId as Id<"hoas">,
        email: email.trim(),
        fullName: fullName.trim() || undefined,
      });
      flash("Admin assigned.");
      setEmail("");
      setFullName("");
    } catch (err) {
      flash(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleEnter = async () => {
    if (!hoaId) return;
    setSaving(true);
    try {
      await setActingHoa({ hoaId: hoaId as Id<"hoas"> });
      navigate("/admin/dashboard");
    } catch (err) {
      flash(String(err));
      setSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!hoa || !hoaId) return;
    const next = hoa.status === "active" ? "inactive" : "active";
    try {
      await setHoaStatus({ hoaId: hoaId as Id<"hoas">, status: next });
      flash(`Status set to ${next}.`);
    } catch (err) {
      flash(String(err));
    }
  };

  const admins = (hoa?.members ?? []).filter((m) => m.role === "admin");

  return (
      <div className="min-h-screen bg-[#f0f4ff]">
        <div className="gradient-hero px-4 pt-8 pb-6">
          <div className="max-w-4xl mx-auto">
            <Link to="/platform/hoas" className="text-sm text-sky-100 hover:text-white">
              ← All neighborhoods
            </Link>
            <h1 className="text-2xl font-extrabold text-white mt-2">{hoa?.name ?? "Loading..."}</h1>
            {hoa && (
              <p className="text-sky-100 text-sm mt-1">
                {hoa.slug} · <span className="capitalize">{hoa.status}</span>
              </p>
            )}
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          {toast && (
            <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
              {toast}
            </div>
          )}

          {hoa && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleEnter()}
                disabled={saving || hoa.status !== "active"}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                Enter neighborhood as admin
              </button>
              <button
                type="button"
                onClick={() => void handleToggleStatus()}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Mark {hoa.status === "active" ? "inactive" : "active"}
              </button>
            </section>
          )}

          <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800">Add HOA admin</h2>
            <p className="text-sm text-gray-500 mt-1">
              Creates or attaches a Clerk user as admin for this neighborhood. Can reassign from another HOA.
            </p>
            <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={handleAddAdmin}>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full name (optional)"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@email.com"
                type="email"
                required
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Add admin"}
              </button>
            </form>
          </section>

          <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800">Admins</h2>
            <ul className="mt-3 space-y-2">
              {admins.map((m) => (
                <li key={m._id} className="text-sm text-gray-700 border-b border-gray-50 pb-2">
                  <span className="font-medium">{m.fullName || m.email || m.clerkUserId}</span>
                  {m.email && m.fullName && (
                    <span className="text-gray-500"> · {m.email}</span>
                  )}
                </li>
              ))}
              {admins.length === 0 && (
                <li className="text-sm text-gray-400">No admins yet — add one above.</li>
              )}
            </ul>
          </section>

          <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800">All members</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500">
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Email</th>
                    <th className="px-2 py-2">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {(hoa?.members ?? []).map((m) => (
                    <tr key={m._id} className="border-b border-gray-50">
                      <td className="px-2 py-2">{m.fullName || "—"}</td>
                      <td className="px-2 py-2">{m.email || "—"}</td>
                      <td className="px-2 py-2 capitalize">{m.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
  );
}
