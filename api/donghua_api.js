import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action || '';
  const ANICHIN_BASE = 'https://anichin.watch';
  const CF_COOKIE = process.env.ANICHIN_CF_CLEARANCE || '';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  if (!action) {
    return res.status(400).json({
      success: false, error: 'action wajib diisi',
      endpoints: { populer: '?action=populer&page=1', search: '?action=search&q=Tales&page=1', detail: '?action=detail&slug={slug}', play: '?action=play&ep={episode-slug}' },
    });
  }

  function cfError() {
    return { error: 'Cloudflare block — cf_clearance cookie mungkin expired', hint: 'Update env var ANICHIN_CF_CLEARANCE di Vercel', cf_cookie_set: CF_COOKIE !== '' };
  }

  async function anichinFetch(url) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8', 'Cookie': `cf_clearance=${CF_COOKIE}`, 'Referer': `${ANICHIN_BASE}/`, 'DNT': '1' },
      });
      if (!r.ok) return null;
      const html = await r.text();
      if (html.toLowerCase().includes('just a moment') || html.toLowerCase().includes('cf-challenge')) return null;
      return html;
    } catch { return null; }
  }

  function parseListPage(html, category, page) {
    const $ = cheerio.load(html);
    const items = [];
    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('a[href]').first();
      if (!a.length) return;
      const href = a.attr('href');
      const title = a.attr('title') || a.text().trim();
      const slug = href.replace(/\/$/, '').split('/').pop();
      const poster = $(el).find('img').first().attr('src') || '';
      const status = $(el).find('.epx').text().trim();
      const type = $(el).find('.typez').text().trim().toLowerCase() || 'donghua';
      items.push({ title, detailPath: slug, poster, status, type });
    });
    if (items.length === 0) return { error: 'listupd not found or empty', cf_ok: !html.includes('cf-challenge') };
    return { category, page, items };
  }

  try {
    // ── POPULER ──
    if (action === 'populer') {
      const pPop = parseInt(req.query.page || '1', 10);
      const urlPop = `${ANICHIN_BASE}/donghua/?page=${pPop}&status=&type=&order=popular`;
      const htmlPop = await anichinFetch(urlPop);
      const result = !htmlPop ? cfError() : parseListPage(htmlPop, 'populer', pPop);
      if (!result.error) res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
      return res.status(200).json(result);
    }

    // ── SEARCH ──
    if (action === 'search') {
      const qSearch = req.query.q || '';
      const pSearch = parseInt(req.query.page || '1', 10);
      if (!qSearch) return res.status(400).json({ error: 'q required' });
      const htmlSearch = await anichinFetch(`${ANICHIN_BASE}/page/${pSearch}/?s=${encodeURIComponent(qSearch)}`);
      if (!htmlSearch) return res.status(200).json(cfError());
      const result = parseListPage(htmlSearch, 'search', pSearch);
      result.query = qSearch;
      if (!result.error) res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
      return res.status(200).json(result);
    }

    // ── DETAIL ──
    if (action === 'detail') {
      const slugDetail = req.query.slug || '';
      if (!slugDetail) return res.status(400).json({ error: 'slug required' });
      const htmlDetail = await anichinFetch(`${ANICHIN_BASE}/donghua/${slugDetail}/`);
      if (!htmlDetail) return res.status(200).json(cfError());

      const $ = cheerio.load(htmlDetail);
      const data = { detailPath: slugDetail, country: 'China', type: 'donghua', subtitles: 'Indonesia', genre: [], episodes: [] };
      data.title = $('.entry-title').text().trim();
      data.poster = $('.thumbook img').attr('src') || '';
      data.rating = $('.rating strong').text().trim() || $('.num').first().text().trim();

      $('.spe span').each((i, el) => {
        const text = $(el).text().trim();
        const lower = text.toLowerCase();
        if (lower.includes('durasi') || lower.includes('duration')) {
          data.duration = text.replace(/^(Durasi|Duration)\s*:?\s*/i, '').trim();
        } else if (lower.includes('dirilis') || lower.includes('released') || lower.includes('rilis')) {
          data.releaseDate = text.replace(/^(Dirilis|Released|Rilis|Tanggal Rilis)\s*:?\s*/i, '').trim();
          const m = data.releaseDate.match(/(\d{4})/);
          if (m) data.year = m[1];
        } else if (lower.includes('negara') || lower.includes('country')) {
          data.country = text.replace(/^(Negara|Country)\s*:?\s*/i, '').trim() || 'China';
        }
      });

      $('.genxed a').each((i, el) => data.genre.push($(el).text().trim()));
      data.description = $('.bixbox.synp .entry-content').text().trim() || $('.entry-content').first().text().trim();

      $('.eplister li').each((i, el) => {
        const a = $(el).find('a').first();
        if (!a.length) return;
        const playUrl = a.attr('href').replace(/\/$/, '').split('/').pop();
        const episode = $(el).find('.epl-num').text().trim() || ($(el).text().match(/episode\s*(\d+)/i) || [])[1] || '';
        const title = $(el).find('.epl-title').text().trim() || '';
        data.episodes.push({ playUrl, episode, title });
      });

      res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400');
      return res.status(200).json({ data });
    }

    // ── PLAY ──
    if (action === 'play') {
      const epSlug = req.query.ep || '';
      if (!epSlug) return res.status(400).json({ error: 'ep required' });
      const htmlPlay = await anichinFetch(`${ANICHIN_BASE}/${epSlug}/`);
      if (!htmlPlay) return res.status(200).json(cfError());

      const $ = cheerio.load(htmlPlay);
      let playerUrl = '';
      const iframe1 = $('.video-content iframe').attr('data-src') || $('.video-content iframe').attr('src');
      if (iframe1 && !iframe1.includes('about:blank')) playerUrl = iframe1;
      if (!playerUrl) {
        $('iframe').each((i, el) => {
          const src = $(el).attr('data-src') || $(el).attr('src');
          if (src && !src.includes('about:blank')) { playerUrl = src; return false; }
        });
      }
      if (!playerUrl) {
        const m = htmlPlay.match(/(?:src|url|file)\s*[:=]\s*["']([^"']+(?:embed|player|video)[^"']*)["']/i);
        if (m) playerUrl = m[1];
      }

      res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=86400');
      return res.status(200).json({ data: { playerUrl } });
    }

    return res.status(400).json({ error: 'action tidak dikenal: ' + action });

  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error', detail: error.message });
  }
}
