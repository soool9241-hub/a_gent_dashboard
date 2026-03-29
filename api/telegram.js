const https = require('https');

const SB_URL = (process.env.SUPABASE_URL || 'https://pcgzuvnvcxoobkcluksz.supabase.co').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';

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

function sbFetch(path) {
  return httpReq(SB_URL + '/rest/v1/' + path, {
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }
  });
}

async function sendTG(chatId, text, opts) {
  const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (opts) Object.assign(payload, opts);
  return httpReq('https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify(payload));
}

async function sendDocument(chatId, filename, content) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now();
    const body = Buffer.concat([
      Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="chat_id"\r\n\r\n' + chatId + '\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="document"; filename="' + filename + '"\r\n' +
        'Content-Type: text/csv\r\n\r\n'
      ),
      Buffer.from(content, 'utf-8'),
      Buffer.from('\r\n--' + boundary + '--\r\n')
    ]);
    const u = new URL('https://api.telegram.org/bot' + TG_TOKEN + '/sendDocument');
    const req = https.request({
      hostname: u.hostname, path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// CSV 생성 헬퍼
function leadsToCSV(leads) {
  const units = { pension: 'A-달팽이아지트', cnc: 'B-스토리팜', automation: 'C-AI자동화', webdev: 'D-웹개발' };
  const BOM = '\uFEFF';
  const headers = ['No','이름','전화번호','상호명','주소','사업부','출처','니즈','등급','스코어','웹사이트','수집일'];
  let csv = BOM + headers.join(',') + '\n';
  leads.forEach((l, i) => {
    const row = [
      i+1, l.name||'', l.phone||'', l.company||'', l.address||'',
      units[l.business_unit]||l.business_unit||'', l.source||'', l.need||'',
      l.grade||'', l.score||0, l.website_url||'',
      l.created_at ? l.created_at.split('T')[0] : ''
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"');
    csv += row.join(',') + '\n';
  });
  return csv;
}

// 명령어 처리
async function handleCommand(chatId, text) {
  const cmd = text.trim();

  // /현황 — 전체 요약
  if (cmd === '/현황' || cmd === '/status' || cmd === '/start') {
    const leads = await sbFetch('leads?select=business_unit,stage,score,source&order=created_at.desc');
    const arr = Array.isArray(leads) ? leads : [];
    if (arr.length === 0) return sendTG(chatId, '📊 아직 수집된 가망고객이 없습니다.\n크롤링을 먼저 실행해주세요.');

    const byUnit = {};
    arr.forEach(l => { byUnit[l.business_unit] = (byUnit[l.business_unit] || 0) + 1; });
    const hot = arr.filter(l => l.score >= 50).length;
    const warm = arr.filter(l => l.score >= 20 && l.score < 50).length;
    const cold = arr.filter(l => l.score < 20).length;

    const unitNames = { pension: '🏡A-펜션', cnc: '🔧B-CNC', automation: '🤖C-자동화', webdev: '💻D-웹개발' };
    let msg = '📊 *가망고객 현황*\n\n';
    msg += '총 *' + arr.length + '명*\n';
    msg += '🔥 Hot: ' + hot + '명 | 🟡 Warm: ' + warm + '명 | 🔵 Cold: ' + cold + '명\n\n';
    msg += '*사업부별:*\n';
    Object.keys(byUnit).forEach(u => {
      msg += (unitNames[u] || u) + ': ' + byUnit[u] + '명\n';
    });
    msg += '\n📌 명령어:\n/hot — 핫 리드\n/오늘 — 오늘 수집\n/csv — 엑셀 다운로드';
    return sendTG(chatId, msg);
  }

  // /hot — 핫 리드 목록
  if (cmd === '/hot') {
    const leads = await sbFetch('leads?score=gte.50&select=name,phone,company,score,business_unit,need&order=score.desc&limit=10');
    const arr = Array.isArray(leads) ? leads : [];
    if (arr.length === 0) return sendTG(chatId, '🔥 핫 리드가 아직 없습니다.');

    let msg = '🔥 *핫 리드 TOP ' + arr.length + '*\n\n';
    arr.forEach((l, i) => {
      msg += (i+1) + '. *' + (l.name || l.company || '?') + '* (점수: ' + l.score + ')\n';
      msg += '   📞 ' + (l.phone || '없음') + '\n';
      msg += '   💡 ' + (l.need || '-') + '\n\n';
    });
    return sendTG(chatId, msg);
  }

  // /오늘 — 오늘 수집된 리드
  if (cmd === '/오늘' || cmd === '/today') {
    const today = new Date().toISOString().split('T')[0];
    const leads = await sbFetch('leads?created_at=gte.' + today + 'T00:00:00&select=name,phone,company,score,business_unit,source&order=score.desc');
    const arr = Array.isArray(leads) ? leads : [];
    if (arr.length === 0) return sendTG(chatId, '📅 오늘 수집된 가망고객이 없습니다.');

    let msg = '📅 *오늘 수집: ' + arr.length + '건*\n\n';
    const unitNames = { pension: '🏡A', cnc: '🔧B', automation: '🤖C', webdev: '💻D' };
    arr.slice(0, 15).forEach((l, i) => {
      msg += (i+1) + '. ' + (unitNames[l.business_unit] || '') + ' *' + (l.name || l.company || '?') + '* (' + l.score + '점)\n';
      msg += '   📞 ' + (l.phone || '-') + ' | ' + (l.source || '') + '\n';
    });
    if (arr.length > 15) msg += '\n... 외 ' + (arr.length - 15) + '건';
    return sendTG(chatId, msg);
  }

  // /csv — CSV 파일 전송
  if (cmd === '/csv' || cmd === '/엑셀') {
    const leads = await sbFetch('leads?select=*&order=business_unit,score.desc');
    const arr = Array.isArray(leads) ? leads : [];
    if (arr.length === 0) return sendTG(chatId, '📋 다운로드할 데이터가 없습니다.');

    const csv = leadsToCSV(arr);
    const filename = 'leads_' + new Date().toISOString().split('T')[0] + '.csv';
    await sendDocument(chatId, filename, csv);
    return sendTG(chatId, '📋 *' + arr.length + '건* 데이터를 전송했습니다.');
  }

  // /수집 — 수동 크롤링 트리거
  if (cmd === '/수집' || cmd === '/crawl') {
    await sendTG(chatId, '🔄 크롤링을 시작합니다... 잠시 기다려주세요.');
    try {
      const host = process.env.VERCEL_URL || 'imsol-dashboard.vercel.app';
      const result = await httpReq('https://' + host + '/api/crawl', {});
      if (result.success) {
        return sendTG(chatId, '✅ 크롤링 완료!\n📦 수집: ' + result.collected + '건\n🆕 신규: ' + (result.new || 0) + '건');
      } else {
        return sendTG(chatId, '❌ 크롤링 오류: ' + (result.error || 'unknown'));
      }
    } catch(e) {
      return sendTG(chatId, '❌ 크롤링 실패: ' + e.message);
    }
  }

  // /도움 — 도움말
  if (cmd === '/도움' || cmd === '/help') {
    return sendTG(chatId,
      '🤖 *가망고객 수집봇 명령어*\n\n' +
      '/현황 — 전체 현황 요약\n' +
      '/hot — 핫 리드 목록\n' +
      '/오늘 — 오늘 수집 리드\n' +
      '/csv — CSV 파일 다운로드\n' +
      '/수집 — 수동 크롤링 실행\n' +
      '/도움 — 이 도움말'
    );
  }

  // 기본 응답
  return sendTG(chatId,
    '안녕하세요! 가망고객 수집봇입니다 🤖\n/도움 을 입력하면 명령어를 확인할 수 있습니다.'
  );
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: 웹훅 상태 확인
  if (req.method === 'GET') {
    return res.json({ status: 'Telegram bot webhook active', commands: ['/현황', '/hot', '/오늘', '/csv', '/수집', '/도움'] });
  }

  // POST: 텔레그램 웹훅
  if (req.method === 'POST') {
    try {
      const update = req.body;
      if (!update || !update.message || !update.message.text) {
        return res.json({ ok: true });
      }

      const chatId = update.message.chat.id;
      const text = update.message.text;

      await handleCommand(String(chatId), text);
      return res.json({ ok: true });
    } catch(e) {
      console.error('Telegram webhook error:', e);
      return res.json({ ok: true, error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
