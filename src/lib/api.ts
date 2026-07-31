export const getApiBase = () =>
  import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL || '';
