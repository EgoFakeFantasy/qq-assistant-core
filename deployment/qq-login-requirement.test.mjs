import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLoginRequirement } from './qq-login-requirement.mjs';

test('offline and waiting QR are not evidence that a phone is required', () => {
  for (const status of [{ isLogin: false }, { isLogin: false, loginPhase: 'waiting_qrcode' }, { isOffline: true }]) {
    const result = classifyLoginRequirement(status);
    assert.equal(result.requiresPhoneLogin, null);
    assert.equal(result.loginRecoveryAction, 'automatic-login-or-inspect-current-verification');
  }
});

test('a captcha requirement cannot be relabeled as a phone or QR requirement', () => {
  assert.deepEqual(classifyLoginRequirement({ isLogin: false, needCaptcha: true }), {
    requiresPhoneLogin: null, loginRecoveryAction: 'inspect-current-captcha',
  });
});

test('fresh explicit device verification and scanned QR awaiting confirmation require a phone', () => {
  assert.equal(classifyLoginRequirement({ needNewDevice: true }).requiresPhoneLogin, true);
  assert.equal(classifyLoginRequirement({ loginPhase: 'qrcode_scanned' }).requiresPhoneLogin, true);
});

test('initialization and reconnecting wait rather than trigger another login', () => {
  for (const loginPhase of ['initializing', 'reconnecting']) {
    assert.deepEqual(classifyLoginRequirement({ isLogin: false, loginPhase }), {
      requiresPhoneLogin: null, loginRecoveryAction: 'wait-login-service',
    });
  }
});

test('a WebUI login still requires OneBot identity and group verification', () => {
  assert.deepEqual(classifyLoginRequirement({ isLogin: true }), {
    requiresPhoneLogin: false, loginRecoveryAction: 'verify-onebot-account-and-groups',
  });
  assert.equal(classifyLoginRequirement(undefined).requiresPhoneLogin, null);
});
