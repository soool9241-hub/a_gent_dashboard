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
      // A팀 - 달팽이아지트 (펜션 숙박 판매 → 단체/기업/여행사가 가망고객)
      { keyword: '전주 여행사', unit: 'pension', type: 'travel' },
      { keyword: '전주 기업연수', unit: 'pension', type: 'corporate' },
      { keyword: '전주 단체숙박', unit: 'pension', type: 'group' },
      { keyword: '전주 웨딩플래너', unit: 'pension', type: 'wedding' },
      { keyword: '전주 동호회', unit: 'pension', type: 'club' },
      { keyword: '완주 워크숍', unit: 'pension', type: 'workshop' },

      // B팀 - 스토리팜 (간판/각인/CNC제작 → 새 매장/카페/식당이 가망고객)
      { keyword: '전주 카페', unit: 'cnc', type: 'cafe' },
      { keyword: '전주 신규오픈', unit: 'cnc', type: 'newopen' },
      { keyword: '전주 식당', unit: 'cnc', type: 'restaurant' },
      { keyword: '전주 네일샵', unit: 'cnc', type: 'nail' },
      { keyword: '전주 베이커리', unit: 'cnc', type: 'bakery' },
      { keyword: '전주 소품샵', unit: 'cnc', type: 'shop' },

      // C팀 - AI자동화 (마케팅자동화 판매 → SNS/마케팅 고민 소상공인이 가망고객)
      { keyword: '전주 소상공인', unit: 'automation', type: 'small_biz' },
      { keyword: '전주 창업', unit: 'automation', type: 'startup' },
      { keyword: '전주 쇼핑몰', unit: 'automation', type: 'shop' },
      { keyword: '전주 반영구', unit: 'automation', type: 'beauty' },
      { keyword: '전주 필라테스', unit: 'automation', type: 'pilates' },
      { keyword: '전주 네일아트', unit: 'automation', type: 'nail' },

      // D팀 - 웹개발 (홈페이지 제작 → 홈페이지 없는 업체가 가망고객)
      { keyword: '전주 미용실', unit: 'webdev', type: 'beauty' },
      { keyword: '전주 학원', unit: 'webdev', type: 'academy' },
      { keyword: '전주 병원', unit: 'webdev', type: 'hospital' },
      { keyword: '전주 치과', unit: 'webdev', type: 'dental' },
      { keyword: '전주 헬스장', unit: 'webdev', type: 'gym' },
      { keyword: '전주 부동산', unit: 'webdev', type: 'realestate' },
      { keyword: '전주 세무사', unit: 'webdev', type: 'tax' },
      { keyword: '전주 법무사', unit: 'webdev', type: 'legal' },
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
        const hasWeb = item.link && item.link.trim() !== '';
        const lead = {
          name: name,
          company: name,
          phone: item.telephone || null,
          address: item.roadAddress || item.address || null,
          website_url: item.link || null,
          website_status: hasWeb ? 'exists' : 'none',
          business_unit: kw.unit,
          source: 'naver_map',
          need: kw.unit === 'pension' ? '단체숙박/워크숍 유치 대상'
              : kw.unit === 'cnc' ? '간판/인테리어소품 제작 제안 대상'
              : kw.unit === 'automation' ? (hasWeb ? 'SNS/마케팅 자동화 제안' : 'SNS+홈페이지 패키지 제안')
              : (hasWeb ? '홈페이지 리뉴얼 검토' : '홈페이지 없음 - 제작 필요'),
          score: kw.unit === 'pension' ? 15
              : kw.unit === 'cnc' ? 15
              : hasWeb ? 5 : 20,
          customer_type: kw.unit === 'pension' ? 'b2b' : 'b2c',
          assigned_to: kw.unit === 'webdev' ? 'D-LEAD' : kw.unit === 'pension' ? 'A-LEAD' : kw.unit === 'automation' ? 'C-LEAD' : 'B-LEAD'
        };

        // 이름 없으면 스킵
        if (!name) continue;

        const result = await saveLead(lead);
        totalCollected++;
        if (Array.isArray(result) && result.length > 0) totalNew++;
        if (!hasWeb) noWebsite++;
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
