import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Role = "admin" | "inspector" | "board";

/** Team management, moved from the old /admin/members page into Settings. */
export function TeamSection() {
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
      flash("Member added.");
    } catch (err) {
      flash(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="team" className="rounded-xl border bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-bold">Team</h2>
        <span className="text-xs text-ink-2">Admins: {adminCount}</span>
      </div>
      <p className="mt-0.5 text-xs text-ink-2">
        Add inspectors, admins, or read-only board members. Each account belongs to one
        neighborhood — inviting someone from another HOA moves their membership here.
      </p>

      {toast && (
        <p className="mt-2 rounded-lg border bg-paper px-3 py-2 text-xs">{toast}</p>
      )}

      <form className="mt-3 grid gap-2 md:grid-cols-4" onSubmit={handleAddMember}>
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Full name (optional)"
          className="md:col-span-1"
        />
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@email.com"
          type="email"
          required
          className="md:col-span-2"
        />
        <div className="flex gap-2 md:col-span-1">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="flex-1 rounded-lg border bg-white px-2.5 py-2 text-sm"
          >
            <option value="inspector">Inspector</option>
            <option value="admin">Admin</option>
            <option value="board">Board (read-only)</option>
          </select>
          <Button type="submit" size="sm" disabled={saving} className="self-center">
            {saving ? "Adding…" : "Add"}
          </Button>
        </div>
      </form>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[10.5px] font-bold uppercase tracking-wider text-ink-2">
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Email</th>
              <th className="px-2 py-2">Role</th>
              <th className="px-2 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((member) => (
              <tr key={member._id} className="border-b border-border/60 last:border-0">
                <td className="px-2 py-2">{member.fullName || "—"}</td>
                <td className="px-2 py-2 text-ink-2">{member.email || "—"}</td>
                <td className="px-2 py-2">
                  <select
                    value={member.role}
                    onChange={async (e) => {
                      try {
                        await updateRole({
                          membershipId: member._id as Id<"userHoaMemberships">,
                          role: e.target.value as Role,
                        });
                        flash("Role updated.");
                      } catch (err) {
                        flash(String(err));
                      }
                    }}
                    className="rounded border bg-white px-2 py-1 text-xs"
                  >
                    <option value="inspector">Inspector</option>
                    <option value="admin">Admin</option>
                    <option value="board">Board (read-only)</option>
                  </select>
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                    onClick={async () => {
                      const label = member.fullName || member.email || "this member";
                      if (!window.confirm(`Remove ${label} from this HOA?`)) return;
                      try {
                        await removeMember({ membershipId: member._id as Id<"userHoaMemberships"> });
                        flash("Member removed.");
                      } catch (err) {
                        flash(String(err));
                      }
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {(members ?? []).length === 0 && (
              <tr>
                <td className="px-2 py-6 text-center text-ink-2" colSpan={4}>
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
