export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');

  const srtUrl = req.query.url;
  if (!srtUrl) {
    return res.status(400).send('WEBVTT\n\n');
  }

  try {
    const response = await fetch(srtUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://foodcash.com.br/',
        'Origin': 'https://foodcash.com.br',
      },
    });

    if (!response.ok) {
      return res.status(200).send('WEBVTT\n\n');
    }

    const srtContent = await response.text();

    // Convert SRT to VTT
    let vtt = srtContent.replace(/\r\n|\r/g, '\n').trim();
    if (!vtt.startsWith('WEBVTT')) {
      vtt = 'WEBVTT\n\n' + vtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    }

    // Cache at Edge for 6 hours
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).send(vtt);

  } catch (err) {
    return res.status(200).send('WEBVTT\n\n');
  }
}
