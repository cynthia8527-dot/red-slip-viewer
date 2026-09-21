// Copy to the git-ignored config.local.js to use the dedicated cloud test project.
// Use only its publishable key; never use the main project or a secret/service-role key.
export default {
  supabaseUrl: 'https://zfcsuxihpakrsohvcwlr.supabase.co',
  supabaseKey: 'REPLACE_WITH_TEST_PROJECT_PUBLISHABLE_KEY',
  storageBucket: 'factory-photos-test',
};
