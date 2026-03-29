const https = require('https');

const SB_URL = (process.env.SUPABASE_URL || 'https://pcgzuvnvcxoobkcluksz.supabase.co').replace(/\/$/, '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();

function sbFetch(path, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(SB_URL + '/rest/v1/' + path);
    const options = {
      method: method || 'GET',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': method === 'POST' ? 'return=representation,resolution=ignore-duplicates-on-conflict' : 'return=representation'
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SB_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  try {
    // GET: 리드 조회
    if (req.method === 'GET') {
      const { action, unit, stage, limit: lim } = req.query;

      if (action === 'summary') {
        // 전체 요약
        const leads = await sbFetch('leads?select=business_unit,stage,score,source&order=created_at.desc');
        const arr = Array.isArray(leads) ? leads : [];
        const byUnit = {}, byStage = {}, bySource = {};
        arr.forEach(l => {
          byUnit[l.business_unit] = (byUnit[l.business_unit] || 0) + 1;
          byStage[l.stage || 'cold'] = (byStage[l.stage] || 0) + 1;
          bySource[l.source || 'unknown'] = (bySource[l.source] || 0) + 1;
        });
        const hot = arr.filter(l => l.score >= 50).length;
        return res.json({ total: arr.length, hot, byUnit, byStage, bySource });
      }

      if (action === 'hot') {
        const leads = await sbFetch('leads?score=gte.50&select=*&order=score.desc&limit=' + (lim || 20));
        return res.json(Array.isArray(leads) ? leads : []);
      }

      if (action === 'today') {
        const today = new Date().toISOString().split('T')[0];
        const leads = await sbFetch('leads?created_at=gte.' + today + 'T00:00:00&select=*&order=score.desc');
        return res.json(Array.isArray(leads) ? leads : []);
      }

      if (action === 'csv') {
        const leads = await sbFetch('leads?select=*&order=business_unit,score.desc');
        const arr = Array.isArray(leads) ? leads : [];
        const units = { pension: 'A-달팽이아지트', cnc: 'B-스토리팜', automation: 'C-AI자동화', webdev: 'D-웹개발' };
        const BOM = '\uFEFF';
        const headers = ['No','이름','전화번호','이메일','상호명','주소','사업부','출처','니즈','등급','스코어','웹사이트','수집일'];
        let csv = BOM + headers.join(',') + '\n';
        arr.forEach((l, i) => {
          const row = [
            i+1, l.name||'', l.phone||'', l.email||'', l.company||'', l.address||'',
            units[l.business_unit]||l.business_unit||'', l.source||'', l.need||'',
            l.grade||'', l.score||0, l.website_url||'',
            l.created_at ? l.created_at.split('T')[0] : ''
          ].map(v => '"' + String(v).replace(/"/g, '""') + '"');
          csv += row.join(',') + '\n';
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=leads_' + new Date().toISOString().split('T')[0] + '.csv');
        return res.send(csv);
      }

      // 기본: 전체 조회
      let query = 'leads?select=*&order=created_at.desc&limit=' + (lim || 100);
      if (unit) query += '&business_unit=eq.' + unit;
      if (stage) query += '&stage=eq.' + stage;
      const leads = await sbFetch(query);
      return res.json(Array.isArray(leads) ? leads : []);
    }

    // POST: 리드 추가
    if (req.method === 'POST') {
      const lead = req.body;
      if (!lead.business_unit) return res.status(400).json({ error: 'business_unit required' });
      const result = await sbFetch('leads', 'POST', lead);
      return res.json({ success: true, data: result });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
