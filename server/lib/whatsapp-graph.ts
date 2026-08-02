const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const GRAPH_BASE_URL = 'https://graph.facebook.com';

export class WhatsappGraphError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface PhoneNumberDetails {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
}

// Validates the access token/phone number ID by asking Meta's Graph API for
// the phone number's own details - a lightweight call that both confirms the
// credentials work and gives us real data to show in the UI.
export const fetchPhoneNumberDetails = async (
  phoneNumberId: string,
  accessToken: string,
): Promise<PhoneNumberDetails> => {
  const url = new URL(`${GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}`);
  url.searchParams.set('fields', 'display_phone_number,verified_name,quality_rating,messaging_limit_tier');
  url.searchParams.set('access_token', accessToken);

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch (err: any) {
    throw new WhatsappGraphError(`Unable to reach WhatsApp Cloud API: ${err.message || 'network error'}`, 502);
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = body?.error?.message || `WhatsApp Cloud API request failed (${response.status})`;
    throw new WhatsappGraphError(message, response.status === 401 || response.status === 403 ? 401 : 400);
  }

  return {
    displayPhoneNumber: body?.display_phone_number ?? null,
    verifiedName: body?.verified_name ?? null,
    qualityRating: body?.quality_rating ?? null,
    messagingLimitTier: body?.messaging_limit_tier ?? null,
  };
};

// --- Phase B.1: Meta Embedded Signup ---------------------------------------
// Everything below talks to Meta's official Graph API endpoints only - no
// custom OAuth server, no third-party library. Same GRAPH_BASE_URL/VERSION
// and WhatsappGraphError convention as fetchPhoneNumberDetails above.

const graphGet = async (path: string, params: Record<string, string>): Promise<any> => {
  const url = new URL(`${GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch (err: any) {
    throw new WhatsappGraphError(`Unable to reach Meta Graph API: ${err.message || 'network error'}`, 502);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error) {
    const message = body?.error?.message || `Meta Graph API request failed (${response.status})`;
    throw new WhatsappGraphError(message, response.status === 401 || response.status === 403 ? 401 : 400);
  }
  return body;
};

export interface ExchangedToken {
  accessToken: string;
  expiresInSeconds: number | null;
}

// Exchanges the one-time authorization `code` returned by FB.login (Embedded
// Signup config_id flow) for a business access token. This flow issues the
// code without a redirect_uri (it never leaves the browser via a server
// redirect), so none is sent here - matching Meta's documented Embedded
// Signup token exchange, not the classic web OAuth redirect grant.
export const exchangeCodeForToken = async (code: string, appId: string, appSecret: string): Promise<ExchangedToken> => {
  const body = await graphGet('oauth/access_token', { client_id: appId, client_secret: appSecret, code });
  if (!body?.access_token) throw new WhatsappGraphError('Meta did not return an access token for this code', 502);
  return { accessToken: body.access_token, expiresInSeconds: typeof body.expires_in === 'number' ? body.expires_in : null };
};

export interface WabaDetails {
  name: string | null;
  accountReviewStatus: string | null;
}

export const fetchWabaDetails = async (wabaId: string, accessToken: string): Promise<WabaDetails> => {
  const body = await graphGet(encodeURIComponent(wabaId), { fields: 'name,account_review_status', access_token: accessToken });
  return { name: body?.name ?? null, accountReviewStatus: body?.account_review_status ?? null };
};

export interface BusinessDetails {
  name: string | null;
  verificationStatus: string | null;
}

export const fetchBusinessDetails = async (businessId: string, accessToken: string): Promise<BusinessDetails> => {
  const body = await graphGet(encodeURIComponent(businessId), { fields: 'name,verification_status', access_token: accessToken });
  return { name: body?.name ?? null, verificationStatus: body?.verification_status ?? null };
};

export interface TokenDebugInfo {
  isValid: boolean;
  expiresAt: Date | null;
  scopes: string[];
}

// The official way to introspect what a Graph API token can actually do
// (Part 9: Validate Token/Permissions/Status) - inspected using the app's
// own id|secret as the authorizing token, per Meta's /debug_token contract.
export const debugToken = async (inputToken: string, appId: string, appSecret: string): Promise<TokenDebugInfo> => {
  const body = await graphGet('debug_token', { input_token: inputToken, access_token: `${appId}|${appSecret}` });
  const data = body?.data;
  return {
    isValid: Boolean(data?.is_valid),
    // Meta returns expires_at: 0 for tokens that never expire (the common
    // case for System User / Embedded Signup business tokens) - treat that
    // the same as "no expiry" rather than the 1970 epoch date it'd otherwise
    // decode to.
    expiresAt: data?.expires_at ? new Date(data.expires_at * 1000) : null,
    scopes: Array.isArray(data?.scopes) ? data.scopes : [],
  };
};
