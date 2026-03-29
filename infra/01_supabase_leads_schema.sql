-- =============================================
-- 가망고객 수집 시스템 — Supabase 스키마
-- Supabase SQL Editor에서 실행하세요
-- =============================================

-- 1. 가망고객 메인 테이블
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- 기본 정보
  name TEXT,
  phone TEXT,
  email TEXT,
  company TEXT,              -- 상호명/소속
  position TEXT,             -- 직함 (대표, HR담당, 총무 등)
  address TEXT,              -- 주소

  -- 분류
  business_unit TEXT NOT NULL,  -- 'pension'(A), 'cnc'(B), 'automation'(C), 'webdev'(D)
  source TEXT,                  -- 'naver_map', 'instagram', 'kmong', 'danggeun', 'blog', 'referral', 'manual'
  interest TEXT[],              -- ['워크숍','가족여행'] / ['간판','키링'] / ['SNS자동화'] / ['홈페이지']
  customer_type TEXT,           -- 'b2b', 'b2c', 'enterprise'

  -- 리드 스코어링
  stage TEXT DEFAULT 'cold',    -- 'cold' → 'warm' → 'hot' → 'customer' → 'fan'
  score INTEGER DEFAULT 0,
  grade TEXT DEFAULT 'D',       -- 'A'(hot), 'B'(warm), 'C'(cold), 'D'(long-term)

  -- 고객 상세
  need TEXT,                    -- 용도/니즈 상세
  budget_range TEXT,            -- 예산 범위
  urgency TEXT,                 -- '즉시', '1개월내', '3개월내', '미정'
  headcount TEXT,               -- 예상 인원/수량

  -- 웹개발 전용 (D팀)
  website_url TEXT,             -- 기존 홈페이지 URL
  website_status TEXT,          -- 'none', 'outdated', 'no_mobile', 'no_ssl', 'ok'
  diagnosis_score INTEGER,      -- 자동 진단 점수 (0~100)

  -- 추적
  first_contact_date DATE,
  last_contact_date DATE,
  contact_count INTEGER DEFAULT 0,
  notes TEXT,
  tags TEXT[],

  -- 자동화
  nurture_sequence TEXT,        -- 현재 시퀀스명
  nurture_step INTEGER DEFAULT 0,
  next_action TEXT,
  next_action_date DATE,
  lead_magnet_received TEXT,
  assigned_to TEXT,             -- 담당 에이전트 코드

  -- 소개
  referred_by UUID REFERENCES leads(id),
  referral_count INTEGER DEFAULT 0
);

-- 2. 상호작용 로그
CREATE TABLE IF NOT EXISTS lead_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  type TEXT NOT NULL,           -- 'dm', 'comment', 'call', 'visit', 'email', 'purchase', 'review', 'referral'
  channel TEXT,                 -- 'instagram', 'kakao', 'blog', 'phone', 'kmong', 'naver', 'offline'
  content TEXT,
  sentiment TEXT,               -- 'positive', 'neutral', 'negative'
  score_change INTEGER DEFAULT 0,
  auto_generated BOOLEAN DEFAULT false
);

-- 3. 너처링 시퀀스 템플릿
CREATE TABLE IF NOT EXISTS nurture_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit TEXT NOT NULL,
  name TEXT NOT NULL,           -- 'pension_family', 'cnc_cafe', 'webdev_no_site'
  step INTEGER NOT NULL,        -- 0, 1, 3, 5, 7, 14, 30
  delay_days INTEGER NOT NULL,
  channel TEXT NOT NULL,        -- 'kakao', 'sms', 'email'
  message_template TEXT NOT NULL,
  active BOOLEAN DEFAULT true
);

-- 4. 수집 작업 로그 (크롤링 기록)
CREATE TABLE IF NOT EXISTS collection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  business_unit TEXT NOT NULL,
  source TEXT NOT NULL,
  keyword TEXT,
  region TEXT,
  collected_count INTEGER DEFAULT 0,
  new_count INTEGER DEFAULT 0,       -- 중복 제거 후 신규
  duplicate_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed',   -- 'running', 'completed', 'failed'
  details JSONB
);

-- 5. 인덱스
CREATE INDEX IF NOT EXISTS idx_leads_business_unit ON leads(business_unit);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_grade ON leads(grade);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_next_action ON leads(next_action_date);
CREATE INDEX IF NOT EXISTS idx_interactions_lead ON lead_interactions(lead_id);
CREATE INDEX IF NOT EXISTS idx_interactions_created ON lead_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_logs_unit ON collection_logs(business_unit);

-- 6. 중복 방지 (이름+전화 또는 상호+전화)
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_dedup_phone
  ON leads(phone, business_unit) WHERE phone IS NOT NULL AND phone != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_dedup_email
  ON leads(email, business_unit) WHERE email IS NOT NULL AND email != '';

-- 7. 자동 updated_at 트리거
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS leads_updated_at ON leads;
CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- 8. 리드 스코어 → 등급 자동 분류 함수
CREATE OR REPLACE FUNCTION update_lead_grade()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.score >= 150 THEN
    NEW.stage = 'fan'; NEW.grade = 'A';
  ELSIF NEW.score >= 100 THEN
    NEW.stage = 'customer'; NEW.grade = 'A';
  ELSIF NEW.score >= 50 THEN
    NEW.stage = 'hot'; NEW.grade = 'A';
  ELSIF NEW.score >= 20 THEN
    NEW.stage = 'warm'; NEW.grade = 'B';
  ELSE
    NEW.stage = 'cold'; NEW.grade = 'C';
  END IF;
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS leads_auto_grade ON leads;
CREATE TRIGGER leads_auto_grade
  BEFORE INSERT OR UPDATE OF score ON leads
  FOR EACH ROW EXECUTE FUNCTION update_lead_grade();

-- 9. RLS (Row Level Security) — API 키로 접근 허용
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nurture_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_logs ENABLE ROW LEVEL SECURITY;

-- anon/service_role 모두 접근 허용 (내부 시스템용)
CREATE POLICY "Allow all for anon" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON lead_interactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON nurture_sequences FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON collection_logs FOR ALL USING (true) WITH CHECK (true);

-- 10. 기본 너처링 시퀀스 삽입 (펜션 예시)
INSERT INTO nurture_sequences (business_unit, name, step, delay_days, channel, message_template) VALUES
  ('pension', 'default', 0, 0, 'kakao', '안녕하세요! 요청하신 완주 여행 가이드 보내드립니다 🐌\n좋은 여행 되시길 바랍니다!'),
  ('pension', 'default', 1, 1, 'kakao', '완주 맛집 TOP5 추가 꿀팁 드려요!\n{{tip_content}}'),
  ('pension', 'default', 2, 3, 'kakao', '지난 달 방문하신 {{reviewer_name}}님 후기 공유드려요 ⭐\n{{review_content}}'),
  ('pension', 'default', 3, 5, 'kakao', '혹시 날짜 정하셨나요?\n성수기 전 얼리버드 할인 안내드려요! 🎁'),
  ('pension', 'default', 4, 7, 'kakao', '무료 전화상담 10분, 맞춤 패키지 안내해드릴까요?\n📞 전화 / 💬 카톡 중 편한 방법 알려주세요!'),
  ('pension', 'default', 5, 14, 'kakao', '필요하실 때 언제든 연락주세요! 🐌\n달팽이아지트가 항상 기다리고 있습니다.');

-- 완료 메시지
SELECT '✅ 가망고객 수집 스키마 생성 완료! 테이블 4개 + 인덱스 + 트리거 + RLS + 기본 시퀀스' AS result;
