# 출고 데스크

OneQueue MCP 0.3.0으로 계약을 저장하고 빌드 및 실행 검증을 수행한 로컬 재고·주문 앱입니다.

## 실행
이 폴더에서 `npm start` 후 http://127.0.0.1:4280 접속. Node 24 이상 필요. 별도 앱 의존성 설치는 없습니다.

상품 등록 → 입고 → 여러 품목 주문 예약 → 출고 또는 취소. 검색과 상태 필터, JSON 백업 다운로드 및 복구를 제공합니다. 재고 부족과 잘못된 복구 요청은 전체 거절합니다. DB는 data/dispatch.sqlite에 저장됩니다.

## 재검증
저장소 루트에서 `node onequeue-mcp/scripts/dispatch.mjs run`. OneQueue의 설치된 SDK와 Playwright, Microsoft Edge가 필요합니다. 전용 dispatch.projects.json을 사용하므로 기존 프로젝트 잠금을 건드리지 않습니다. 빌드 후 dist 서버를 격리된 임시 DB로 테스트합니다. `npm run build` 후 `node dist/server.mjs`로 독립 산출물을 실행할 수 있습니다. 이 경우 DB는 dist/data에 별도로 저장됩니다.

초기 보안 테스트 실패는 Node fetch가 사용자 지정 Host 헤더를 전송하지 않은 테스트 구성 문제였습니다. node:http로 실제 잘못된 Host를 전송하여 403 응답을 확인했습니다. 첫 실패 보고서는 test-results/first-run-cases.json에 보존합니다.

## 복구와 한계
백업 복구는 현재 상태 전체를 교체합니다. 복구 직전 상태는 SQLite recovery 테이블에 JSON으로 자동 보존됩니다. 실수한 복구를 되돌리려면 앱을 종료하고 DB 복사본을 만든 뒤 Node의 node:sqlite에서 `SELECT json FROM recovery ORDER BY id DESC LIMIT 1` 결과를 JSON 파일로 저장하여 UI에서 복구하세요. 앱 종료 후 DB 전체 파일 복사는 스냅샷 보관 방법입니다.

한 컴퓨터의 단일 운영자를 위한 파일럿입니다. 계정, 실시간 공동 편집, 공개 서비스 배포 및 운영 부하 보증은 포함하지 않습니다. 모바일 기능은 390px 브라우저 에뮬레이션으로 검증했습니다. 물리적 휴대폰 접속을 제공하지 않습니다. 테스트는 합성 데이터를 사용하며 사용자 데이터와 분리됩니다.
