import {StudioError} from './store.js';
import {accountQuotaBlocked,ACCOUNT_QUOTA_RECHECK_MS} from '../shared/account-health.js';

export class AccountHealthService {
  constructor(store,{dreamface,browsers,now=Date.now,intervalMs=60000}={}) {
    this.store=store;this.dreamface=dreamface;this.browsers=browsers;this.now=now;this.pending=new Map();this.stopping=false;this.worker=null;this.controller=new AbortController();
    for(const account of store.state.accounts)if(account.provider==='dreamface'&&accountQuotaBlocked(account)&&!account.quota){
      store.patch('accounts',account.id,{errorCode:'PROVIDER_QUOTA',renderReady:false,quota:{blocked:true,state:'exhausted',observedAt:account.updatedAt||new Date(now()).toISOString(),nextCheckAt:new Date(now()).toISOString()}});
    }
    this.timer=intervalMs>0?setInterval(()=>this.tick(),intervalMs):null;this.timer?.unref();
  }

  inUse(account,{automatic=false}={}) {
    const profile=account.profileId||account.id;
    return ['busy','checking'].includes(account.status)||this.browsers?.isProfileLocked?.(account)||this.store.state.accounts.some(other=>other.id!==account.id&&(other.profileId||other.id)===profile&&['busy','checking'].includes(other.status))||(automatic&&this.dreamface.sessions?.get(profile)?.visible);
  }

  async check(id,{automatic=false}={}) {
    if(this.stopping)throw new StudioError('App đang đóng.','APP_STOPPING',409);
    if(this.pending.has(id))return this.pending.get(id);
    const account=this.store.require('accounts',id);
    if(this.inUse(account,{automatic}))throw new StudioError('Profile đang được sử dụng; hãy chờ tác vụ hiện tại kết thúc.','PROFILE_BUSY',409);
    const promise=this.checkOnce(account,{automatic});this.pending.set(id,promise);
    try{return await promise;}finally{this.pending.delete(id);}
  }

  async checkOnce(account,{automatic}) {
    if(account.provider!=='dreamface')return this.browsers.check(account.id);
    const blocked=accountQuotaBlocked(account),previous={status:account.status,message:account.message,renderReady:account.renderReady};
    this.store.patch('accounts',account.id,{status:'checking',message:automatic?'Đang tự kiểm tra lại hạn mức DreamFace…':'Đang kiểm tra phiên và hạn mức DreamFace…'});
    try{
      const session=await this.dreamface.check(account),checkedAt=new Date(this.now()).toISOString();
      if(this.stopping)return session;
      if(session.status!=='ready')return this.store.patch('accounts',account.id,{...session,renderReady:false,checkedAt,errorCode:session.status==='verification'?'VERIFICATION':'NEEDS_LOGIN',quota:account.quota?{...account.quota,nextCheckAt:null}:null});
      const quota=await this.dreamface.checkQuota(account,{signal:this.controller.signal});
      if(this.stopping)return session;
      const nextCheckAt=new Date(this.now()+ACCOUNT_QUOTA_RECHECK_MS).toISOString();
      if(quota.state==='available')return this.store.patch('accounts',account.id,{...session,status:'ready',renderReady:true,errorCode:null,checkedAt,quota:{...quota,blocked:false,observedAt:checkedAt,nextCheckAt:null},message:quota.kind==='daily'?`Sẵn sàng · còn ${quota.remaining} lượt MC miễn phí hiện tại.`:`Sẵn sàng · ${quota.balance} credits, cấu hình MC đang hiển thị giá ${quota.cost} credits.`});
      const message=quota.state==='exhausted'?(quota.kind==='daily'?'DreamFace đã hết lượt MC miễn phí hiện tại.':`DreamFace còn ${quota.balance} credits; cấu hình MC hiện cần ${quota.cost} credits.`):'Phiên đã đăng nhập, nhưng chưa xác nhận được hạn mức MC.';
      return this.store.patch('accounts',account.id,{...session,status:'error',renderReady:false,errorCode:'PROVIDER_QUOTA',checkedAt,quota:{...quota,blocked:true,observedAt:checkedAt,nextCheckAt},message:message+' App tự kiểm tra lại sau 30 phút; có lượt sẽ dùng lại tự động.'});
    }catch(error){
      if(!this.stopping)this.store.patch('accounts',account.id,{status:'error',renderReady:false,errorCode:blocked?'PROVIDER_QUOTA':(error.code||'ACCOUNT_CHECK_FAILED'),checkedAt:new Date(this.now()).toISOString(),message:`Không kiểm tra được profile: ${String(error.message).slice(0,350)}`,...(blocked?{quota:{...account.quota,blocked:true,state:'unknown',nextCheckAt:new Date(this.now()+ACCOUNT_QUOTA_RECHECK_MS).toISOString()}}:{})});
      throw error;
    }finally{
      if(this.dreamface.sessions?.get(account.profileId||account.id)?.visible===false)await this.dreamface.close(account).catch(()=>{});
      if(this.stopping&&account.status==='checking')this.store.patch('accounts',account.id,previous);
    }
  }

  tick() {
    if(this.worker||this.stopping)return this.worker;
    this.worker=(async()=>{
      const due=this.store.state.accounts.filter(account=>account.provider==='dreamface'&&accountQuotaBlocked(account)&&!this.inUse(account,{automatic:true})&&(!account.quota?.nextCheckAt||Date.parse(account.quota.nextCheckAt)<=this.now()));
      for(const account of due){if(this.stopping)break;if(!accountQuotaBlocked(account)||this.inUse(account,{automatic:true})||(account.quota?.nextCheckAt&&Date.parse(account.quota.nextCheckAt)>this.now()))continue;try{await this.check(account.id,{automatic:true});}catch{/* Row records the failure and its bounded retry time. */}}
    })().finally(()=>{this.worker=null;});return this.worker;
  }

  async close(){
    this.stopping=true;clearInterval(this.timer);this.controller.abort();
    await Promise.allSettled([...this.pending.keys()].map(id=>{const account=this.store.state.accounts.find(item=>item.id===id);return account&&this.dreamface.sessions?.get(account.profileId||id)?.visible===false?this.dreamface.close(account):null;}));
    await Promise.allSettled([...this.pending.values()]);await this.worker;
  }
}
