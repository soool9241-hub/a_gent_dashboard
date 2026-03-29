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

        const lead = {
          name: name,
          company: name,
          phone: phone,
          address: item.roadAddress || item.address || null,
          website_url: link || null,
          website_status: siteStatus,
          business_unit: kw.unit,
          source: 'naver_map',
          need: need,
          score: score,
          customer_type: 'b2b',
          assigned_to: 'D-LEAD',
          interest: [kw.type],
          tags: [category, kw.type, priority, siteStatus, kw.zone + '권역'].filter(Boolean),
          notes: [
            '🏷️ 우선순위: ' + priority + ' | ' + kw.zone + '권역',
            '📌 업종: ' + (category || kw.type),
            '📞 전화: ' + (phone || '미등록'),
            '🌐 관리채널: ' + (link || '없음') + ' (' + siteStatus + ')',
            desc ? '📝 설명: ' + desc.replace(/<[^>]*>/g, '') : '',
            '📍 지번: ' + (item.address || '-'),
            '📍 도로명: ' + (item.roadAddress || '-'),
            mapUrl ? '🗺️ 지도: ' + mapUrl : '',
            '🔍 키워드: ' + kw.keyword,
            '📅 수집: ' + new Date().toISOString().split('T')[0]
          ].filter(Boolean).join('\n')
        };

        // 이름 없으면 스킵
        if (!name) continue;

        const result = await saveLead(lead);
        totalCollected++;
        if (Array.isArray(result) && result.length > 0) totalNew++;
        if (hasNoSite || isSNS || isBlog) noWebsite++;
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

    // 텔레그램 알림 (수집 결과가 있을 때만)
    if (totalCollected > 0) {
      const msg = '📡 *크롤링 완료*\n\n'
        + results.map(r => '🔍 ' + r.keyword + ': ' + r.items + '건').join('\n')
        + '\n\n📦 수집: ' + totalCollected + '건\n🆕 신규: ' + totalNew + '건\n🌐 홈페이지 없음: ' + noWebsite + '건';
      await sendTelegram(msg);
    }

    return res.json({ success: true, collected: totalCollected, new: totalNew, noWebsite, results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
