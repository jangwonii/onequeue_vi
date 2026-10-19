const reject=(status,message)=>{throw Object.assign(new Error(message),{status});};
const day=(start,index)=>new Date(Date.parse(start+'T00:00:00Z')+index*86400000).toISOString().slice(0,10);
export function triggerInput(data) {
  if(data.mode==='penalty'){
    if(!['each-miss','season'].includes(data.when))reject(400,'벌칙이 실행될 조건을 선택해 주세요.');
    const task=typeof data.task==='string'?data.task.trim():'';
    if(task.length<4 || task.length>240)reject(400,'벌칙은 4~240자로 구체적으로 정해 주세요.');
    return {mode:'penalty',when:data.when,task};
  }
  if(data.mode==='prize'){
    if(!Number.isSafeInteger(data.amount) || data.amount<1000 || data.amount>1000000)reject(400,'1인 약정액은 1,000~1,000,000원의 정수로 입력해 주세요.');
    return {mode:'prize',when:'season',amount:data.amount,currency:'KRW',payment:'direct'};
  }
  reject(400,'벌칙 또는 완주 상금을 선택해 주세요.');
}
// Derived from locked goals and server time. No timers, background payment or duplicated jobs.
export function triggerOutcome(s,phase,now) {
  const rule=s.trigger;
  if(!rule)return {state:'legacy',items:[],reason:'이전 시즌에는 실패 조건이 없습니다. 다음 시즌부터 정할 수 있어요.'};
  if(s.triggerSuspended)return {state:'suspended',items:[],reason:'참여자 기록이 삭제되어 자동 정산을 중단했습니다. 이미 이행·송금한 내용은 친구들과 직접 확인해 주세요.'};
  if(!s.started)return {state:'draft',items:[],reason:'전원이 조건에 동의한 뒤 시작합니다.'};
  if(rule.when==='season' && phase!=='finished')return {state:'waiting',items:[],reason:'시즌 종료와 인증 검토가 끝나면 확정됩니다.'};
  const items=[],count=p=>s.records.filter(r=>r.userId===p.id && !r.extra && r.status==='accepted').length;
  if(rule.mode==='penalty'){
    for(const p of s.people){
      const missed=rule.when==='season'?(count(p)<4?['season']:[]):(p.goal?.days || []).map(i=>day(s.start,i)).filter(d=>{
        if(now<=Date.parse(d+'T'+p.goal.cutoff+':00+09:00'))return false;
        const record=s.records.find(r=>r.userId===p.id && r.day===d && !r.extra);
        return !record || record.status==='rejected';
      });
      for(const date of missed)items.push({id:`penalty:${s.id}:${p.id}:${date}`,kind:'penalty',from:p.id,day:date,task:rule.task});
    }
  }else{
    const winners=s.people.filter(p=>count(p)===4),losers=s.people.filter(p=>count(p)<4);
    if(!winners.length || !losers.length)return {state:'clear',items:[],reason:winners.length?'모두 완주했습니다. 서로 송금할 상금이 없어요.':'완주자가 없어 상금 정산이 발생하지 않습니다.'};
    // Each unsuccessful participant contributes the agreed amount once. Remainders follow the locked roster order.
    for(const from of losers)winners.forEach((to,i)=>items.push({id:`prize:${s.id}:${from.id}:${to.id}`,kind:'prize',from:from.id,to:to.id,amount:Math.floor(rule.amount/winners.length)+(i<rule.amount%winners.length?1:0)}));
  }
  return {state:items.length?'triggered':'clear',reason:items.length?'약속한 조건이 발동했습니다.':'지금 발동한 조건이 없습니다.',items:items.map(item=>({...item,progress:s.triggerProgress?.[item.id] || {status:'pending'}}))};
}
