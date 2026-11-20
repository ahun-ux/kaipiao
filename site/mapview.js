/* 共用地圖元件（可愛小島風）：看板 index.html 與回報頁 report.html 共用。
 * 需要先載入 d3 與 topojson-client。svg 的父元素要是 position: relative / fixed / absolute。
 *
 *   const mv = MapView.create(svgElement, topo, {
 *     county: '澎湖縣', towns: [],               // towns 空陣列＝全縣
 *     label: f => '文字',                        // 選填：村里上顯示的字
 *     onClick: (f, ev) => {}, onHover: (f, ev) => {},
 *     townLabel: town => 'HTML',                 // 選填：浮動鄉鎮標籤內容
 *     onTownClick: town => {},
 *     pad: {top, right, bottom, left},
 *   });
 *   mv.setMarkers([{id, key}])                   // 每所投開票所一棟小房子
 *   mv.paint(key => '#色碼', {hatch:Set, selected:key, dim:Set})
 *   mv.paintMarkers(id => ({roof:'#色碼', flag:true, dim:false}))
 *   mv.updateTownLabels()
 *   mv.celebrate(key, 'HTML', 毫秒, markerIds)  // 飛過去＋波紋＋彈跳＋泡泡
 *   mv.flash(Set)                                // 原地彈跳＋波紋
 *   mv.zoomTo(key, maxK, dy), mv.zoomToTown(town), mv.zoomToKeys(Set), mv.zoomBy(k), mv.reset(), mv.resize()
 *   mv.lastInteract                              // 使用者最後一次拖拉／縮放的時間（毫秒）
 */
(function () {
  const norm = s => String(s || '').replace(/台/g, '臺').trim();

  const STYLE = `
  .mv-svg{display:block;width:100%;height:100%;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none}
  .mv-svg:active{cursor:grabbing}
  .mv-v{stroke:var(--vborder,rgba(255,255,255,.75));stroke-width:1;vector-effect:non-scaling-stroke;transition:fill .7s,opacity .3s;cursor:pointer;transform-box:fill-box;transform-origin:center bottom}
  .mv-v:hover{stroke:var(--ink);stroke-width:2}
  .mv-v.sel{stroke:var(--ink);stroke-width:3}
  .mv-v.dim{opacity:.4;cursor:default}
  .mv-v.pop{animation:mvpop .9s cubic-bezier(.3,1.6,.5,1)}
  @keyframes mvpop{0%{transform:translateY(0)}30%{transform:translateY(-6%)}100%{transform:translateY(0)}}
  .mv-label{fill:var(--ink);paint-order:stroke;stroke:rgba(255,255,255,.85);stroke-linejoin:round;pointer-events:none;font-weight:700;font-family:var(--mvfont,inherit)}
  html.dark .mv-label{stroke:rgba(0,0,0,.55)}
  .mv-flat .mv-label{font-weight:500;stroke:var(--card);opacity:.85}
  .mv-flat .mv-v{stroke-width:.8}
  .mv-house .hb{transform-box:fill-box;transform-origin:center bottom;transition:opacity .3s}
  .mv-house.dim .hb{opacity:.35}
  .mv-house.pop .hb{animation:mvhouse 1s cubic-bezier(.3,1.8,.5,1)}
  @keyframes mvhouse{0%{transform:translateY(0) scale(1)}25%{transform:translateY(-55%) scale(1.25,.9)}55%{transform:translateY(0) scale(.9,1.12)}100%{transform:translateY(0) scale(1)}}
  .mv-house .roof{transition:fill .8s}
  .mv-house .flag{transition:opacity .4s}
  .mv-overlay{position:absolute;pointer-events:none;overflow:hidden;z-index:2}
  .mv-town{position:absolute;transform:translate(-50%,-100%);pointer-events:auto;cursor:pointer;white-space:nowrap;
    background:var(--card,#fff);border:2.5px solid var(--pillBorder,#24304a);border-radius:999px;padding:4px 8px 4px 12px;
    display:flex;align-items:center;gap:5px;box-shadow:0 4px 0 rgba(36,48,74,.18),0 8px 18px rgba(0,0,0,.12);
    font-family:var(--mvfont,inherit);font-weight:700;font-size:15px;color:var(--ink);transition:opacity .3s}
  .mv-town:hover{transform:translate(-50%,-100%) scale(1.05)}
  .mv-town .tb{display:inline-flex;align-items:center;gap:2px;color:#fff;border-radius:999px;padding:2px 8px;font-size:13px;line-height:1.3}
  .mv-town .tn{font-size:16px;margin-right:2px}
  .mv-pop{position:absolute;transform:translate(-50%,calc(-100% - 18px)) scale(.6);opacity:0;pointer-events:none;
    background:var(--card,#fff);border:2.5px solid var(--pillBorder,#24304a);border-radius:16px;padding:8px 12px;min-width:150px;
    box-shadow:0 5px 0 rgba(36,48,74,.18),0 12px 28px rgba(0,0,0,.18);font-family:var(--mvfont,inherit);color:var(--ink);
    transition:transform .35s cubic-bezier(.3,1.6,.5,1),opacity .25s}
  .mv-pop.on{transform:translate(-50%,calc(-100% - 18px)) scale(1);opacity:1}
  .mv-pop::after{content:"";position:absolute;left:50%;bottom:-9px;width:14px;height:14px;background:inherit;border-right:2.5px solid var(--pillBorder,#24304a);border-bottom:2.5px solid var(--pillBorder,#24304a);transform:translateX(-50%) rotate(45deg)}
  .mv-ripple{fill:none;stroke:#fff;pointer-events:none}
  .mv-flat .mv-pop{border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.18)}
  .mv-flat .mv-pop::after{border-right:1px solid var(--line);border-bottom:1px solid var(--line)}`;
  function injectStyle() {
    if (document.getElementById('mapview-style')) return;
    const s = document.createElement('style');
    s.id = 'mapview-style'; s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // 固定亂數（同一個村里每次都長一樣）
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  let uid = 0;

  function create(svgEl, topo, opt) {
    injectStyle();
    opt = opt || {};
    const id = ++uid;
    const CUTE = !!opt.cute;                 // true＝可愛小島風；預設為簡潔平面風
    const SQ = CUTE ? 0.84 : 1;              // 垂直壓扁比例（可愛風才有斜上方俯視感）
    const LAND = CUTE ? 'var(--grass)' : 'var(--land)';
    const svg = d3.select(svgEl).classed('mv-svg', true).classed('mv-flat', !opt.cute);
    if (!opt.cute) svgEl.style.setProperty('--vborder', 'var(--border)');
    const obj = topo.objects.villages || topo.objects[Object.keys(topo.objects)[0]];
    const county = norm(opt.county), towns = (opt.towns || []).map(norm);
    const label = opt.label || (f => f.properties._v.replace(/[里村]$/, ''));

    const features = topojson.feature(topo, obj).features.filter(f => {
      const p = f.properties;
      return (!county || norm(p.COUNTYNAME) === county) && (towns.length === 0 || towns.includes(norm(p.TOWNNAME)));
    });
    const byKey = new Map();
    features.forEach(f => {
      f.properties._t = norm(f.properties.TOWNNAME);
      f.properties._v = norm(f.properties.VILLNAME);
      f.properties._key = f.properties._t + '|' + f.properties._v;
      byKey.set(f.properties._key, f);
    });
    const geoms = obj.geometries.filter(g => byKey.has(norm(g.properties.TOWNNAME) + '|' + norm(g.properties.VILLNAME)));
    const townList = [...new Set(features.map(f => f.properties._t))];
    const townGeo = new Map(townList.map(t => [t, topojson.merge(topo, geoms.filter(g => norm(g.properties.TOWNNAME) === t))]));

    // overlay（浮動標籤、泡泡）
    const parent = svgEl.parentNode;
    const overlay = document.createElement('div');
    overlay.className = 'mv-overlay' + (opt.cute ? '' : ' mv-flat');
    parent.appendChild(overlay);

    let W, H, base, cy, pathGen, zoom, cur = d3.zoomIdentity;
    let gRoot, gLand, gHatch, gDeco, gHouses, gLabels, gFx, gShadow, gCliff, gLip;
    let markers = [], markerPos = new Map(), lastPaint = null, lastMarkers = null, home = d3.zoomIdentity;
    const api = { lastInteract: 0 };

    const project = ll => { const p = base(ll); return p ? [p[0], cy + (p[1] - cy) * SQ] : null; };
    const unproject = p => base.invert([p[0], cy + (p[1] - cy) / SQ]);

    function build() {
      const box = svgEl.getBoundingClientRect();
      W = box.width || 800; H = box.height || 600;
      const pb = parent.getBoundingClientRect();
      overlay.style.left = (box.left - pb.left + parent.scrollLeft - parent.clientLeft) + 'px';
      overlay.style.top = (box.top - pb.top + parent.scrollTop - parent.clientTop) + 'px';
      overlay.style.width = W + 'px'; overlay.style.height = H + 'px';
      svg.attr('viewBox', `0 0 ${W} ${H}`);
      svg.selectAll('*').remove();
      overlay.innerHTML = '';
      if (!features.length) return;

      const pad = Object.assign({ top: 70, right: 30, bottom: 60, left: 30 }, opt.pad || {});
      cy = (pad.top + H - pad.bottom) / 2;
      const hh = (H - pad.top - pad.bottom) / SQ;
      // 取景：忽略零星小島礁（面積小於最大島 1.5% 的碎塊），主要島嶼才會夠大
      const islands = topojson.merge(topo, geoms);   // 合併後每一塊＝一座島
      const parts = (islands.type === 'Polygon' ? [islands.coordinates] : islands.coordinates).map(c => ({ type: 'Polygon', coordinates: c }));
      const pa = parts.map(p => d3.geoArea(p)), maxA = Math.max(...pa);
      const fitParts = parts.filter((p, i) => pa[i] >= maxA * 0.015);
      base = d3.geoMercator().fitExtent([[pad.left, cy - hh / 2], [W - pad.right, cy + hh / 2]],
        { type: 'GeometryCollection', geometries: fitParts.length ? fitParts : parts });
      const squash = { stream: s => base.stream({
        point: (x, y) => s.point(x, cy + (y - cy) * SQ), sphere: () => s.sphere(),
        lineStart: () => s.lineStart(), lineEnd: () => s.lineEnd(),
        polygonStart: () => s.polygonStart(), polygonEnd: () => s.polygonEnd() }) };
      pathGen = d3.geoPath(squash);

      const defs = svg.append('defs');
      if (CUTE) {
        const wave = defs.append('pattern').attr('id', 'mvw' + id).attr('width', 46).attr('height', 22).attr('patternUnits', 'userSpaceOnUse');
        wave.append('rect').attr('width', 46).attr('height', 22).style('fill', 'var(--water)');
        wave.append('path').attr('d', 'M2 15 Q8 10 14 15').attr('fill', 'none').style('stroke', 'var(--wave)').attr('stroke-width', 1.8).attr('stroke-linecap', 'round');
        wave.append('path').attr('d', 'M25 5 Q31 0 37 5').attr('fill', 'none').style('stroke', 'var(--wave)').attr('stroke-width', 1.8).attr('stroke-linecap', 'round');
      } else {
        const wave = defs.append('pattern').attr('id', 'mvw' + id).attr('width', 28).attr('height', 14).attr('patternUnits', 'userSpaceOnUse');
        wave.append('rect').attr('width', 28).attr('height', 14).style('fill', 'var(--water)');
        wave.append('path').attr('d', 'M0 9 Q7 5 14 9 T28 9').attr('fill', 'none').style('stroke', 'var(--wave)').attr('stroke-width', 1.4).attr('stroke-linecap', 'round');
        const sh = defs.append('filter').attr('id', 'mvs' + id).attr('x', '-10%').attr('y', '-10%').attr('width', '120%').attr('height', '130%');
        sh.append('feDropShadow').attr('dx', 0).attr('dy', 6).attr('stdDeviation', 7).attr('flood-color', '#2b4a55').attr('flood-opacity', .28);
      }
      const hatch = defs.append('pattern').attr('id', 'mvh' + id).attr('width', 7).attr('height', 7).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
      hatch.append('rect').attr('width', 2.6).attr('height', 7).attr('fill', 'rgba(255,255,255,.6)');
      const blur = defs.append('filter').attr('id', 'mvb' + id).attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
      blur.append('feGaussianBlur').attr('stdDeviation', 6);

      const bg = svg.append('rect').attr('width', W).attr('height', H).attr('fill', `url(#mvw${id})`);
      gRoot = svg.append('g');
      const outline = islands;
      if (CUTE) {
        gShadow = gRoot.append('path').datum(outline).attr('d', pathGen).style('fill', 'var(--shadowSea, rgba(20,70,80,.28))').attr('filter', `url(#mvb${id})`);
        gCliff = gRoot.append('path').datum(outline).attr('d', pathGen).style('fill', 'var(--sandDark)').style('stroke', 'var(--sandDark)')
          .attr('stroke-width', 8).attr('vector-effect', 'non-scaling-stroke').attr('stroke-linejoin', 'round');
        gRoot.append('path').datum(outline).attr('d', pathGen).style('fill', 'var(--sand)').style('stroke', 'var(--sand)')
          .attr('stroke-width', 8).attr('vector-effect', 'non-scaling-stroke').attr('stroke-linejoin', 'round');
        gLip = gRoot.append('path').datum(outline).attr('d', pathGen).style('fill', 'var(--grassDark)');
      } else {
        gShadow = gCliff = gLip = gRoot.append('g');   // 平面風不需要立體層
        gRoot.append('path').datum(outline).attr('d', pathGen).style('fill', 'var(--coast)').style('stroke', 'var(--coast)')
          .attr('stroke-width', 6).attr('vector-effect', 'non-scaling-stroke').attr('stroke-linejoin', 'round').attr('filter', `url(#mvs${id})`);
      }
      gLand = gRoot.append('g');
      gHatch = gRoot.append('g').attr('pointer-events', 'none');
      gRoot.append('path')
        .datum(topojson.mesh(topo, { type: 'GeometryCollection', geometries: geoms }, (a, b) => a !== b && a.properties.TOWNNAME !== b.properties.TOWNNAME))
        .attr('d', pathGen).attr('fill', 'none')
        .call(p => CUTE
          ? p.style('stroke', 'var(--townLine, rgba(255,255,255,.95))').attr('stroke-width', 2).attr('stroke-dasharray', '1 5').attr('stroke-linecap', 'round')
          : p.style('stroke', 'var(--ink)').attr('stroke-opacity', .35).attr('stroke-width', 1.4).attr('stroke-dasharray', '4 3'))
        .attr('vector-effect', 'non-scaling-stroke').attr('pointer-events', 'none');
      gDeco = gRoot.append('g').attr('pointer-events', 'none');
      gHouses = gRoot.append('g').attr('pointer-events', 'none');
      gLabels = gRoot.append('g');
      gFx = gRoot.append('g').attr('pointer-events', 'none');

      gLand.selectAll('path').data(features, f => f.properties._key).join('path')
        .attr('class', 'mv-v').attr('d', pathGen).style('fill', LAND)
        .on('mousemove', (ev, f) => opt.onHover && opt.onHover(f, ev))
        .on('mouseleave', ev => opt.onHover && opt.onHover(null, ev))
        .on('click', (ev, f) => { ev.stopPropagation(); opt.onClick && opt.onClick(f, ev); });

      if (CUTE) { buildTrees(); buildHouses(); }

      const labelData = features.map(f => ({ f, c: pathGen.centroid(f), a: pathGen.area(f) })).filter(x => isFinite(x.c[0]));
      gLabels.selectAll('text').data(labelData).join('text')
        .attr('class', 'mv-label').attr('text-anchor', 'middle').attr('dy', '.35em')
        .attr('x', x => x.c[0]).attr('y', x => x.c[1] + (CUTE ? 9 : 0));
      relabel();

      buildTownLabels();

      zoom = d3.zoom().scaleExtent([1, 16]).on('zoom', ev => {
        cur = ev.transform;
        if (ev.sourceEvent) api.lastInteract = Date.now();
        gRoot.attr('transform', cur);
        onScale();
        placeOverlay();
      });
      svg.call(zoom).on('dblclick.zoom', null);
      svg.on('click', ev => opt.onClick && opt.onClick(null, ev));
      home = computeHome(parts, pa);
      svg.call(zoom.transform, home);
      if (lastPaint) paint(lastPaint[0], lastPaint[1]);
      if (lastMarkers) paintMarkers(lastMarkers);
    }

    // 預設鏡頭：最大島＋附近的島（群島縣市用，例如澎湖不含望安、七美）
    function computeHome(parts, pa) {
      const maxA = Math.max(...pa), bi = pa.indexOf(maxA);
      const B = pathGen.bounds(parts[bi]);
      const ex = 0.12 * Math.max(B[1][0] - B[0][0], B[1][1] - B[0][1]);
      const x0 = B[0][0] - ex, y0 = B[0][1] - ex, x1 = B[1][0] + ex, y1 = B[1][1] + ex;
      const pad = Object.assign({ top: 70, right: 30, bottom: 60, left: 30 }, opt.pad || {});
      const aw = W - pad.left - pad.right, ah = H - pad.top - pad.bottom;
      const k = Math.max(1, Math.min(6, 0.94 * Math.min(aw / (x1 - x0), ah / (y1 - y0))));
      if (k < 1.15) return d3.zoomIdentity;
      const cx = pad.left + aw / 2, cyy = pad.top + ah / 2;
      return d3.zoomIdentity.translate(cx, cyy).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    }

    // 隨機取村里內的點
    function samplePoints(f, n, rnd, minGap) {
      const [[x0, y0], [x1, y1]] = pathGen.bounds(f);
      const pts = [];
      for (let tries = 0; tries < 400 && pts.length < n; tries++) {
        const p = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)];
        const ll = unproject(p);
        if (!ll || !d3.geoContains(f, ll)) continue;
        if (pts.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < minGap)) continue;
        pts.push(p);
      }
      if (pts.length < n) {
        const c = pathGen.centroid(f);
        while (pts.length < n) pts.push([c[0] + (pts.length % 2 ? 1 : -1) * minGap * 0.6 * pts.length, c[1]]);
      }
      return pts;
    }

    function buildTrees() {
      const data = [];
      const areas = features.map(f => pathGen.area(f)).sort((a, b) => a - b);
      const unit = Math.max(1, areas[Math.floor(areas.length * 0.5)] || 1);   // 中位數面積
      features.forEach(f => {
        const a = pathGen.area(f), rnd = seeded('t' + f.properties._key);
        const n = Math.min(3, Math.floor(a / unit));
        samplePoints(f, n, rnd, Math.sqrt(a) / 3).forEach(p => data.push({ p, s: 0.8 + rnd() * 0.5, palm: rnd() > 0.55 }));
      });
      const g = gDeco.selectAll('g').data(data).join('g').attr('class', 'mv-tree');
      g.each(function (d) {
        const t = d3.select(this);
        t.append('ellipse').attr('cx', 0).attr('cy', 0).attr('rx', 2.6).attr('ry', 0.9).attr('fill', 'rgba(0,0,0,.15)');
        if (d.palm) {
          t.append('path').attr('d', 'M0 0 Q0.6 -3 0.2 -6').attr('fill', 'none').attr('stroke', '#9a7148').attr('stroke-width', 0.8).attr('stroke-linecap', 'round');
          t.append('path').attr('d', 'M0.2 -6 q-3 -1 -4 1.2 M0.2 -6 q3 -1 4 1.2 M0.2 -6 q-1.6 -2.4 -3.4 -2 M0.2 -6 q1.8 -2.4 3.6 -1.8')
            .attr('fill', 'none').style('stroke', 'var(--tree)').attr('stroke-width', 1.2).attr('stroke-linecap', 'round');
        } else {
          t.append('rect').attr('x', -0.4).attr('y', -2).attr('width', 0.8).attr('height', 2).attr('fill', '#9a7148');
          t.append('circle').attr('cx', 0).attr('cy', -3.6).attr('r', 2.4).style('fill', 'var(--tree)');
          t.append('circle').attr('cx', -0.7).attr('cy', -4.3).attr('r', 0.9).attr('fill', 'rgba(255,255,255,.28)');
        }
      });
    }

    function buildHouses() {
      markerPos = new Map();
      const byVill = new Map();
      markers.forEach(m => { if (!byKey.has(m.key)) return; if (!byVill.has(m.key)) byVill.set(m.key, []); byVill.get(m.key).push(m); });
      byVill.forEach((list, key) => {
        const f = byKey.get(key);
        const pts = list.length === 1 ? [pathGen.centroid(f)] : samplePoints(f, list.length, seeded('h' + key), Math.min(7, Math.sqrt(pathGen.area(f)) / (list.length + 0.5)));
        list.forEach((m, i) => markerPos.set(m.id, pts[i]));
      });
      const data = markers.filter(m => markerPos.has(m.id)).sort((a, b) => markerPos.get(a.id)[1] - markerPos.get(b.id)[1]);
      const g = gHouses.selectAll('g.mv-house').data(data, m => m.id).join('g').attr('class', 'mv-house').attr('data-id', m => m.id);
      g.selectAll('*').remove();
      g.each(function (m) {
        const hb = d3.select(this).append('g').attr('class', 'hb');
        hb.append('ellipse').attr('cx', 0).attr('cy', 0.3).attr('rx', 4.6).attr('ry', 1.3).attr('fill', 'rgba(0,0,0,.2)');
        hb.append('rect').attr('x', -3.2).attr('y', -4.2).attr('width', 6.4).attr('height', 4.4).attr('rx', 0.4).style('fill', 'var(--wall)').attr('stroke', 'rgba(0,0,0,.18)').attr('stroke-width', 0.35);
        hb.append('rect').attr('x', -0.8).attr('y', -2.2).attr('width', 1.6).attr('height', 2.4).attr('rx', 0.3).attr('fill', '#8a6440');
        hb.append('path').attr('class', 'roof').attr('d', 'M-4.2 -3.8 L0 -7.8 L4.2 -3.8 Z').attr('stroke', 'rgba(0,0,0,.2)').attr('stroke-width', 0.35).attr('stroke-linejoin', 'round').style('fill', 'var(--roof)');
        const fl = hb.append('g').attr('class', 'flag').style('opacity', 0);
        fl.append('line').attr('x1', 2.6).attr('y1', -5.6).attr('x2', 2.6).attr('y2', -12).attr('stroke', '#555').attr('stroke-width', 0.45);
        fl.append('path').attr('class', 'flagc').attr('d', 'M2.6 -12 L6.6 -10.9 L2.6 -9.8 Z');
      });
      onScale();
    }

    function onScale() {
      if (!gHouses) return;
      const k = cur.k, s = 1.25 / Math.pow(k, 0.62), ts = 1.1 / Math.pow(k, 0.62);
      gHouses.selectAll('g.mv-house').attr('transform', m => { const p = markerPos.get(m.id); return `translate(${p[0]},${p[1]}) scale(${s})`; });
      gDeco.selectAll('g.mv-tree').attr('transform', d => `translate(${d.p[0]},${d.p[1]}) scale(${ts * d.s})`);
      gLabels.selectAll('text').attr('font-size', (CUTE ? 11 : 10) / k + 'px').style('stroke-width', (CUTE ? 3 : 2.6) / k + 'px')
        .attr('display', x => x.a * k * k > (CUTE ? 1500 : 900) ? null : 'none');
      const d = (4 + 2.2 * Math.log2(k)) / k;
      gCliff.attr('transform', `translate(0,${d})`);
      gLip.attr('transform', `translate(0,${d * 0.45})`);
      gShadow.attr('transform', `translate(0,${d + 7 / k})`);
    }

    function relabel() {
      if (!gLabels) return;
      gLabels.selectAll('text').text(x => label(x.f));
      onScale();
    }

    /* ---------- 浮動鄉鎮標籤 ---------- */
    const townAnchor = new Map();
    function buildTownLabels() {
      townAnchor.clear();
      overlay.querySelectorAll('.mv-town').forEach(e => e.remove());
      if (!CUTE || !opt.townLabel || townList.length < 2) return;
      townList.forEach(t => {
        const g = townGeo.get(t);
        // 用面積最大的那塊島的上緣當標籤位置
        let best = null, bestA = -1;
        (g.type === 'Polygon' ? [g.coordinates] : (g.coordinates || [])).forEach(poly => {
          const gp = { type: 'Polygon', coordinates: poly }, a = pathGen.area(gp);
          if (a > bestA) { bestA = a; best = gp; }
        });
        const b = pathGen.bounds(best || g), c = pathGen.centroid(best || g);
        townAnchor.set(t, [c[0], b[0][1] + (b[1][1] - b[0][1]) * 0.25]);
        const el = document.createElement('div');
        el.className = 'mv-town'; el.dataset.t = t;
        el.onclick = e => { e.stopPropagation(); opt.onTownClick ? opt.onTownClick(t) : zoomToTown(t); };
        overlay.appendChild(el);
      });
      updateTownLabels();
    }
    function updateTownLabels() {
      overlay.querySelectorAll('.mv-town').forEach(el => { el.innerHTML = opt.townLabel(el.dataset.t) || `<span class="tn">${el.dataset.t}</span>`; });
      placeOverlay();
    }

    function placeOverlay() {
      overlay.querySelectorAll('.mv-town').forEach(el => {
        const p = cur.apply(townAnchor.get(el.dataset.t));
        el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px';
        el.style.opacity = cur.k > Math.max(5, home.k * 2.2) ? 0.35 : 1;
      });
      overlay.querySelectorAll('.mv-pop').forEach(el => {
        const p = cur.apply(JSON.parse(el.dataset.p));
        el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px';
      });
    }

    /* ---------- 上色 ---------- */
    function paint(fillFn, o) {
      lastPaint = [fillFn, o || {}];
      if (!gLand) return;
      o = o || {};
      gLand.selectAll('path')
        .style('fill', f => fillFn(f.properties._key, f) || LAND)
        .classed('sel', f => f.properties._key === o.selected)
        .classed('dim', f => !!(o.dim && o.dim.has(f.properties._key)));
      const hk = o.hatch || new Set();
      gHatch.selectAll('path').data(features.filter(f => hk.has(f.properties._key)), f => f.properties._key)
        .join('path').attr('d', pathGen).attr('fill', `url(#mvh${id})`);
      relabel();
    }

    function setMarkers(list) {
      const sig = JSON.stringify(list.map(m => m.id + m.key));
      if (sig === api._msig) return;
      api._msig = sig;
      markers = list;
      if (gHouses && CUTE) buildHouses();
      if (lastMarkers) paintMarkers(lastMarkers);
    }

    function paintMarkers(fn) {
      lastMarkers = fn;
      if (!gHouses) return;
      gHouses.selectAll('g.mv-house').each(function (m) {
        const r = fn(m.id) || {};
        const g = d3.select(this);
        g.classed('dim', !!r.dim);
        g.select('.roof').style('fill', r.roof || 'var(--roof)');
        g.select('.flag').style('opacity', r.flag ? 1 : 0);
        g.select('.flagc').attr('fill', r.flagColor || r.roof || '#e4572e');
      });
    }

    /* ---------- 特效 ---------- */
    function ripple(key) {
      const f = byKey.get(key); if (!f || !gFx) return;
      const c = pathGen.centroid(f), k = cur.k;
      [0, 280, 560].forEach(delay => {
        gFx.append('ellipse').attr('class', 'mv-ripple').attr('cx', c[0]).attr('cy', c[1])
          .attr('rx', 2 / k).attr('ry', 2 * SQ / k).attr('stroke-width', 3 / k).attr('opacity', 0.95)
          .transition().delay(delay).duration(1300).ease(d3.easeCubicOut)
          .attr('rx', 42 / k).attr('ry', 42 * SQ / k).attr('opacity', 0).remove();
      });
    }
    function bounce(keys, ids) {
      if (gLand && keys) gLand.selectAll('path').filter(f => keys.has(f.properties._key)).each(function () {
        this.classList.remove('pop'); void this.getBBox(); this.classList.add('pop');
      });
      if (gHouses) gHouses.selectAll('g.mv-house').filter(m => ids ? ids.includes(m.id) : (keys && keys.has(m.key))).each(function () {
        this.classList.remove('pop'); void this.getBBox(); this.classList.add('pop');
      });
    }
    function flash(keys, ids) {
      if (!keys || !keys.size) return;
      bounce(keys, ids);
      keys.forEach(ripple);
    }

    function popup(key, html, ms, anchor) {
      const f = byKey.get(key); if (!f) return;
      overlay.querySelectorAll('.mv-pop').forEach(e => e.remove());
      const el = document.createElement('div');
      el.className = 'mv-pop'; el.innerHTML = html;
      const c = anchor || pathGen.centroid(f);
      el.dataset.p = JSON.stringify([c[0], c[1] - 4]);
      overlay.appendChild(el);
      placeOverlay();
      requestAnimationFrame(() => el.classList.add('on'));
      setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 400); }, ms || 2600);
    }

    function celebrate(key, html, ms, ids) {
      zoomTo(key, 5.5, -0.1);   // 目標放低一點，泡泡才不會蓋到上方按鈕
      setTimeout(() => {
        flash(new Set([key]), ids);
        const anchor = ids && ids.length === 1 && markerPos.get(ids[0]) ? [markerPos.get(ids[0])[0], markerPos.get(ids[0])[1] - 6] : null;
        if (html) popup(key, html, ms, anchor);
      }, 720);
    }

    /* ---------- 鏡頭 ---------- */
    function zoomToFeatures(fs, maxK, dy, fill) {
      if (!fs.length || !zoom) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      fs.forEach(f => { const b = pathGen.bounds(f); x0 = Math.min(x0, b[0][0]); y0 = Math.min(y0, b[0][1]); x1 = Math.max(x1, b[1][0]); y1 = Math.max(y1, b[1][1]); });
      const k = Math.max(1, Math.min(maxK || 8, (fill || 0.8) / Math.max((x1 - x0) / W, (y1 - y0) / H)));
      const cyy = H / 2 - (dy || 0) * H;   // dy：把目標往上移（畫面下方被面板擋住時用）
      svg.transition().duration(900).ease(d3.easeCubicInOut).call(zoom.transform,
        d3.zoomIdentity.translate(W / 2, cyy).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
    }
    function zoomTo(key, maxK, dy) { const f = byKey.get(key); if (f) zoomToFeatures([f], maxK || 8, dy, 0.45); }
    function zoomToTown(town, dy) { town = norm(town); zoomToFeatures(features.filter(f => f.properties._t === town), 14, dy); }
    function zoomToKeys(keys, dy) { zoomToFeatures([...keys].map(k => byKey.get(k)).filter(Boolean), 10, dy, 0.6); }

    build();
    return Object.assign(api, {
      features, byKey, norm, towns: townList,
      paint, paintMarkers, setMarkers, updateTownLabels,
      flash, celebrate, popup, ripple,
      zoomTo, zoomToTown, zoomToKeys,
      zoomBy: k => zoom && svg.transition().call(zoom.scaleBy, k),
      reset: () => zoom && svg.transition().duration(800).ease(d3.easeCubicInOut).call(zoom.transform, home),
      showAll: () => zoom && svg.transition().duration(800).ease(d3.easeCubicInOut).call(zoom.transform, d3.zoomIdentity),
      get hasHome() { return home.k > 1; },
      resize: build,
      relabel,
      get k() { return cur.k; },
    });
  }

  window.MapView = { create, norm };
})();
