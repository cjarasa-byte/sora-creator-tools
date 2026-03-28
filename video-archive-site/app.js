(function () {
  const csvInput = document.getElementById('csvFile');
  const searchInput = document.getElementById('searchInput');
  const sortBy = document.getElementById('sortBy');
  const creatorFilter = document.getElementById('creatorFilter');
  const summary = document.getElementById('summary');
  const emptyState = document.getElementById('emptyState');
  const grid = document.getElementById('grid');
  const cardTemplate = document.getElementById('cardTemplate');

  let allPosts = [];

  csvInput.addEventListener('change', onFileSelected);
  searchInput.addEventListener('input', render);
  sortBy.addEventListener('change', render);
  creatorFilter.addEventListener('change', render);

  async function onFileSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const text = await file.text();
    allPosts = parseExportCSV(text);
    populateCreators(allPosts);
    render();
  }

  function parseExportCSV(text) {
    const lines = text.split(/\r?\n/);
    const sectionStart = lines.findIndex((line) => line.includes('=== POSTS SUMMARY'));
    if (sectionStart < 0) return [];

    const headerIndex = sectionStart + 1;
    const headers = parseCSVLine(lines[headerIndex] || '');
    const records = [];
    for (let i = headerIndex + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      if (line.startsWith('===')) break;
      const values = parseCSVLine(line);
      const row = {};
      for (let j = 0; j < headers.length; j += 1) {
        row[headers[j]] = values[j] || '';
      }
      records.push(normalizeRecord(row));
    }
    return records.filter((row) => row.postId);
  }

  function normalizeRecord(row) {
    const postUrl = row['Post URL'] || '';
    const videoUrl = row['Video URL'] || row['Media URL'] || row['MP4 URL'] || '';
    const thumbUrl = row['Thumbnail URL'] || '';
    return {
      userKey: row['User Key'] || '',
      handle: row['User Handle'] || '(unknown)',
      postId: row['Post ID'] || '',
      caption: row['Caption'] || '',
      postTimeISO: row['Post Time (ISO)'] || row['Post Time'] || '',
      latestSnapshotTs: row['Latest Snapshot Timestamp'] || '',
      uniqueViews: toNumber(row['Unique Views']),
      totalViews: toNumber(row['Total Views']),
      likes: toNumber(row['Likes']),
      comments: toNumber(row['Comments']),
      remixes: toNumber(row['Remixes']),
      interactionRate: toNumber(row['Interaction Rate %']),
      thumbUrl,
      postUrl,
      backendPostUrl: row['Backend Post URL'] || '',
      videoUrl
    };
  }

  function populateCreators(posts) {
    const unique = [...new Set(posts.map((p) => p.handle).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    creatorFilter.innerHTML = '<option value="">All creators</option>';
    unique.forEach((handle) => {
      const opt = document.createElement('option');
      opt.value = handle;
      opt.textContent = handle;
      creatorFilter.appendChild(opt);
    });
  }

  function render() {
    const q = (searchInput.value || '').trim().toLowerCase();
    const creator = creatorFilter.value;

    let filtered = allPosts.filter((post) => {
      if (creator && post.handle !== creator) return false;
      if (!q) return true;
      return (
        post.handle.toLowerCase().includes(q) ||
        post.caption.toLowerCase().includes(q) ||
        post.postId.toLowerCase().includes(q)
      );
    });

    filtered = sortRecords(filtered, sortBy.value);

    if (!allPosts.length) {
      summary.classList.add('hidden');
      emptyState.classList.remove('hidden');
    } else {
      summary.classList.remove('hidden');
      emptyState.classList.add('hidden');
      summary.textContent = [
        `Loaded ${allPosts.length.toLocaleString()} posts`,
        `${filtered.length.toLocaleString()} visible`,
        `${new Set(allPosts.map((p) => p.handle)).size.toLocaleString()} creators`
      ].join(' • ');
    }

    grid.innerHTML = '';
    filtered.forEach((post) => {
      grid.appendChild(renderCard(post));
    });
  }

  function renderCard(post) {
    const node = cardTemplate.content.cloneNode(true);
    const thumbLink = node.querySelector('.thumb-link');
    const thumb = node.querySelector('.thumb');
    const handle = node.querySelector('.handle');
    const time = node.querySelector('.post-time');
    const caption = node.querySelector('.caption');
    const stats = node.querySelector('.stats');
    const links = node.querySelector('.links');

    const primaryUrl = post.videoUrl || post.postUrl || post.backendPostUrl || '#';
    thumbLink.href = primaryUrl;
    thumb.src = post.thumbUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="338"%3E%3Crect width="100%25" height="100%25" fill="%23141b27"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-size="22" fill="%238ca1bc" font-family="sans-serif"%3ENo thumbnail%3C/text%3E%3C/svg%3E';
    thumb.alt = `${post.handle} post ${post.postId}`;

    handle.textContent = post.handle;
    time.textContent = formatDate(post.postTimeISO || post.latestSnapshotTs);
    caption.textContent = post.caption || '(No caption)';

    const statPairs = [
      ['Views', fmt(post.totalViews)],
      ['Unique', fmt(post.uniqueViews)],
      ['Likes', fmt(post.likes)],
      ['Comments', fmt(post.comments)],
      ['Remixes', fmt(post.remixes)],
      ['IR %', isFinite(post.interactionRate) ? post.interactionRate.toFixed(2) : '—']
    ];

    statPairs.forEach(([k, v]) => {
      const row = document.createElement('div');
      row.innerHTML = `<dt>${k}</dt><dd>${v}</dd>`;
      stats.appendChild(row);
    });

    if (post.postUrl) {
      links.appendChild(link('Open post', post.postUrl));
    }
    if (post.videoUrl) {
      links.appendChild(link('Open media', post.videoUrl));
    }

    return node;
  }

  function sortRecords(rows, mode) {
    const copy = rows.slice();
    const sorters = {
      latest_snapshot_desc: (a, b) => toTime(b.latestSnapshotTs) - toTime(a.latestSnapshotTs),
      likes_desc: (a, b) => b.likes - a.likes,
      views_desc: (a, b) => b.totalViews - a.totalViews,
      interaction_desc: (a, b) => b.interactionRate - a.interactionRate,
      post_time_desc: (a, b) => toTime(b.postTimeISO) - toTime(a.postTimeISO)
    };
    const sorter = sorters[mode] || sorters.latest_snapshot_desc;
    copy.sort(sorter);
    return copy;
  }

  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const next = line[i + 1];
      if (ch === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function toTime(v) {
    const t = Date.parse(v || '');
    return Number.isFinite(t) ? t : 0;
  }

  function formatDate(v) {
    const t = toTime(v);
    if (!t) return 'Unknown time';
    return new Date(t).toLocaleString();
  }

  function fmt(n) {
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString();
  }

  function link(text, href) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    a.target = '_blank';
    a.rel = 'noreferrer';
    return a;
  }
})();
