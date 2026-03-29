# 가망고객 수집 시스템 — 셋업 가이드

## 전체 구조

```
[n8n 워크플로우] ←→ [Supabase DB] ←→ [대시보드]
      ↓                                    ↑
[네이버 지도 API]                    [텔레그램 알림]
[인스타 크롤링]
[크몽/숨고 모니터링]
```

---

## Step 1. Supabase 테이블 생성 (5분)

1. https://supabase.com/dashboard 접속
2. 기존 프로젝트 `pcgzuvnvcxoobkcluksz` 선택 (또는 새 프로젝트 생성)
3. **SQL Editor** 클릭
4. `01_supabase_leads_schema.sql` 내용 전체 복사 → 붙여넣기 → **Run**
5. 결과: `✅ 가망고객 수집 스키마 생성 완료!` 확인

### 생성되는 테이블
| 테이블 | 용도 |
|--------|------|
| `leads` | 가망고객 메인 DB (이름/연락처/이메일/니즈/스코어) |
| `lead_interactions` | 상호작용 로그 (DM/전화/방문/구매) |
| `nurture_sequences` | 팔로업 메시지 템플릿 |
| `collection_logs` | 크롤링 수집 기록 |

---

## Step 2. n8n 설치 (10분)

### 옵션 A: Docker (추천 — 로컬 서버)
```bash
cd infra
docker-compose up -d
```
→ http://localhost:5678 접속
→ ID: `admin` / PW: `changeme123!`

### 옵션 B: n8n Cloud (가장 쉬움)
1. https://n8n.io 가입
2. 무료 플랜으로 시작 (월 5개 워크플로우)
3. 워크플로우 임포트

### 옵션 C: Railway/Render 배포 (무료 서버)
```bash
# Railway
railway init
railway add n8n
railway up
```

---

## Step 3. API 키 준비

### 필수
| 서비스 | 키 | 발급처 |
|--------|-----|--------|
| Supabase URL | `SUPABASE_URL` | 프로젝트 Settings → API |
| Supabase Key | `SUPABASE_KEY` | **service_role key** (anon 아님!) |

### 선택 (있으면 더 강력)
| 서비스 | 키 | 발급처 |
|--------|-----|--------|
| 네이버 검색 API | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | https://developers.naver.com |
| 텔레그램 봇 | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | @BotFather |

### 네이버 검색 API 발급 (3분)
1. https://developers.naver.com/apps 접속
2. 애플리케이션 등록 → API: **검색** 선택
3. Client ID + Secret 복사

### 텔레그램 봇 생성 (3분)
1. 텔레그램에서 @BotFather 검색
2. `/newbot` → 이름 입력 → 토큰 받기
3. 봇에게 아무 메시지 보낸 후
4. `https://api.telegram.org/bot{TOKEN}/getUpdates` → chat_id 확인

---

## Step 4. n8n 워크플로우 임포트 (5분)

1. n8n 접속 → **Settings** → **Import from file**
2. 순서대로 임포트:

| 파일 | 역할 | 실행 주기 |
|------|------|----------|
| `WF-01_lead_collection.json` | 리드 수집 Webhook | 실시간 (외부 호출 시) |
| `WF-02_naver_map_crawler.json` | 네이버지도 매장 크롤링 | 6시간마다 자동 |
| `WF-03_daily_report.json` | 일일 수집 리포트 | 매일 20:00 |
| `WF-04_nurture_sequence.json` | 자동 팔로업 | 매일 09:00 |
| `WF-05_weekly_excel_report.json` | 주간 엑셀 보고서 | 매주 월 09:00 |

3. 각 워크플로우에서 **환경변수** 설정:
   - n8n Settings → Variables → 위의 API 키들 입력
4. 각 워크플로우 **Active** 토글 ON

---

## Step 5. 동작 확인

### 테스트 1: 리드 수집 Webhook
```bash
curl -X POST http://localhost:5678/webhook/lead-collect \
  -H "Content-Type: application/json" \
  -d '{
    "name": "테스트 고객",
    "phone": "010-1234-5678",
    "email": "test@test.com",
    "company": "테스트카페",
    "business_unit": "webdev",
    "source": "manual",
    "need": "홈페이지 제작 필요",
    "score": 60
  }'
```
→ Supabase `leads` 테이블에 데이터 추가 확인
→ score 50+ → 텔레그램 Hot 리드 알림 수신 확인

### 테스트 2: 네이버 지도 크롤링
- WF-02 수동 실행 (Test workflow 버튼)
- Supabase에 전주 매장 데이터 추가 확인

### 테스트 3: 리포트
- WF-03 수동 실행
- 텔레그램에서 일일 리포트 수신 확인

---

## Step 6. 대시보드 연동 (선택)

대시보드에서 실시간 리드 현황을 보려면:
- Supabase leads 테이블을 대시보드 API로 연동
- 각 LEAD 에이전트 카드에 실시간 수집 수 표시

---

## 수집 데이터 확인 방법

| 방법 | 접근 |
|------|------|
| **Supabase 대시보드** | Table Editor → leads 테이블 직접 확인 |
| **텔레그램 알림** | Hot 리드 즉시 + 일일/주간 리포트 자동 수신 |
| **CSV 다운로드** | Supabase → leads → Export CSV |
| **n8n 실행 로그** | n8n → Executions → 각 워크플로우 실행 이력 |

---

## 트러블슈팅

| 문제 | 해결 |
|------|------|
| 네이버 API 429 (Too Many Requests) | 크롤링 간격 늘리기 (6시간 → 12시간) |
| Supabase 중복 에러 | 정상 — unique index가 중복 방지 중 |
| 텔레그램 알림 안 옴 | BOT_TOKEN, CHAT_ID 확인 |
| n8n 메모리 부족 | Docker memory limit 늘리기 |
