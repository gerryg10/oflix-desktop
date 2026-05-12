export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query;
  if (!query || Object.keys(query).length === 0) {
    return res.status(400).json({ success: false, error: 'No parameters' });
  }

  const action = query.action || '';
  const WORKER = 'https://json.oflix.workers.dev';
  const OE_KEY = 'oFl1x_2026_sEcReT_kEy!@#';

  const categorySearch = {
    'indonesian-movies': { keyword: 'indonesia', subjectType: 1 },
    'indonesian-drama': { keyword: 'indonesia', subjectType: 2 },
    'kdrama': { keyword: 'korean drama', subjectType: 2 },
    'anime': { keyword: 'anime', subjectType: 2 },
    'western-tv': { keyword: 'american tv series', subjectType: 2 },
    'short-tv': { keyword: 'chinese drama', subjectType: 2 },
  };

  let workerUrl = '';

  switch (action) {
    case 'search':
      const q = encodeURIComponent(query.q || '');
      const pSearch = query.page || 1;
      workerUrl = `${WORKER}/api/search?keyword=${q}&page=${pSearch}`;
      break;
    case 'detail':
      const dp = encodeURIComponent(query.detailPath || '');
      workerUrl = `${WORKER}/api/detail?path=${dp}`;
      break;
    case 'trending':
    case 'populer':
    case 'latest':
    case 'terbaru':
      workerUrl = `${WORKER}/api/home`;
      break;
    default:
      if (categorySearch[action]) {
        const cat = categorySearch[action];
        const pCat = query.page || 1;
        workerUrl = `${WORKER}/api/search?keyword=${encodeURIComponent(cat.keyword)}&page=${pCat}&subjectType=${cat.subjectType}`;
      } else {
        workerUrl = `${WORKER}/api/home`;
      }
      break;
  }

  try {
    const response = await fetch(workerUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-OE': '1',
      },
    });

    if (!response.ok) {
      return res.status(502).json({ success: false, error: 'Worker fetch failed', http_code: response.status });
    }

    let text = await response.text();
    let jsonString = text;

    // Decrypt if encrypted
    if (text && !text.startsWith('{') && !text.startsWith('[')) {
      try {
        const decoded = Buffer.from(text, 'base64');
        const keyBuffer = Buffer.from(OE_KEY, 'utf-8');
        let decrypted = Buffer.alloc(decoded.length);

        for (let i = 0; i < decoded.length; i++) {
          decrypted[i] = decoded[i] ^ keyBuffer[i % keyBuffer.length];
        }
        jsonString = decrypted.toString('utf-8');
      } catch (e) {
        console.error('Decryption error:', e);
      }
    }

    const data = JSON.parse(jsonString);

    let output = {};
    if (action === 'detail') {
      output = { success: true, data: data.data || data };
    } else {
      output = { success: true, items: data.data || [] };
    }

    // Set Cache-Control header for Edge Caching
    const cacheTTL = action === 'detail' ? 43200 : 3600; // 12 hours for detail, 1 hour for others
    res.setHeader('Cache-Control', `s-maxage=${cacheTTL}, stale-while-revalidate=86400`);

    return res.status(200).json(output);

  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal Server Error', message: err.message });
  }
}
