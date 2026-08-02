import { getApiBase } from './api';

// Thin fetch wrapper shared by the WhatsApp Campaign pages: all requests hit
// /api/whatsapp/*, require a Bearer token (this module has no anonymous
// access), and share the same JSON-body / error-shape conventions.
export async function whatsappFetch<T = any>(
  token: string | null,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${getApiBase()}/api/whatsapp${path}`, { ...options, headers, credentials: 'include' });
  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error || 'Request failed');
  }
  return body as T;
}
