/* Shared service-layer types. Services never read cookies/headers themselves —
   the caller (route handler in Phase B2, MCP server in Phase D) resolves the
   session, loads the users row, resolves the current company (session cid →
   validated membership, with fallbacks), ensures the member projection and
   passes this actor down. */

export interface Actor {
  userId: string; // users.id
  memberId: string | null; // members.id (the user's projection into the company's resource pool; null for a seat-less platform admin)
  name: string; // users.name (display)
  role: string; // users.role — platform-level ('admin' | 'member')
  companyId: string; // companies.id — the current company sandbox
  companyRole: string; // company_memberships.role ('company_admin' | 'product_manager' | 'developer' | 'tester' | 'viewer')
  isPlatformAdmin: boolean; // users.role === 'admin' → bypasses the module matrix
  /* MCP 令牌的项目白名单（mcp_api_keys.project_ids）：null/undefined = 不限制；
     设置后只能访问列出的项目。仅 DB key 携带，浏览器 session / env key 不设。 */
  allowedProjectIds?: string[] | null;
}
