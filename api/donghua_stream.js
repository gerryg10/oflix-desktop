import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query;
  const ep = query.ep || '';
  const CF_PROXY = 'https://proxy-anichin.oflix.workers.dev';
  const ANICHIN_BASE = 'https://anichin.watch';
  const CF_COOKIE = process.env.ANICHIN_CF_CLEARANCE || '';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  if (!ep) {
    return res.status(400).json({ error: 'Parameter ep wajib diisi', usage: '?ep={episode-slug}' });
  }

  async function simpleFetch(url, customHeaders = {}) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': UA, ...customHeaders },
      });
      if (!resp.ok) return null;
      return await resp.text();
    } catch {
      return null;
    }
  }

  async function extractOkRu(url) {
    let finalUrl = url;
    if (!finalUrl.includes('videoembed')) {
      const match = finalUrl.match(/\/video\/(\d+)/);
      if (match) finalUrl = 'https://ok.ru/videoembed/' + match[1];
    }
    if (!finalUrl.startsWith('http')) finalUrl = 'https:' + finalUrl;

    const html = await simpleFetch(finalUrl, { Referer: `${ANICHIN_BASE}/` });
    if (!html) return null;

    const matchOpts = html.match(/data-options="([^"]+)"/);
    if (matchOpts) {
      try {
        const raw = matchOpts[1].replace(/&quot;/g, '"');
        const opts = JSON.parse(raw);
        const ms = opts.flashvars?.metadata;
        if (ms) {
          const meta = JSON.parse(ms);
          if (meta) {
            const hls = meta.hlsManifestUrl || meta.hlsMasterPlaylistUrl || meta.ondemandHls || '';
            const bestUrl = hls || '';
            return {
              playerUrl: finalUrl,
              streamUrl: bestUrl,
              streamType: bestUrl.includes('.m3u8') ? 'm3u8' : 'mp4',
              source: 'ok.ru'
            };
          }
        }
      } catch (e) {
        // ignore
      }
    }

    const matchHls = html.match(/"(?:hlsManifestUrl|ondemandHls)"\s*:\s*"([^"]+)"/);
    if (matchHls) {
      return {
        playerUrl: finalUrl,
        streamUrl: matchHls[1].replace(/\\\//g, '/'),
        streamType: 'm3u8',
        source: 'ok.ru'
      };
    }
    return null;
  }

  async function extractAnichinStream(url) {
    const urlObj = new URL(url);
    const videoId = urlObj.searchParams.get('id') || (url.match(/[?&]id=([^&]+)/) || [])[1];
    const base = `${urlObj.protocol}//${urlObj.host}`;

    if (videoId) {
      return {
        playerUrl: url,
        streamUrl: `${base}/hls/${videoId}.m3u8`,
        streamType: 'm3u8',
        videoId,
        source: 'anichin.stream'
      };
    }

    const html = await simpleFetch(url, { Referer: `${ANICHIN_BASE}/` });
    if (html) {
      const match = html.match(/([a-zA-Z0-9_-]+)\.m3u8/);
      if (match) {
        return {
          playerUrl: url,
          streamUrl: `${base}/hls/${match[1]}.m3u8`,
          streamType: 'm3u8',
          videoId: match[1],
          source: 'anichin.stream'
        };
      }
    }
    return null;
  }

  async function extractGeneric(url) {
    return { playerUrl: url, streamUrl: url, streamType: url.includes('.m3u8') ? 'm3u8' : 'mp4', source: 'generic' };
  }

  try {
    const url = `${ANICHIN_BASE}/${ep}/`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Cookie': `cf_clearance=${CF_COOKIE}`,
        'Referer': `${ANICHIN_BASE}/`
      }
    });

    if (!response.ok) {
      return res.status(502).json({ success: false, error: 'Gagal fetch episode page (CF block?)', episode: ep });
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    let playerUrl = '';

    const iframe1 = $('.video-content iframe').attr('data-src') || $('.video-content iframe').attr('src');
    if (iframe1 && !iframe1.includes('about:blank')) playerUrl = iframe1;

    if (!playerUrl) {
      $('iframe').each((i, el) => {
        const src = $(el).attr('data-src') || $(el).attr('src');
        if (src && !src.includes('about:blank')) {
          playerUrl = src;
          return false;
        }
      });
    }

    if (!playerUrl) {
      const match = html.match(/(?:src|url|file)\s*[:=]\s*["']([^"']+(?:embed|player|video)[^"']*)["']/i);
      if (match) playerUrl = match[1];
    }

    if (!playerUrl) {
      return res.status(404).json({ success: false, error: 'playerUrl not found', episode: ep });
    }

    let result = null;
    if (playerUrl.includes('anichin.stream') || playerUrl.includes('anichin.club')) {
      result = await extractAnichinStream(playerUrl);
    } else if (playerUrl.includes('ok.ru') || playerUrl.includes('odnoklassniki')) {
      result = await extractOkRu(playerUrl);
    } else {
      result = await extractGeneric(playerUrl);
    }

    if (!result) {
      result = { playerUrl, error: 'Could not extract stream' };
    }

    if (result.streamUrl && result.streamType === 'm3u8') {
      result.proxiedUrl = `${CF_PROXY}/?url=${encodeURIComponent(result.streamUrl)}`;
    }

    result.success = true;
    result.episode = ep;

    res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=86400');
    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ success: false, error: 'Internal Error', message: error.message });
  }
}
