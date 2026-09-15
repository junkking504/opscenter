/** Keep authentication, but never share the collector's ASP.NET session lock or
 * mutable franchise/day selection with an interactive dispatch operation. */
export function assignmentSessionState<T extends { cookies: Array<{ name: string }> }>(state: T): T {
  return { ...state, cookies: state.cookies.filter(cookie => cookie.name !== 'ASP.NET_SessionId') };
}
