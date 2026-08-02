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
