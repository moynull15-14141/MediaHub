// Real WhatsApp Cloud API message-send adapter. No mock path - Phase 5 (or
// any future sender) can depend on this exact interface without needing to
// know anything about queueing/retries/rate limiting, which all live one
// layer up in campaign-queue-worker.service.ts.

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const GRAPH_BASE_URL = 'https://graph.facebook.com';

export type SendErrorCategory =
  | 'INVALID_NUMBER'
  | 'BLOCKED'
  | 'PERMISSION_DENIED'
  | 'TEMPLATE_REJECTED'
  | 'RATE_LIMIT'
  | 'SERVER_ERROR'
  | 'NETWORK'
  | 'UNKNOWN';

export interface SendMessageInput {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
  mediaLink?: string;
  mediaType?: 'IMAGE' | 'PDF' | 'DOCUMENT' | 'VIDEO';
}

export interface SendMessageResult {
  success: boolean;
  metaMessageId?: string;
  retryable: boolean;
  errorCategory?: SendErrorCategory;
  errorMessage?: string;
  httpStatus: number;
  rawResponse: any;
}

const MEDIA_TYPE_MAP: Record<string, string> = { IMAGE: 'image', VIDEO: 'video', PDF: 'document', DOCUMENT: 'document' };

// This is the Retry Engine's "retryable vs not" rule, kept in one place so
// the worker never has to guess. Matches the spec's explicit lists:
// retry on network/429/5xx; never retry invalid number / blocked / permission
// denied / template rejected.
const classifyError = (httpStatus: number, body: any): { retryable: boolean; category: SendErrorCategory } => {
  if (httpStatus === 429) return { retryable: true, category: 'RATE_LIMIT' };
  if (httpStatus >= 500) return { retryable: true, category: 'SERVER_ERROR' };

  const code = body?.error?.code;
  if (code === 131026) return { retryable: false, category: 'INVALID_NUMBER' };
  if (code === 131031 || code === 368) return { retryable: false, category: 'BLOCKED' };
  if (code === 190 || (typeof code === 'number' && code >= 200 && code <= 299)) return { retryable: false, category: 'PERMISSION_DENIED' };
  if (typeof code === 'number' && code >= 132000 && code <= 132999) return { retryable: false, category: 'TEMPLATE_REJECTED' };
  if (httpStatus === 401 || httpStatus === 403) return { retryable: false, category: 'PERMISSION_DENIED' };
  if (httpStatus === 400) return { retryable: false, category: 'UNKNOWN' };

  return { retryable: true, category: 'UNKNOWN' };
};

export const sendWhatsappMessage = async (input: SendMessageInput): Promise<SendMessageResult> => {
  const url = `${GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${encodeURIComponent(input.phoneNumberId)}/messages`;

  const payload: Record<string, any> = { messaging_product: 'whatsapp', to: input.to };
  if (input.mediaLink && input.mediaType) {
    const metaType = MEDIA_TYPE_MAP[input.mediaType] || 'document';
    payload.type = metaType;
    payload[metaType] = { link: input.mediaLink, ...(input.text ? { caption: input.text } : {}) };
  } else {
    payload.type = 'text';
    payload.text = { body: input.text };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.accessToken}` },
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    return {
      success: false,
      retryable: true,
      errorCategory: 'NETWORK',
      errorMessage: `Unable to reach WhatsApp Cloud API: ${err.message || 'network error'}`,
      httpStatus: 0,
      rawResponse: null,
    };
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const { retryable, category } = classifyError(response.status, body);
    return {
      success: false,
      retryable,
      errorCategory: category,
      errorMessage: body?.error?.message || `WhatsApp Cloud API request failed (${response.status})`,
      httpStatus: response.status,
      rawResponse: body,
    };
  }

  return {
    success: true,
    metaMessageId: body?.messages?.[0]?.id,
    retryable: false,
    httpStatus: response.status,
    rawResponse: body,
  };
};
