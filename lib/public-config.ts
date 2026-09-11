// Public project identifiers only. AI credentials live in Orbit Edge Function Secrets.
export const publicConfig = {
  url: 'https://uouzmmexjundpfitogky.supabase.co',
  key: 'sb_publishable__XjfvOCgcMDsBks3V4F0Cg_o0rEZn_t',
};
export const captureUrl = `${publicConfig.url}/functions/v1/capture`;
export const workCaptureUrl = `${publicConfig.url}/functions/v1/work-capture`;
export function appBase() { return new URL('.', document.baseURI); }
