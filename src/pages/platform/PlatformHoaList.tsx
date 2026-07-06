import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import PlatformGuard from "@/components/PlatformGuard";
import { slugFromName } from "@/lib/hoaSlug";

export default function PlatformHoaList() {
  return (
    <PlatformGuard>
      <PlatformHoaListContent />
    </PlatformGuard>
  );
}

function PlatformHoaListContent() {
  const navigate = useNavigate();
  const hoas = useQuery(api.platform.listHoas, {});
  const createHoa = useMutation(api.platform.createHoa);
  const addPlatformAdmin = useMutation(api.platform.addPlatformAdmin);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const [paClerkId, setPaClerkId] = useState("");
  const [paEmail, setPaEmail] = useState("");
  const [paName, setPaName] = useState("");

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4000);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) {
      setSlug(slugFromName(value));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      flash("Name is required.");
      return;
    }
    setSaving(true);
    try {
      const result = await createHoa({ name: name.trim(), slug: slug.trim() || slugFromName(name) });
      flash(`Created ${result.name}.`);
      setName("");
      setSlug("");
      setSlugTouched(false);
      navigate(`/platform/hoa/${result.hoaId}`);
    } catch (err) {
      flash(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAddPlatformAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paClerkId.trim()) {
      flash("Clerk user ID is required.");
      return;
    }
    setSaving(true);
    try {
      const result = await addPlatformAdmin({
        clerkUserId: paClerkId.trim(),
        email: paEmail.trim() || undefined,
        fullName: paName.trim() || undefined,
      });
      flash(result.created ? "Platform admin added." : "User is already a platform admin.");
      setPaClerkId("");
      setPaEmail("");
      setPaName("");
    } catch (err) {
      flash(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
      <div className="min-h-screen bg-[#f0f4ff]">
        <div className="gradient-hero px-4 pt-8 pb-6">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-extrabold text-white">Platform Admin</h1>
              <p className="text-sky-100 text-sm mt-1">Manage neighborhoods and assign HOA admins</p>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/platform/companies" className="text-sm text-sky-100 hover:text-white">
                Management companies
              </Link>
              <Link to="/" className="text-sm text-sky-100 hover:text-white">
                Home
              </Link>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          {toast && (
            <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
              {toast}
            </div>
          )}

          <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800">Create neighborhood</h2>
            <p className="text-sm text-gray-500 mt-1">Shell only — streets and templates are configured after entering as admin.</p>
            <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={handleCreate}>
              <input
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Neighborhood name"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm md:col-span-1"
                required
              />
              <input
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                placeholder="url-slug"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm md:col-span-1"
                required
              />
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50 md:col-span-1"
              >
                {saving ? "Creating..." : "Create"}
              </button>
            </form>
          </section>

          <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800">Neighborhoods</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500">
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Slug</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Admins</th>
                    <th className="px-2 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(hoas ?? []).map((hoa) => (
                    <tr key={hoa._id} className="border-b border-gray-50">
                      <td className="px-2 py-2 font-medium text-gray-800">{hoa.name}</td>
                      <td className="px-2 py-2 text-gray-600">{hoa.slug}</td>
                      <td className="px-2 py-2 capitalize">{hoa.status}</td>
                      <td className="px-2 py-2">{hoa.adminCount}</td>
                      <td className="px-2 py-2 text-right">
                        <Link
                          to={`/platform/hoa/${hoa._id}`}
                          className="text-sky-600 hover:text-sky-800 font-medium"
                        >
                          Manage
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {(hoas ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-8 text-center text-gray-400">
                        No neighborhoods yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800">Add platform admin</h2>
            <p className="text-sm text-gray-500 mt-1">Grant super admin access to another Clerk user.</p>
            <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={handleAddPlatformAdmin}>
              <input
                value={paClerkId}
                onChange={(e) => setPaClerkId(e.target.value)}
                placeholder="Clerk user ID (user_...)"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm md:col-span-2"
                required
              />
              <input
                value={paEmail}
                onChange={(e) => setPaEmail(e.target.value)}
                placeholder="Email (optional)"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <input
                value={paName}
                onChange={(e) => setPaName(e.target.value)}
                placeholder="Name (optional)"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-50 md:col-span-4"
              >
                Add platform admin
              </button>
            </form>
          </section>
        </div>
      </div>
  );
}
