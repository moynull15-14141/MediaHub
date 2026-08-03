export const getApiBase = () =>
  import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';

// Thin fetch wrapper for /api/auth/* - mirrors whatsapp-api.ts's whatsappFetch
// (Bearer token, JSON body, shared error-shape) so the Profile page follows
// the same convention as the WhatsApp module instead of inventing a second one.
export async function authFetch<T = any>(
  token: string | null,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${getApiBase()}/api/auth${path}`, { ...options, headers, credentials: 'include' });
  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error || 'Request failed');
  }
  return body as T;
}
