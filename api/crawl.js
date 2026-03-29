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
      { keyword: '전주 카페', unit: 'webdev', type: 'cafe' },
      { keyword: '전주 음식점', unit: 'webdev', type: 'restaurant' },
      { keyword: '전주 미용실', unit: 'webdev', type: 'beauty' },
      { keyword: '전주 학원', unit: 'webdev', type: 'academy' },
      { keyword: '전주 병원', unit: 'webdev', type: 'hospital' },
      { keyword: '완주 펜션', unit: 'pension', type: 'pension' },
      { keyword: '전주 펜션', unit: 'pension', type: 'pension' },
      { keyword: '전주 인테리어', unit: 'cnc', type: 'interior' },
      { keyword: '전주 간판', unit: 'cnc', type: 'sign' },
      { keyword: '전주 공방', unit: 'cnc', type: 'workshop' },
    ];

    // 매 실행마다 2~3개 키워드 로테이션
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
          need: hasWeb ? '리뉴얼 검토 대상' : '홈페이지 없음 - 제작 필요',
          score: hasWeb ? 5 : 20,
          customer_type: 'b2c',
          assigned_to: kw.unit === 'webdev' ? 'D-LEAD' : kw.unit === 'pension' ? 'A-LEAD' : 'B-LEAD'
        };

        // 전화번호 없으면 스킵
        if (!lead.phone) continue;

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
