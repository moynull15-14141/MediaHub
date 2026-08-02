import { useCallback, useRef, useState } from 'react';
import { useAuth } from '@/src/components/auth/AuthContext';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

// Phase B.1 - Meta WhatsApp Embedded Signup. This is Meta's official
// JS-SDK popup flow (FB.login with a config_id from Meta App Dashboard >
// WhatsApp > Embedded Signup), not a custom-built OAuth redirect: the SDK
// hands back a one-time `code` via its own callback, and the signup popup
// separately posts a `WA_EMBEDDED_SIGNUP` window message carrying the
// waba_id/phone_number_id/business_id the user picked. Both pieces are
// required before the backend callback can complete the connection.

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

let sdkLoadPromise: Promise<void> | null = null;

const loadFacebookSdk = (): Promise<void> => {
  if (window.FB) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load the Facebook SDK'));
    document.body.appendChild(script);
  });
  return sdkLoadPromise;
};

interface SignupSessionData {
  phoneNumberId?: string;
  wabaId?: string;
  businessId?: string;
}

export interface EmbeddedSignupResult {
  id: string;
  displayPhoneNumber: string | null;
  businessName: string | null;
  [key: string]: unknown;
}

export function useFacebookEmbeddedSignup() {
  const { token } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const listenerRef = useRef<((event: MessageEvent) => void) | null>(null);

  const cleanupListener = useCallback(() => {
    if (listenerRef.current) {
      window.removeEventListener('message', listenerRef.current);
      listenerRef.current = null;
    }
  }, []);

  const connect = useCallback(async (): Promise<EmbeddedSignupResult> => {
    setConnecting(true);
    try {
      const publicConfig = await whatsappFetch<{ configured: boolean; appId: string | null; configId: string | null; graphApiVersion: string; state: string | null }>(
        token,
        '/account/meta/config',
      );
      if (!publicConfig.configured || !publicConfig.appId || !publicConfig.configId || !publicConfig.state) {
        throw new Error('Meta Embedded Signup is not configured on this server yet. Set META_APP_ID and META_WHATSAPP_CONFIG_ID.');
      }

      await loadFacebookSdk();
      if (!window.FB) throw new Error('Facebook SDK failed to load');
      window.FB.init({ appId: publicConfig.appId, autoLogAppEvents: true, xfbml: false, version: publicConfig.graphApiVersion });

      const sessionData: SignupSessionData = {};
      let sessionOutcome: 'FINISH' | 'CANCEL' | 'ERROR' | null = null;

      const result = await new Promise<EmbeddedSignupResult>((resolve, reject) => {
        const messageListener = (event: MessageEvent) => {
          if (!/^https:\/\/www\.facebook\.com$/.test(event.origin) && !/^https:\/\/web\.facebook\.com$/.test(event.origin)) return;
          try {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
            if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
              sessionData.phoneNumberId = data.data?.phone_number_id;
              sessionData.wabaId = data.data?.waba_id;
              sessionData.businessId = data.data?.business_id;
              sessionOutcome = 'FINISH';
            } else if (data.event === 'CANCEL') {
              sessionOutcome = 'CANCEL';
            } else if (data.event === 'ERROR') {
              sessionOutcome = 'ERROR';
            }
          } catch {
            // Not a JSON embedded-signup message - ignore.
          }
        };
        listenerRef.current = messageListener;
        window.addEventListener('message', messageListener);

        window.FB.login(
          async (response: any) => {
            const code = response?.authResponse?.code;
            if (sessionOutcome === 'CANCEL') {
              reject(new Error('WhatsApp connection was cancelled'));
              return;
            }
            if (sessionOutcome === 'ERROR' || !code) {
              reject(new Error('Facebook login did not complete successfully'));
              return;
            }
            if (!sessionData.wabaId || !sessionData.phoneNumberId) {
              reject(new Error('Facebook did not return a WhatsApp Business Account/Phone Number selection'));
              return;
            }
            try {
              const account = await whatsappFetch<EmbeddedSignupResult>(token, '/account/meta/callback', {
                method: 'POST',
                body: JSON.stringify({
                  code,
                  state: publicConfig.state,
                  wabaId: sessionData.wabaId,
                  phoneNumberId: sessionData.phoneNumberId,
                  businessId: sessionData.businessId,
                }),
              });
              resolve(account);
            } catch (err: any) {
              reject(err);
            }
          },
          {
            config_id: publicConfig.configId,
            response_type: 'code',
            override_default_response_type: true,
            extras: { setup: {}, sessionInfoVersion: '3' },
          },
        );
      });

      return result;
    } finally {
      cleanupListener();
      setConnecting(false);
    }
  }, [token, cleanupListener]);

  return { connect, connecting };
}
