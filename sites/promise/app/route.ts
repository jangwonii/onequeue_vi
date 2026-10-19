export const dynamic = 'force-dynamic';
export function GET() {
  return new Response('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#202722"><meta name="description" content="사진으로 인증하고, 실패하면 약속한 벌칙 또는 완주 상금. 친구들과 함께 거는 7일의 미션."><title>우리의 약속 — 함께 지키는 7일</title><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><script type="module" src="/client.js"></script></head><body><a href="#main" class="skip">본문으로</a><div id="app"><main id="main" class="loading" aria-live="polite">우리의 약속을 불러오고 있어요…</main></div><dialog id="modal" aria-labelledby="modal-title"></dialog><div id="toast" role="status" aria-live="polite"></div></body></html>', {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'self'" }
  });
}
