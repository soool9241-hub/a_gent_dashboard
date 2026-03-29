const https = require('https');

const SB_URL = (process.env.SUPABASE_URL || 'https://pcgzuvnvcxoobkcluksz.supabase.co').replace(/\/$/, '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const NAVER_ID = (process.env.NAVER_CLIENT_ID || '').trim();
const NAVER_SECRET = (process.env.NAVER_CLIENT_SECRET || '').trim();
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TG_CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim();

function httpReq(url, options, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opt = {
      hostname: u.hostname, path: u.pathname + u.search,
      method: options.method || 'GET', headers: options.headers || {}
    };
    const req = https.request(opt, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function searchNaver(keyword) {
  if (!NAVER_ID || !NAVER_SECRET) return [];
  const url = 'https://openapi.naver.com/v1/search/local.json?query=' + encodeURIComponent(keyword) + '&display=5&sort=random';
  const data = await httpReq(url, { headers: { 'X-Naver-Client-Id': NAVER_ID, 'X-Naver-Client-Secret': NAVER_SECRET } });
  return data.items || [];
}

async function searchBlogCount(name) {
  if (!NAVER_ID || !NAVER_SECRET || !name) return 0;
  const url = 'https://openapi.naver.com/v1/search/blog.json?query=' + encodeURIComponent(name) + '&display=1';
  const data = await httpReq(url, { headers: { 'X-Naver-Client-Id': NAVER_ID, 'X-Naver-Client-Secret': NAVER_SECRET } });
  return data.total || 0;
}

async function saveLead(lead) {
  return httpReq(SB_URL + '/rest/v1/leads', {
    method: 'POST',
    headers: {
      'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=ignore-duplicates-on-conflict,return=representation'
    }
  }, JSON.stringify(lead));
}

async function saveLog(log) {
  return httpReq(SB_URL + '/rest/v1/collection_logs', {
    method: 'POST',
    headers: {
      'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json'
    }
  }, JSON.stringify(log));
}

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  return httpReq('https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({ chat_id: TG_CHAT, text: text, parse_mode: 'Markdown' }));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SB_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  try {
    // 크롤링 키워드 목록
    const keywords = [
      // ── 1권역: 완주 (해월신왕길 92 기준 가장 가까운 곳) ──
      { keyword: '완주 펜션', unit: 'webdev', type: 'pension', zone: 1 },
      { keyword: '완주 글램핑', unit: 'webdev', type: 'glamping', zone: 1 },
      { keyword: '완주 캠핑장', unit: 'webdev', type: 'camping', zone: 1 },
      { keyword: '완주 독채', unit: 'webdev', type: 'private', zone: 1 },
      { keyword: '완주 게스트하우스', unit: 'webdev', type: 'guesthouse', zone: 1 },
      { keyword: '완주 한옥스테이', unit: 'webdev', type: 'hanok', zone: 1 },
      { keyword: '완주 숙박', unit: 'webdev', type: 'lodging', zone: 1 },
      { keyword: '완주 카라반', unit: 'webdev', type: 'caravan', zone: 1 },
      { keyword: '완주 민박', unit: 'webdev', type: 'minbak', zone: 1 },

      // ── 2권역: 전주 (차로 20~30분) ──
      { keyword: '전주 펜션', unit: 'webdev', type: 'pension', zone: 2 },
      { keyword: '전주 게스트하우스', unit: 'webdev', type: 'guesthouse', zone: 2 },
      { keyword: '전주 한옥스테이', unit: 'webdev', type: 'hanok', zone: 2 },
      { keyword: '전주 글램핑', unit: 'webdev', type: 'glamping', zone: 2 },
      { keyword: '전주 독채', unit: 'webdev', type: 'private', zone: 2 },
      { keyword: '전주 파티룸', unit: 'webdev', type: 'partyroom', zone: 2 },
      { keyword: '전주 숙박', unit: 'webdev', type: 'lodging', zone: 2 },
      { keyword: '전주 스튜디오', unit: 'webdev', type: 'studio', zone: 2 },
      { keyword: '전주 공유공간', unit: 'webdev', type: 'shared', zone: 2 },

      // ── 3권역: 김제·익산 (차로 40~50분) ──
      { keyword: '김제 펜션', unit: 'webdev', type: 'pension', zone: 3 },
      { keyword: '김제 글램핑', unit: 'webdev', type: 'glamping', zone: 3 },
      { keyword: '김제 숙박', unit: 'webdev', type: 'lodging', zone: 3 },
      { keyword: '익산 펜션', unit: 'webdev', type: 'pension', zone: 3 },
      { keyword: '익산 글램핑', unit: 'webdev', type: 'glamping', zone: 3 },
      { keyword: '익산 게스트하우스', unit: 'webdev', type: 'guesthouse', zone: 3 },
      { keyword: '익산 숙박', unit: 'webdev', type: 'lodging', zone: 3 },

      // ── 4권역: 군산·정읍·남원·무주·진안·장수 (차로 1시간+) ──
      { keyword: '군산 펜션', unit: 'webdev', type: 'pension', zone: 4 },
      { keyword: '군산 게스트하우스', unit: 'webdev', type: 'guesthouse', zone: 4 },
      { keyword: '군산 글램핑', unit: 'webdev', type: 'glamping', zone: 4 },
      { keyword: '정읍 펜션', unit: 'webdev', type: 'pension', zone: 4 },
      { keyword: '정읍 글램핑', unit: 'webdev', type: 'glamping', zone: 4 },
      { keyword: '남원 펜션', unit: 'webdev', type: 'pension', zone: 4 },
      { keyword: '남원 글램핑', unit: 'webdev', type: 'glamping', zone: 4 },
      { keyword: '무주 펜션', unit: 'webdev', type: 'pension', zone: 4 },
      { keyword: '무주 글램핑', unit: 'webdev', type: 'glamping', zone: 4 },
      { keyword: '진안 펜션', unit: 'webdev', type: 'pension', zone: 4 },
      { keyword: '장수 펜션', unit: 'webdev', type: 'pension', zone: 4 },

      // ── 5권역: 충남·전남 접경 (차로 1.5시간+) ──
      { keyword: '부안 펜션', unit: 'webdev', type: 'pension', zone: 5 },
      { keyword: '고창 펜션', unit: 'webdev', type: 'pension', zone: 5 },
      { keyword: '순창 펜션', unit: 'webdev', type: 'pension', zone: 5 },
      { keyword: '임실 펜션', unit: 'webdev', type: 'pension', zone: 5 },
      { keyword: '부안 글램핑', unit: 'webdev', type: 'glamping', zone: 5 },
      { keyword: '고창 글램핑', unit: 'webdev', type: 'glamping', zone: 5 },

      // ═══ B팀 CNC 스토리팜 — 간판/각인/소품 제작 의뢰 타겟 ═══
      // 새로 오픈하는 매장 (간판+인테리어소품 필요)
      { keyword: '전주 카페', unit: 'cnc', type: 'cafe', zone: 2, reason: '신규/리뉴얼 간판+메뉴보드+인테리어소품 제작 의뢰' },
      { keyword: '전주 식당', unit: 'cnc', type: 'restaurant', zone: 2, reason: '간판+메뉴판+인테리어 각인소품 제작 의뢰' },
      { keyword: '전주 베이커리', unit: 'cnc', type: 'bakery', zone: 2, reason: '감성간판+로고각인+디스플레이소품 제작 의뢰' },
      { keyword: '전주 네일샵', unit: 'cnc', type: 'nail', zone: 2, reason: '네온사인+인테리어소품+각인소품 제작 의뢰' },
      { keyword: '전주 꽃집', unit: 'cnc', type: 'flower', zone: 2, reason: '감성간판+우드사인+각인화분 제작 의뢰' },
      { keyword: '전주 소품샵', unit: 'cnc', type: 'shop', zone: 2, reason: '매장간판+디스플레이+각인소품 제작 의뢰' },
      // 인테리어/리모델링 (소품/사인 필요)
      { keyword: '전주 인테리어', unit: 'cnc', type: 'interior', zone: 2, reason: '인테리어소품/사인/각인물 납품처 확보' },
      { keyword: '전주 리모델링', unit: 'cnc', type: 'remodel', zone: 2, reason: '리모델링 시 간판교체+소품 제작 의뢰' },
      // 선물/기념품 수요
      { keyword: '전주 스튜디오', unit: 'cnc', type: 'studio', zone: 2, reason: '포토존사인+인테리어소품+각인액자 제작 의뢰' },
      { keyword: '전주 헬스장', unit: 'cnc', type: 'gym', zone: 2, reason: '간판+트로피/명패+인테리어사인 제작 의뢰' },
      // 완주 권역
      { keyword: '완주 카페', unit: 'cnc', type: 'cafe', zone: 1, reason: '신규/리뉴얼 간판+소품 제작 의뢰 (근거리)' },
      { keyword: '완주 식당', unit: 'cnc', type: 'restaurant', zone: 1, reason: '간판+메뉴판 제작 의뢰 (근거리)' },
      // 익산·김제 권역
      { keyword: '익산 카페', unit: 'cnc', type: 'cafe', zone: 3, reason: '간판+인테리어소품 제작 의뢰' },
      { keyword: '익산 식당', unit: 'cnc', type: 'restaurant', zone: 3, reason: '간판+메뉴판 제작 의뢰' },
      { keyword: '김제 카페', unit: 'cnc', type: 'cafe', zone: 3, reason: '간판+소품 제작 의뢰' },
      // 군산 권역
      { keyword: '군산 카페', unit: 'cnc', type: 'cafe', zone: 4, reason: '간판+인테리어소품 제작 의뢰' },
      { keyword: '군산 식당', unit: 'cnc', type: 'restaurant', zone: 4, reason: '간판+메뉴판 제작 의뢰' },
    ];

    // 매 실행마다 권역별 로테이션 (가까운 곳부터)
    const hour = new Date().getHours();
    const slot = hour % 5; // 0~4 슬롯
    // 슬롯별로 다른 권역 조합 실행
    const zoneSchedule = [
      [1, 2],    // 00시, 05시... → 완주+전주
      [1, 3],    // 01시, 06시... → 완주+김제익산
      [2, 4],    // 02시, 07시... → 전주+군산정읍남원
      [1, 5],    // 03시, 08시... → 완주+부안고창
      [3, 4, 5], // 04시, 09시... → 외곽 전체
    ];
    const activeZones = zoneSchedule[slot];
    const batch = keywords.filter(k => activeZones.includes(k.zone));

    let totalCollected = 0;
    let totalNew = 0;
    let noWebsite = 0;
    let hasPhone = 0;
    let hotLeads = 0;
    let topBlog = { name: '', count: 0 };
    let snsOnly = 0;
    const hotList = [];
    const results = [];

    for (const kw of batch) {
      const items = await searchNaver(kw.keyword);

      for (const item of items) {
        const name = (item.title || '').replace(/<[^>]*>/g, '');
        const link = (item.link || '').trim();
        const phone = item.telephone || null;
        const category = item.category || '';
        const desc = item.description || '';
        const mapUrl = item.mapUrl || '';

        // 홈페이지 상태 정밀 분류
        const isSNS = link && (link.includes('instagram.com') || link.includes('youtube.com') || link.includes('facebook.com') || link.includes('twitter.com'));
        const isBlog = link && (link.includes('blog.naver') || link.includes('blog.daum') || link.includes('tistory.com') || link.includes('brunch.co.kr'));
        const isSmartStore = link && (link.includes('smartstore.naver') || link.includes('booking.naver'));
        const hasRealSite = link && !isSNS && !isBlog && !isSmartStore;
        const hasNoSite = !link;

        // 사이트 상태
        const siteStatus = hasNoSite ? 'none'
          : isSNS ? 'sns_only'
          : isBlog ? 'blog_only'
          : isSmartStore ? 'smartstore'
          : 'exists';

        // 영업 중 판별 (전화번호 있으면 영업 중)
        const isActive = !!phone;

        // 스코어링: 영업중 + 홈페이지없음 = 최고점
        let score, need, priority;
        if (hasNoSite && isActive) {
          score = 35; need = '🔥🔥 [1순위] 영업중인데 홈페이지 없음!'; priority = '1순위';
        } else if (hasNoSite && !isActive) {
          score = 25; need = '🔥 홈페이지 없음 — 제작 제안'; priority = '1순위';
        } else if ((isSNS || isBlog) && isActive) {
          score = 25; need = '⚡ [1순위] SNS/블로그만 운영 — 전문 사이트 필요'; priority = '1순위';
        } else if ((isSNS || isBlog) && !isActive) {
          score = 15; need = '⚡ SNS/블로그만 — 전문 사이트 제안'; priority = '2순위';
        } else if (isSmartStore) {
          score = 10; need = '💡 스마트스토어만 — 자체 브랜드사이트 제안'; priority = '2순위';
        } else {
          score = 5; need = '🔄 [2순위] 기존 사이트 보유 — 리뉴얼 검토'; priority = '2순위';
        }

        // 블로그 리뷰 수 조회
        const blogCount = await searchBlogCount(name);
        // 블로그 리뷰 많으면 스코어 보너스 (인기 업체 = 투자 여력)
        if (blogCount >= 100) score += 15;
        else if (blogCount >= 30) score += 10;
        else if (blogCount >= 10) score += 5;

        const lead = {
          name: name,
          company: name,
          phone: phone,
          address: item.roadAddress || item.address || null,
          website_url: link || null,
          website_status: siteStatus,
          business_unit: kw.unit,
          source: 'naver_map',
          need: kw.unit === 'cnc' ? '🔧 ' + (kw.reason || '간판/소품 제작 제안 대상') : need,
          score: kw.unit === 'cnc' ? (isActive ? 20 : 10) + (blogCount >= 100 ? 15 : blogCount >= 30 ? 10 : blogCount >= 10 ? 5 : 0) : score,
          customer_type: 'b2b',
          assigned_to: kw.unit === 'cnc' ? 'B-LEAD' : 'D-LEAD',
          headcount: blogCount > 0 ? '블로그리뷰 ' + blogCount + '건' : null,
          interest: [kw.type],
          tags: [category, kw.type, priority, siteStatus, kw.zone + '권역', kw.unit === 'cnc' ? 'CNC타겟' : '', blogCount >= 30 ? '인기업체' : ''].filter(Boolean),
          notes: [
            '🏷️ 우선순위: ' + priority + ' | ' + kw.zone + '권역',
            '📌 업종: ' + (category || kw.type),
            kw.reason ? '🎯 타겟이유: ' + kw.reason : '',
            '📞 전화: ' + (phone || '미등록'),
            '📝 블로그 리뷰: ' + blogCount + '건' + (blogCount >= 30 ? ' ⭐인기!' : ''),
            '🌐 관리채널: ' + (link || '없음') + ' (' + siteStatus + ')',
            desc ? '📝 설명: ' + desc.replace(/<[^>]*>/g, '') : '',
            '📍 지번: ' + (item.address || '-'),
            '📍 도로명: ' + (item.roadAddress || '-'),
            mapUrl ? '🗺️ 지도: ' + mapUrl : '',
            '🔍 검색키워드: ' + kw.keyword,
            '📅 수집: ' + new Date().toISOString().split('T')[0]
          ].filter(Boolean).join('\n')
        };

        // 이름 없으면 스킵
        if (!name) continue;

        const result = await saveLead(lead);
        totalCollected++;
        if (Array.isArray(result) && result.length > 0) totalNew++;
        if (hasNoSite || isSNS || isBlog) noWebsite++;
        if (phone) hasPhone++;
        if (isSNS) snsOnly++;
        if (score >= 30) {
          hotLeads++;
          hotList.push({ name: name, score: score, blog: blogCount, site: siteStatus, phone: phone || '없음' });
        }
        if (blogCount > topBlog.count) topBlog = { name: name, count: blogCount };
      }

      results.push({ keyword: kw.keyword, unit: kw.unit, items: items.length });
    }

    // 수집 로그 저장
    await saveLog({
      business_unit: 'all',
      source: 'naver_map',
      keyword: batch.map(b => b.keyword).join(', '),
      region: '전주/완주',
      collected_count: totalCollected,
      new_count: totalNew,
      status: 'completed'
    });

    // DB 전체 현황 조회
    const allLeads = await httpReq(SB_URL + '/rest/v1/leads?select=name,score,website_status,headcount,phone&order=score.desc', {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }
    });
    const allArr = Array.isArray(allLeads) ? allLeads : [];
    const totalDB = allArr.length;
    const totalNoSite = allArr.filter(l => l.website_status === 'none' || l.website_status === 'sns_only' || l.website_status === 'blog_only').length;
    const totalHot = allArr.filter(l => l.score >= 30).length;
    const totalPhone = allArr.filter(l => l.phone).length;

    // 홈페이지 없는 곳 중 블로그리뷰 많은 순 TOP5
    const noSiteLeads = allArr
      .filter(l => l.website_status === 'none' || l.website_status === 'sns_only' || l.website_status === 'blog_only')
      .map(l => {
        const m = (l.headcount || '').match(/(\d+)/);
        return { name: l.name, blog: m ? parseInt(m[1]) : 0, phone: l.phone, score: l.score };
      })
      .sort((a, b) => b.blog - a.blog)
      .slice(0, 5);

    // 텔레그램 리포트
    if (totalCollected > 0) {
      let msg = '📡 *2시간 크롤링 리포트*\n';
      msg += new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + '\n\n';

      // 1. 전체 지표
      msg += '📊 *전체 현황*\n';
      msg += '총 누적: *' + totalDB + '건*\n';
      msg += '이번 수집: ' + totalCollected + '건 (신규 ' + totalNew + '건)\n';
      msg += '전화번호 확보: ' + totalPhone + '건 (' + Math.round(totalPhone/totalDB*100) + '%)\n\n';

      // 2. 홈페이지 없는 곳 지표
      msg += '🔥 *홈페이지 없는 곳 (영업대상)*\n';
      msg += '총: *' + totalNoSite + '건* (' + Math.round(totalNoSite/totalDB*100) + '%)\n';
      msg += 'Hot 리드(30점↑): *' + totalHot + '건*\n\n';

      // 3. 블로그리뷰 많은 순 TOP5
      if (noSiteLeads.length > 0) {
        msg += '⭐ *사이트없는데 인기있는 TOP5*\n';
        noSiteLeads.forEach((l, i) => {
          msg += (i+1) + '. *' + l.name + '*\n';
          msg += '   블로그 ' + l.blog + '건 | ' + l.score + '점 | 📞' + (l.phone || '없음') + '\n';
        });
      }

      await sendTelegram(msg);
    }

    return res.json({ success: true, collected: totalCollected, new: totalNew, noWebsite, hotLeads, totalDB, results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
