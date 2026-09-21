import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, validateTestConfig } from '../config.js';

const local = { supabaseUrl: 'http://127.0.0.1:54321', supabaseKey: 'local-publishable', storageBucket: 'factory-photos-test' };

test('T001 test configuration accepts only loopback or the dedicated cloud project', () => {
  assert.equal(validateTestConfig(local).supabaseUrl, 'http://127.0.0.1:54321');
  assert.equal(validateTestConfig({ ...local, supabaseUrl: 'https://zfcsuxihpakrsohvcwlr.supabase.co' }).supabaseUrl,
    'https://zfcsuxihpakrsohvcwlr.supabase.co');
  for (const url of [
    'https://icqdmzndjmxffnlciijs.supabase.co',
    'https://example.supabase.co',
    'http://zfcsuxihpakrsohvcwlr.supabase.co',
    'https://zfcsuxihpakrsohvcwlr.supabase.co.evil.example',
    'https://zfcsuxihpakrsohvcwlr.supabase.co/other',
  ]) {
    assert.throws(() => validateTestConfig({ ...local, supabaseUrl: url }), /dedicated cloud test project/);
  }
});

test('T002 local config cannot reuse main photo bucket or missing key', () => {
  assert.throws(() => validateTestConfig({ ...local, storageBucket: 'factory-photos' }), /Unsafe/);
  assert.throws(() => validateTestConfig({ ...local, supabaseKey: '' }), /Unsafe/);
  assert.throws(() => validateTestConfig({ ...local, supabaseKey: 'sb_secret_fake' }), /Unsafe/);
});

test('T003 local site fails closed when local config is absent', async () => {
  await assert.rejects(resolveConfig({ hostname: 'localhost' }, () => Promise.reject(new Error('config.local.js missing'))), /config\.local\.js/);
  await assert.rejects(resolveConfig({ hostname: 'unrecognized.example' }), /Unrecognized/);
});

test('T004 published site retains current main configuration', async () => {
  const config = await resolveConfig({ hostname: 'cynthia8527-dot.github.io' });
  assert.equal(config.supabaseUrl, 'https://icqdmzndjmxffnlciijs.supabase.co');
  assert.equal(config.storageBucket, 'factory-photos');
});
