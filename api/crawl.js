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
      // 공간 운영자 타겟 — 펜션 홈페이지 제작 상품 판매용
      // 기존 펜션/숙박 운영자 (홈페이지 없거나 허접한 곳)
      { keyword: '전주 펜션', unit: 'webdev', type: 'pension' },
      { keyword: '완주 펜션', unit: 'webdev', type: 'pension' },
      { keyword: '전주 게스트하우스', unit: 'webdev', type: 'guesthouse' },
      { keyword: '완주 게스트하우스', unit: 'webdev', type: 'guesthouse' },
      { keyword: '전주 한옥스테이', unit: 'webdev', type: 'hanok' },
      { keyword: '완주 한옥스테이', unit: 'webdev', type: 'hanok' },
      // 글램핑/캠핑 운영자
      { keyword: '전주 글램핑', unit: 'webdev', type: 'glamping' },
      { keyword: '완주 글램핑', unit: 'webdev', type: 'glamping' },
      { keyword: '전주 캠핑장', unit: 'webdev', type: 'camping' },
      { keyword: '완주 캠핑장', unit: 'webdev', type: 'camping' },
      // 독채/파티룸/공유공간 운영자
      { keyword: '전주 독채', unit: 'webdev', type: 'private' },
      { keyword: '완주 독채', unit: 'webdev', type: 'private' },
      { keyword: '전주 파티룸', unit: 'webdev', type: 'partyroom' },
      { keyword: '전주 스튜디오', unit: 'webdev', type: 'studio' },
      // 숙박/민박/카라반
      { keyword: '전주 숙박', unit: 'webdev', type: 'lodging' },
      { keyword: '완주 숙박', unit: 'webdev', type: 'lodging' },
      { keyword: '전주 민박', unit: 'webdev', type: 'minbak' },
      { keyword: '전주 카라반', unit: 'webdev', type: 'caravan' },
      // 공유/복합 공간
      { keyword: '전주 공유공간', unit: 'webdev', type: 'shared' },
      { keyword: '전주 코워킹스페이스', unit: 'webdev', type: 'cowork' },
    ];

    // 매 실행마다 6~7개 키워드 로테이션 (사업부 골고루)
    const hour = new Date().getHours();
    const batch = keywords.filter((_, i) => i % 4 === (hour % 4));

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
          tags: [category, kw.type, priority, siteStatus].filter(Boolean),
          notes: [
            '🏷️ 우선순위: ' + priority,
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
