// Only classify fresh platform evidence. Offline status alone does not imply QR login.
export function classifyLoginRequirement(status) {
  if (!status || typeof status !== 'object') {
    return { requiresPhoneLogin: null, loginRecoveryAction: 'inspect-login-service' };
  }
  if (status.isLogin === true || status.loginPhase === 'ready') {
    return { requiresPhoneLogin: false, loginRecoveryAction: 'verify-onebot-account-and-groups' };
  }
  if (['initializing', 'reconnecting'].includes(status.loginPhase)) {
    return { requiresPhoneLogin: null, loginRecoveryAction: 'wait-login-service' };
  }
  if (status.needNewDevice === true) {
    return { requiresPhoneLogin: true, loginRecoveryAction: 'complete-current-device-verification' };
  }
  if (status.loginPhase === 'qrcode_scanned') {
    return { requiresPhoneLogin: true, loginRecoveryAction: 'wait-phone-confirmation' };
  }
  if (status.needCaptcha === true) {
    return { requiresPhoneLogin: null, loginRecoveryAction: 'inspect-current-captcha' };
  }
  return { requiresPhoneLogin: null, loginRecoveryAction: 'automatic-login-or-inspect-current-verification' };
}
