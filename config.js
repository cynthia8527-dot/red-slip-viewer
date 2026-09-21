// The published site uses only this public (publishable) key. Never put a secret key here.
const MAIN_PROJECT_ID = 'icqdmzndjmxffnlciijs';
const TEST_PROJECT_ID = 'zfcsuxihpakrsohvcwlr';
const main = Object.freeze({
  supabaseUrl: `https://${MAIN_PROJECT_ID}.supabase.co`,
  supabaseKey: 'sb_publishable_PUUgMuSNqlOFDaC8PvQ0KA_EcxNfhF6',
  storageBucket: 'factory-photos',
});

export function validateTestConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Missing test configuration (config.local.js).');
  const url = new URL(config.supabaseUrl);
  const loopback = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const cloudTest = url.origin === `https://${TEST_PROJECT_ID}.supabase.co`;
  if ((!loopback && !cloudTest) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Test Supabase must be loopback or the dedicated cloud test project.');
  }
  if (url.href.includes(MAIN_PROJECT_ID) || !config.supabaseKey || /^(sb_secret_|service_role|REPLACE_)/i.test(config.supabaseKey) || !config.storageBucket || config.storageBucket === main.storageBucket) {
    throw new Error('Unsafe test Supabase configuration.');
  }
  return Object.freeze({ ...config, supabaseUrl: url.origin });
}

export async function resolveConfig(locationLike = globalThis.location, loadLocal = () => import('./config.local.js')) {
  const host = locationLike.hostname;
  if (host === 'cynthia8527-dot.github.io') return main;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new Error(`Unrecognized site host: ${host}`);
  // A missing local config fails closed: local pages must never fall back to main.
  const { default: local } = await loadLocal();
  return validateTestConfig(local);
}
