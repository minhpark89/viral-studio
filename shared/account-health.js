export const ACCOUNT_QUOTA_RECHECK_MS = 30 * 60 * 1000;

export function accountQuotaBlocked(account) {
  if (['needs_login','verification'].includes(account?.status)) return false;
  if (account?.quota?.blocked) return true;
  return account?.status === 'error' && (account.errorCode === 'PROVIDER_QUOTA' || /hết lượt|hết hạn mức|quota|daily.{0,30}limit|not enough.{0,30}credits?|insufficient.{0,30}credits?|không đủ.{0,30}credits?|no free.{0,30}credit/i.test(account.message || ''));
}

export function accountDisplayStatus(account) {
  return !['busy','checking'].includes(account.status) && accountQuotaBlocked(account) ? 'quota' : account.status;
}

export function quotaFailureState(error, now = Date.now()) {
  return {
    status:'error',renderReady:false,errorCode:'PROVIDER_QUOTA',message:error.message,
    quota:{blocked:true,state:'exhausted',observedAt:new Date(now).toISOString(),nextCheckAt:new Date(now+ACCOUNT_QUOTA_RECHECK_MS).toISOString()},
  };
}
