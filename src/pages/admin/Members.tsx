import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type Role = "admin" | "inspector";

export default function Members() {
  const navigate = useNavigate();
  const members = useQuery(api.members.list, {});
  const createOrAttachMember = useAction(api.membersNode.createOrAttachMember);
  const updateRole = useMutation(api.members.updateRole);
  const removeMember = useMutation(api.members.removeMember);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("inspector");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const adminCount = useMemo(
    () => (members ?? []).filter((member) => member.role === "admin").length,
    [members],
  );

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4000);
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      flash("Email is required.");
      return;
    }
    setSaving(true);
    try {
      await createOrAttachMember({
        email: email.trim(),
        fullName: fullName.trim() || undefined,
        role,
      });
      setFullName("");
      setEmail("");
      setRole("inspector");
      flash("Member added successfully.");
    } catch (err) {
      flash(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (membershipId: Id<"userHoaMemberships">, nextRole: Role) => {
    try {
      await updateRole({
        membershipId,
        role: nextRole,
      });
      flash("Role updated.");
    } catch (err) {
      flash(String(err));
    }
  };

  const handleRemove = async (membershipId: Id<"userHoaMemberships">, label: string) => {
    const confirmed = window.confirm(`Remove ${label} from this HOA?`);
    if (!confirmed) return;
    try {
      await removeMember({ membershipId });
      flash("Member removed.");
    } catch (err) {
      flash(String(err));
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f7ff]">
      <div className="gradient-admin px-4 pt-8 pb-5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-sm text-purple-100 hover:text-white font-medium transition-colors"
            onClick={() => navigate("/admin/dashboard")}
          >
            ← Dashboard
          </button>
          <h1 className="font-extrabold text-white text-xl">Team Members</h1>
          <div className="w-20" />
        </div>
        <p className="text-purple-200 text-xs mt-2 text-center">Add inspectors/admins and manage access</p>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {toast && (
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
            {toast}
          </div>
        )}

        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">Add Member</h2>
          <p className="text-sm text-gray-500 mt-1">
            Pre-create a member account and assign a role before their first sign-in.
          </p>
          <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={handleAddMember}>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name (optional)"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm md:col-span-1"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@email.com"
              type="email"
              required
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm md:col-span-2"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm md:col-span-1"
            >
              <option value="inspector">Inspector</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 md:col-span-4"
            >
              {saving ? "Adding member..." : "Add member"}
            </button>
          </form>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">Current Members</h2>
            <span className="text-xs text-gray-500">Admins: {adminCount}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Role</th>
                  <th className="px-2 py-2">User ID</th>
                  <th className="px-2 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(members ?? []).map((member) => (
                  <tr key={member._id} className="border-b border-gray-50">
                    <td className="px-2 py-2">{member.fullName || "—"}</td>
                    <td className="px-2 py-2">{member.email || "—"}</td>
                    <td className="px-2 py-2">
                      <select
                        value={member.role}
                        onChange={(e) => void handleRoleChange(member._id, e.target.value as Role)}
                        className="rounded border border-gray-200 px-2 py-1"
                      >
                        <option value="inspector">Inspector</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-500">{member.clerkUserId}</td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                        onClick={() => void handleRemove(member._id, member.fullName || member.email || "this member")}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {(members ?? []).length === 0 && (
                  <tr>
                    <td className="px-2 py-6 text-center text-gray-400" colSpan={5}>
                      No members yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
