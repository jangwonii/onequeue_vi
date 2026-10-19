import assert from 'node:assert/strict';

export async function assertReachable(page,selector) {
  const element=page.locator(selector);
  assert.equal(await element.count(),1,'핵심 행동은 현재 화면에서 하나로 식별되어야 합니다: '+selector);
  assert.ok(await element.isVisible(),'핵심 행동이 숨겨져 있습니다: '+selector);
  assert.ok(await element.isEnabled(),'핵심 행동을 사용할 수 없습니다: '+selector);
  await element.click({trial:true,timeout:3000});
  return {reachable:true};
}
export async function assertMobileAction(page,{selector,width=390,height=844,open}) {
  await page.setViewportSize({width,height});if(open)await open();
  return assertReachable(page,selector);
}
export async function assertFocusSurvives(page,selector,{trigger,settleMs=0}={}) {
  await page.locator(selector).focus();
  if(trigger)await trigger();if(settleMs)await page.waitForTimeout(settleMs);
  assert.ok(await page.locator(selector).evaluate(e=>e===document.activeElement),'자동 갱신 뒤 키보드 포커스가 사라졌습니다: '+selector);
  return {focusRetained:true};
}
export async function assertLiveTransition(page,{selector,before,after,advance,timeoutMs=20000}) {
  assert.notEqual(before,after,'상태 전후의 기대값이 달라야 합니다.');
  assert.equal((await page.locator(selector).innerText()).trim(),before);
  let navigated=false;const listener=frame=>{if(frame===page.mainFrame())navigated=true;};page.on('framenavigated',listener);
  try{
    await advance();
    await page.waitForFunction(({selector,after})=>document.querySelector(selector)?.textContent.trim()===after,{selector,after},{timeout:timeoutMs});
    assert.equal(navigated,false,'시간/상태 경계는 새로고침 없이 화면에 반영되어야 합니다.');
  }finally{page.off('framenavigated',listener);}
  return {before,after,withoutReload:true};
}
export async function assertDownload(page,selector) {
  await assertReachable(page,selector);
  const pending=page.waitForEvent('download',{timeout:5000});
  const [download]=await Promise.all([pending,page.locator(selector).click()]);
  assert.equal(await download.failure(),null,'내보내기 다운로드에 실패했습니다.');
  return {downloaded:true};
}
export async function assertContrast(page,selector) {
  const items=await page.locator(selector).evaluateAll(elements=>elements.map(e=>{
    const css=getComputedStyle(e),rect=e.getBoundingClientRect();
    if(!rect.width || !rect.height || css.visibility!=='visible')return {hidden:true};
    const rgb=value=>(value.match(/[\d.]+/g)||[]).map(Number);
    const over=(a,b)=>{const alpha=a[3]??1;return a.slice(0,3).map((v,i)=>v*alpha+b[i]*(1-alpha));};
    const parents=[];for(let n=e;n;n=n.parentElement)parents.unshift(n);
    let bg=[255,255,255],unsupported=false;
    for(const n of parents){const s=getComputedStyle(n);if(s.backgroundImage!=='none'||s.opacity!=='1'||s.filter!=='none'||s.mixBlendMode!=='normal')unsupported=true;bg=over(rgb(s.backgroundColor),bg);}
    const fg=over(rgb(css.color),bg),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
    const a=lum(fg),b=lum(bg),size=parseFloat(css.fontSize),large=size>=24||(size>=18.667&&parseInt(css.fontWeight)>=700);
    return {unsupported,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),minimum:large?3:4.5,fontSize:size};
  }));
  assert.ok(items.length && items.every(x=>!x.hidden),'대비를 검사할 텍스트가 없거나 숨겨져 있습니다: '+selector);
  for(const item of items){assert.equal(item.unsupported,false,'배경 이미지·효과가 있는 텍스트는 별도 대비 검사가 필요합니다.');assert.ok(item.ratio>=item.minimum,`텍스트 대비 ${item.ratio.toFixed(2)}:1 < ${item.minimum}:1 (${selector})`);}
  return items;
}
export async function assertCondition(page,condition) {
  const locator=condition.selector?page.locator(condition.selector):null;
  if(condition.kind==='reachable')return assertReachable(page,condition.selector);
  if(condition.kind==='contrast')return assertContrast(page,condition.selector);
  if(condition.kind==='focused'){assert.ok(await locator.evaluate(e=>e===document.activeElement),'키보드 포커스 불일치');return true;}
  if(condition.kind==='no_overflow'){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'가로 넘침 발생');return true;}
  if(condition.kind==='visible'){assert.ok(await locator.isVisible(),'요소가 보이지 않습니다');return true;}
  if(condition.kind==='count'){const actual=await locator.count();assert.equal(actual,condition.expected);return actual;}
  if(condition.kind==='text'){const actual=(await locator.innerText()).trim();assert.equal(actual,condition.expected);return actual;}
  if(condition.kind==='url'){const u=new URL(page.url()),actual=u.pathname+u.search;assert.equal(actual,condition.expected);return actual;}
  throw new Error('지원하지 않는 검사입니다.');
}
