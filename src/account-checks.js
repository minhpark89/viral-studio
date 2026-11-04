import {api} from './api.js';

export async function checkAccountSelection(accounts,{request=api,onProgress=()=>{}}={}) {
  const progress={total:accounts.length,completed:0,checked:0,ready:0,attention:0,failed:0,skipped:0,activeName:'',results:[]};
  const emit=()=>onProgress({...progress,results:[...progress.results]});
  for(const account of accounts){
    progress.activeName=account.name;emit();
    if(['busy','checking'].includes(account.status)){
      progress.skipped++;progress.results.push({id:account.id,name:account.name,error:'Profile đang được sử dụng.',skipped:true});
    }else{
      try{
        // An explicit body is necessary: api(url) is a GET for read endpoints.
        const result=await request(`/accounts/${account.id}/check`,{});
        if(!result?.status)throw Error('Máy chủ chưa trả về trạng thái tài khoản.');
        progress.checked++;if(result.status==='ready')progress.ready++;else progress.attention++;
        progress.results.push({id:account.id,name:account.name,status:result.status,message:result.message});
      }catch(error){progress.failed++;progress.results.push({id:account.id,name:account.name,error:error.message});}
    }
    progress.completed++;emit();
  }
  progress.activeName='';emit();return progress;
}

export function accountCheckSummary(progress) {
  return `Đã xử lý ${progress.completed}/${progress.total} tài khoản · kiểm tra được ${progress.checked} · sẵn sàng ${progress.ready} · cần xử lý ${progress.attention}${progress.failed?` · lỗi kiểm tra ${progress.failed}`:''}${progress.skipped?` · đang dùng, bỏ qua ${progress.skipped}`:''}.`;
}
