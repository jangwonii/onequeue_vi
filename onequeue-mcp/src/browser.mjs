import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { requireThat, fingerprint, now, delay, redact } from './util.mjs';
import { assertCondition } from './quality-checks.mjs';

export class Browsers {
  constructor(project, store, jobs) { this.project = project; this.store = store; this.jobs = jobs; this.sessions = new Map(); }
  async getBrowser() {
    if (!this.browser?.isConnected()) {
      try {
        this.browser = await chromium.launch({ headless: true, ...(this.project.browserChannel === 'chromium' ? {} : { channel: this.project.browserChannel }) });
      } catch { throw Object.assign(new Error('브라우저를 실행할 수 없습니다. 설정된 Edge/Chrome 또는 Playwright Chromium을 설치하세요.'), { code: 'BROWSER_UNAVAILABLE' }); }
    }
    return this.browser;
  }
  session(id) {
    const s = this.sessions.get(id);
    requireThat(s, 'SESSION_NOT_FOUND', '브라우저 세션을 찾을 수 없습니다.');
    requireThat(this.jobs.get(s.previewId).status === 'ready', 'PREVIEW_NOT_READY', '미리보기가 실행 중이 아닙니다.');
    return s;
  }
  url(base, path) {
    const url = new URL(path, base);
    requireThat(url.origin === base && !url.username && !url.password, 'URL_NOT_ALLOWED', '현재 원큐 미리보기 주소만 열 수 있습니다.');
    return url.href;
  }
  async navigate(page, target) {
    const response = await page.goto(target, { waitUntil: 'domcontentloaded' });
    requireThat(!response || response.status() < 400, 'NAVIGATION_FAILED', `화면을 열 수 없습니다. HTTP ${response?.status()}`);
  }
  async action(input) {
    const { action } = input;
    if (action === 'open') {
      requireThat(input.previewId, 'PREVIEW_REQUIRED', 'previewId가 필요합니다.');
      const job = this.jobs.get(input.previewId);
      requireThat(job.kind === 'preview' && job.status === 'ready', 'PREVIEW_NOT_READY', '준비된 미리보기를 지정하세요.');
      requireThat(this.sessions.size < 6, 'SESSION_LIMIT', '브라우저 세션은 최대 6개입니다.');
      const target = this.url(job.url, input.path || '/');
      const browser = await this.getBrowser();
      const context = await browser.newContext({ viewport: { width: input.width || 1280, height: input.height || 900 }, serviceWorkers: 'block', acceptDownloads: false });
      try {
        // Fetch redirects one hop at a time so every destination is checked again.
        await context.route('**/*', async route => {
          try {
            if (new URL(route.request().url()).origin !== job.url) return await route.abort('blockedbyclient');
            const response = await route.fetch({ maxRedirects: 0, timeout: 10000 });
            const location = response.headers().location;
            if (location && new URL(location, route.request().url()).origin !== job.url) {
              return await route.fulfill({ status: 403, contentType: 'text/plain', body: 'OneQueue blocked a redirect outside the preview origin.' });
            }
            await route.fulfill({ response });
          } catch { await route.abort().catch(() => {}); }
        });
        await context.routeWebSocket(/.*/, ws => ws.close());
        const page = await context.newPage();
        page.setDefaultTimeout(5000); page.setDefaultNavigationTimeout(10000);
        const s = { id: randomUUID(), previewId: job.id, base: job.url, fingerprint: job.fingerprint, context, page, errors: [] };
        page.on('pageerror', e => { s.errors.push(redact(e.message).slice(0, 2000)); s.errors = s.errors.slice(-20); });
        page.on('dialog', dialog => void dialog.dismiss());
        context.on('page', popup => { if (popup !== page) void popup.close(); });
        await this.navigate(page, target);
        this.sessions.set(s.id, s);
        return { sessionId: s.id, previewId: job.id, url: page.url(), title: await page.title(), isolated: true };
      } catch (error) { await context.close(); throw error; }
    }
    if (action === 'close') {
      const s = this.sessions.get(input.sessionId);
      requireThat(s, 'SESSION_NOT_FOUND', '브라우저 세션을 찾을 수 없습니다.');
      await s.context.close(); this.sessions.delete(s.id); return { closed: true, sessionId: s.id };
    }
    const s = this.session(input.sessionId), page = s.page;
    if (action === 'navigate') await this.navigate(page, this.url(s.base, input.path || '/'));
    else if (action === 'reload') await page.reload({ waitUntil: 'domcontentloaded' });
    else if (action === 'viewport') await page.setViewportSize({ width: input.width || 1280, height: input.height || 900 });
    else if (['click', 'fill', 'select', 'check'].includes(action)) {
      requireThat(input.selector, 'SELECTOR_REQUIRED', 'selector가 필요합니다.');
      const locator = page.locator(input.selector);
      if (action === 'click') await locator.click();
      if (action === 'fill' || action === 'select') {
        requireThat(input.value !== undefined, 'VALUE_REQUIRED', '입력값이 필요합니다.');
        if (action === 'fill') await locator.fill(input.value); else await locator.selectOption(input.value);
      }
      if (action === 'check') await locator.setChecked(input.checked ?? true);
    }
    const result = { sessionId: s.id, url: page.url(), errors: s.errors, note: '조작 결과이며 완료 조건 통과를 뜻하지 않습니다.' };
    if (action === 'snapshot') {
      const name = `${randomUUID()}.png`, path = await this.store.artifactPath(name);
      await page.screenshot({ path, fullPage: false, mask: [page.locator('input[type=password]')] });
      result.artifact = { uri: `onequeue://projects/${this.project.id}/artifacts/${name}`, path, mimeType: 'image/png' };
      result.accessibility = redact(await page.locator('body').ariaSnapshot()).slice(0, 16000);
    }
    return result;
  }
  async assert({ sessionId, criterionId }) {
    const s = this.session(sessionId), brief = this.store.state.brief;
    const criterion = brief?.criteria.find(c => c.id === criterionId);
    requireThat(['browser','journey'].includes(criterion?.verification.kind), 'BROWSER_CRITERION_REQUIRED', '명세에 등록된 브라우저 완료 조건을 지정하세요.');
    if(criterion.verification.kind==='journey')return this.journey(s,criterion,brief);
    const condition = criterion.verification.assertion;
    const startHash = (await fingerprint(this.project)).hash;
    let passed = false, actual, error;
    const deadline = Date.now() + 5000;
    do {
      try {
        actual=await assertCondition(s.page,condition);passed=true;
        error = undefined;
      } catch (e) { error = redact(e.message).slice(0, 2000); passed = false; }
      if (!passed) await delay(100);
    } while (!passed && Date.now() < deadline);
    const endHash = (await fingerprint(this.project)).hash;
    const evidence = {
      id: randomUUID(), kind: 'browser', criterionId, sessionId, previewId: s.previewId,
      briefVersion: brief.version, fingerprint: s.fingerprint,
      sourceChanged: s.fingerprint !== startHash || startHash !== endHash,
      status: passed ? 'passed' : 'failed', createdAt: now(),
      detail: { assertion: condition, actual: typeof actual === 'string' ? redact(actual).slice(0, 8000) : actual, error, url: s.page.url() }
    };
    this.store.state.evidence.push(evidence); await this.store.save();
    return { ...evidence, effectiveStatus: evidence.sourceChanged ? 'stale' : evidence.status };
  }
  async journey(s,criterion,brief) {
    const startHash=(await fingerprint(this.project)).hash,results=[],coverage=new Set(),page=s.page,started=Date.now();
    let focus,waited=false,keyboard=false,reloaded=false,error,navigations=0;
    const onNavigation=frame=>{if(frame===page.mainFrame())navigations++;};page.on('framenavigated',onNavigation);
    const texts=new Map();
    try{
      for(const step of criterion.verification.steps){
        requireThat(Date.now()-started<45000,'JOURNEY_TIMEOUT','시나리오 제한 시간을 초과했습니다.');
        if(step.action==='viewport')await page.setViewportSize({width:step.width,height:step.height});
        else if(step.action==='focus'){await page.locator(step.selector).focus();focus=step.selector;waited=false;}
        else if(step.action==='press'){await page.keyboard.press(step.key);keyboard=true;}
        else if(step.action==='click')await page.locator(step.selector).click();
        else if(step.action==='fill')await page.locator(step.selector).fill(step.value);
        else if(step.action==='wait'){await delay(step.ms);waited=true;}
        else if(step.action==='reload'){await page.reload({waitUntil:'domcontentloaded'});reloaded=true;}
        else if(step.action==='assert'){
          const c=step.assertion;await assertCondition(page,c);
          if(c.kind==='reachable' && page.viewportSize().width<=480)coverage.add('mobile-actions');
          if(c.kind==='contrast')coverage.add('contrast');
          if(c.kind==='focused' && keyboard)coverage.add('keyboard');
          if(c.kind==='focused' && c.selector===focus && waited)coverage.add('focus-retention');
          if(c.kind==='text'){
            const prior=texts.get(c.selector);
            if(prior && prior.expected!==c.expected && waited && !reloaded && prior.navigations===navigations)coverage.add('live-update');
            if(reloaded && prior?.expected===c.expected)coverage.add('reload-persistence');
            texts.set(c.selector,{expected:c.expected,navigations});
          }
        }
        results.push({index:results.length,action:step.action,status:'passed'});
      }
      requireThat(s.errors.length===0,'BROWSER_ERRORS','시나리오 중 브라우저 오류가 발생했습니다.');
    }catch(e){error=redact(e.message).slice(0,2000);results.push({index:results.length,status:'failed',error});}
    finally{page.off('framenavigated',onNavigation);}
    const endHash=(await fingerprint(this.project)).hash;
    const evidence={id:randomUUID(),kind:'journey',criterionId:criterion.id,sessionId:s.id,previewId:s.previewId,briefVersion:brief.version,
      fingerprint:s.fingerprint,sourceChanged:s.fingerprint!==startHash || startHash!==endHash,status:error?'failed':'passed',createdAt:now(),
      provenance:{environment:'local',identity:'synthetic',actors:1,methods:['automated-run'],limitations:['격리된 로컬 브라우저입니다.']},detail:{steps:results,coverage:[...coverage],error}};
    this.store.state.evidence.push(evidence);await this.store.save();return {...evidence,effectiveStatus:evidence.sourceChanged?'stale':evidence.status};
  }
  async closePreview(id) {
    for (const s of this.sessions.values()) if (s.previewId === id) { await s.context.close(); this.sessions.delete(s.id); }
  }
  async close() { await this.browser?.close(); this.sessions.clear(); }
}
