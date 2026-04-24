export type AppRole = "admin" | "inspector";

type MetadataCarrier = {
  publicMetadata?: Record<string, unknown>;
};

const validRoles: AppRole[] = ["admin", "inspector"];

export function getUserRoles(user: MetadataCarrier | null | undefined): AppRole[] {
  const rawRole = user?.publicMetadata?.role;
  const rawRoles = user?.publicMetadata?.roles;

  const out = new Set<AppRole>();
  if (rawRole === "admin" || rawRole === "inspector") out.add(rawRole);
  if (Array.isArray(rawRoles)) {
    for (const role of rawRoles) {
      if (typeof role === "string" && validRoles.includes(role as AppRole)) {
        out.add(role as AppRole);
      }
    }
  }
  return Array.from(out);
}

export function getUserRole(user: MetadataCarrier | null | undefined): AppRole | null {
  return getUserRoles(user)[0] ?? null;
}

export function hasRole(user: MetadataCarrier | null | undefined, role: AppRole): boolean {
  return getUserRoles(user).includes(role);
}
