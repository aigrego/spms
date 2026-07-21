/* Shared service-layer types. Services never read cookies/headers themselves —
   the caller (route handler in Phase B2, MCP server in Phase D) resolves the
   session, loads the users row, ensures the member (ensureCurrentMember) and
   passes this actor down. */

export interface Actor {
  userId: string; // users.id
  memberId: string; // members.id (the user's projection into the resource pool)
  name: string; // users.name (display)
  role: string; // users.role ('admin' | 'member')
}
