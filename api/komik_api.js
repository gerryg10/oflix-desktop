import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action || '';
  const KOMIKU_BASE = 'https://komiku.org';
  const KOMIKU_API = 'https://api.komiku.org';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  if (!action) {
    return res.status(400).json({
      status: 'error', message: 'action wajib diisi',
      endpoints: { populer: '?action=populer&page=1', search: '?action=search&q=naruto', detail: '?action=detail&detailManga={slug}', baca: '?action=baca&bacaManga={slug}' },
    });
  }

  async function komikuFetch(url) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8', 'Referer': `${KOMIKU_BASE}/`, 'Cache-Control': 'no-cache' } });
      if (!r.ok) return null;
      return await r.text();
    } catch { return null; }
  }

  function fixUrl(url) {
    if (!url) return '';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return KOMIKU_BASE + url;
    return url;
  }

  function clean(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function parseItems(html) {
    const $ = cheerio.load(html);
    const items = [];
    const seen = new Set();

    $('.bge').each((i, el) => {
      const a = $(el).find('a').first();
      const link = fixUrl(a.attr('href'));
      if (!link || seen.has(link)) return;
      seen.add(link);

      const slug = link.replace(/\/$/, '').split('/').pop();
      const img = $(el).find('img').first();
      const poster = fixUrl(img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || img.attr('src') || '');
      let title = $(el).find('h2 a, h3 a, h4 a').first().text().trim() || $(el).find('h2, h3, h4').first().text().trim() || img.attr('alt') || slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
      const tpe = $(el).find('.tpe1_inf').first();
      const bText = tpe.find('b').text().trim();
      const type = bText;
      const genre = tpe.text().replace(bText, '').trim();
      const lastChapter = $(el).find('.new1').text().trim();
      const info = $(el).find('.judul2').text().trim();

      items.push({ title, slug, link, detailManga: slug, poster, lastChapter, type, genre, info });
    });
    return items;
  }

  try {
    // ── POPULER ──
    if (action === 'populer') {
      const page = parseInt(req.query.page || '1', 10);
      const startApi = (page - 1) * 5 + 1;
      const results = [];
      const seen = new Set();
      const errors = [];

      for (let p = startApi; p <= startApi + 4; p++) {
        const url = p === 1 ? `${KOMIKU_API}/other/hot/` : `${KOMIKU_API}/other/hot/page/${p}/`;
        const html = await komikuFetch(url);
        if (!html) { errors.push(`page ${p}: fetch failed`); continue; }
        for (const item of parseItems(html)) {
          if (!seen.has(item.link)) { seen.add(item.link); results.push(item); }
        }
      }
      res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
      return res.status(200).json({ status: 'ok', action: 'populer', page, totalItems: results.length, errors: errors.length ? errors : undefined, data: results });
    }

    // ── SEARCH ──
    if (action === 'search') {
      const q = req.query.q || '';
      if (!q) return res.status(400).json({ status: 'error', message: 'q required' });
      const html = await komikuFetch(`${KOMIKU_API}/?post_type=manga&s=${encodeURIComponent(q)}`);
      if (!html) return res.status(502).json({ status: 'error', message: 'Gagal fetch search' });
      const items = parseItems(html);
      res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
      return res.status(200).json({ status: 'ok', action: 'search', query: q, totalItems: items.length, data: items });
    }

    // ── DETAIL ──
    if (action === 'detail') {
      const detailSlug = req.query.detailManga || '';
      if (!detailSlug) return res.status(400).json({ status: 'error', message: 'detailManga required' });
      const dUrl = `${KOMIKU_BASE}/manga/${detailSlug}/`;
      const html = await komikuFetch(dUrl);
      if (!html) return res.status(502).json({ status: 'error', message: 'Gagal fetch detail' });

      const $ = cheerio.load(html);
      const info = { meta: {} };
      info.title = clean($('#Informasi h1').text() || $('h1').first().text());
      const posterImg = $('#Informasi img').first();
      info.poster = fixUrl(posterImg.attr('data-src') || posterImg.attr('src') || '');
      info.description = clean($('#sinopsis, .sinopsis').first().text());

      $('#Informasi tr').each((i, el) => {
        const tds = $(el).find('td');
        if (tds.length >= 2) {
          const k = clean($(tds[0]).text()).replace(/:$/, '');
          const v = clean($(tds[1]).text());
          if (k && v && k.length < 30) info.meta[k] = v;
        }
      });

      const chapters = [];
      $('tr[itemprop="itemListElement"]').each((i, el) => {
        const a = $(el).find('a[href]').first();
        if (!a.length) return;
        const link = fixUrl(a.attr('href'));
        const chSlug = link.replace(/\/$/, '').split('/').pop();
        const title = clean($(el).find('.judulseries, [itemprop="name"]').first().text()) || clean(a.text());
        if (!title) return;
        let date = clean($(el).find('.tanggalseries').text());
        if (!date) {
          const tds = $(el).find('td');
          const last = clean($(tds[tds.length - 1]).text());
          if (last !== title && /\d/.test(last)) date = last;
        }
        chapters.push({ title, slug: chSlug, link, bacaManga: chSlug, date });
      });

      // Fallback strategy if no chapters found via itemprop
      if (chapters.length === 0) {
        $('#Daftar_Chapter tr, #daftarChapter tr, [data-test="chapter-table"] tr').each((i, el) => {
          const a = $(el).find('a[href]').first();
          if (!a.length) return;
          const link = fixUrl(a.attr('href'));
          const chSlug = link.replace(/\/$/, '').split('/').pop();
          const title = clean($(el).find('.judulseries').text()) || clean(a.text());
          if (!title) return;
          const date = clean($(el).find('.tanggalseries').text());
          chapters.push({ title, slug: chSlug, link, bacaManga: chSlug, date });
        });
      }

      res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400');
      return res.status(200).json({ status: 'ok', action: 'detail', detailManga: detailSlug, url: dUrl, info, totalChapter: chapters.length, chapters });
    }

    // ── BACA ──
    if (action === 'baca') {
      const bacaSlug = req.query.bacaManga || '';
      if (!bacaSlug) return res.status(400).json({ status: 'error', message: 'bacaManga required' });
      const bUrl = `${KOMIKU_BASE}/${bacaSlug}/`;
      const html = await komikuFetch(bUrl);
      if (!html) return res.status(502).json({ status: 'error', message: 'Gagal fetch baca' });

      const $ = cheerio.load(html);
      const images = [];
      $('#Baca_Komik img, .chapter-content img, .reader img').each((i, el) => {
        const src = fixUrl($(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original') || $(el).attr('src') || '');
        if (!src || src.toLowerCase().includes('blank') || src.toLowerCase().includes('placeholder')) return;
        const id = $(el).attr('id') || String(i + 1);
        const alt = $(el).attr('alt') || `Page ${i + 1}`;
        images.push({ id, src, alt });
      });

      res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=86400');
      return res.status(200).json({ status: 'ok', action: 'baca', bacaManga: bacaSlug, url: bUrl, firstImage: images[0]?.src || '', totalPages: images.length, images });
    }

    return res.status(400).json({ status: 'error', message: 'action tidak dikenal: ' + action });

  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Internal Server Error', detail: error.message });
  }
}
