/* Shared service-layer types. Services never read cookies/headers themselves —
   the caller (route handler in Phase B2, MCP server in Phase D) resolves the
   session, loads the users row, resolves the current company (session cid →
   validated membership, with fallbacks), ensures the member projection and
   passes this actor down. */

export interface Actor {
  userId: string; // users.id
  memberId: string; // members.id (the user's projection into the company's resource pool)
  name: string; // users.name (display)
  role: string; // users.role — platform-level ('admin' | 'member')
  companyId: string; // companies.id — the current company sandbox
  companyRole: string; // company_memberships.role ('company_admin' | 'product_manager' | 'developer' | 'tester' | 'viewer')
  isPlatformAdmin: boolean; // users.role === 'admin' → bypasses the module matrix
}
