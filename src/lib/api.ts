export const getApiBase = () =>
  import.meta.env.DEV
    ? ''
    : (import.meta.env.VITE_API_URL || 'https://mediahub-e6qr.onrender.com');
