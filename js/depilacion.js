/* Depilación: zonas que se trabajan en cada sesión, cuántas sesiones lleva cada zona (como la agenda de papel),
   sesiones hechas antes de usar la app, y a quién le toca volver. Los datos van en las mismas "sesiones" de la ficha. */
'use strict';

const ZONAS_DEPI = ['Axilas', 'Bozo', 'Mentón', 'Patillas', 'Rostro completo', 'Cuello / nuca', 'Cavado simple', 'Cavado completo', 'Tira de cola', 'Glúteos',
  'Abdomen', 'Línea alba', 'Pecho', 'Espalda', 'Hombros', 'Brazos completos', 'Medio brazo', 'Manos', 'Medias piernas', 'Piernas completas', 'Pies'];
const zonasConfig = () => (Array.isArray(DB.cfg.zonas_depi) && DB.cfg.zonas_depi.length ? DB.cfg.zonas_depi : ZONAS_DEPI);
const intervaloDepi = () => Math.max(1, parseInt(DB.cfg.depi_intervalo) || 30);
const esDepi = txt => normal(txt).includes('depil');
const servEsDepi = sid => { const s = DB.get('servicios', sid); return !!s && (esDepi(s.nombre) || esDepi(s.categoria)); };
const ord = n => n + 'ª';
const haceDias = n => (n <= 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} días`);

/* zonas de una sesión: las nuevas las traen en "zonas"; las viejas de depilación tenían la zona escrita a mano */
function zonasSesion(s) {
  if (Array.isArray(s.zonas)) return s.zonas;
  if (!s.zona || !esDepi(s.servicio)) return [];
  const conf = zonasConfig();
  return [...new Set(s.zona.split(/,|;|\+| y /i).map(x => x.trim()).filter(Boolean)
    .map(x => conf.find(z => normal(z) === normal(x)) || x[0].toUpperCase() + x.slice(1)))];
}

/* todo lo de depilación de una clienta: zonas con cuántas sesiones lleva y el número de cada zona en cada sesión */
function depiClienta(cid) {
  const c = DB.get('clientas', cid), prev = (c && c.depi_previas) || {};
  const ses = DB.donde('sesiones', s => s.clienta_id === cid && zonasSesion(s).length).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
  const zonas = {}, numeros = {};
  const z0 = z => (zonas[z] = zonas[z] || { zona: z, n: 0, previas: 0, primera: '', ultima: '', items: [] });
  for (const [z, p] of Object.entries(prev)) { const n = parseInt(p.n) || 0; if (n > 0) { const k = z0(z); k.n = k.previas = n; k.ultima = p.ultima || ''; } }
  for (const s of ses) {
    numeros[s.id] = {};
    for (const z of zonasSesion(s)) { const k = z0(z); k.n++; if (!k.primera) k.primera = s.fecha; if (s.fecha >= k.ultima) k.ultima = s.fecha; k.items.push({ s, nro: k.n }); numeros[s.id][z] = k.n; }
  }
  const lista = Object.values(zonas).sort((a, b) => b.ultima.localeCompare(a.ultima) || a.zona.localeCompare(b.zona, 'es'));
  const ultima = lista.reduce((m, z) => (z.ultima > m ? z.ultima : m), '');
  const total = ses.length + Math.max(0, ...lista.map(z => z.previas), 0);
  return { ses, zonas: lista, numeros, ultima, total, fin: c && c.depi_fin && c.depi_fin >= ultima ? c.depi_fin : '' };
}
/* ¿le toca volver? (pasaron los días de la configuración desde la última sesión y no tiene turno dado) */
function estadoDepi(cid, d = depiClienta(cid)) {
  if (!d.ultima) return { sin: true };
  const h = hoy(), dias = diasEntre(d.ultima, h);
  const turno = DB.donde('turnos', t => t.clienta_id === cid && t.fecha >= h && turnoVivo(t) && t.estado !== 'ATENDIDO').sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora))[0] || null;
  return { dias, turno, termino: !!d.fin, toca: !d.fin && !turno && dias >= intervaloDepi(), proxima: sumarDias(d.ultima, intervaloDepi()) };
}
const textoZonas = (d, max = 4) => d.zonas.slice(0, max).map(z => `${z.zona} ${z.n}`).join(' · ') + (d.zonas.length > max ? ` · +${d.zonas.length - max}` : '');
/* "Axilas (5ª) 18 J · Piernas completas (3ª)" */
const lineaZonasSesion = (s, nros) => zonasSesion(s).map(z => `${esc(z)}${nros && nros[z] ? ` (${ord(nros[z])})` : ''}${s.zparam && s.zparam[z] ? ` <span class="muted">${esc(s.zparam[z])}</span>` : ''}`).join(' · ');

async function guardarPreviasDepi(c, previas) {
  DB.verificarEscritura();
  const l = {};
  for (const [z, p] of Object.entries(previas)) { const n = parseInt(p.n) || 0; if (n < 0 || n > 99) throw new Error('Revisá la cantidad de ' + z); if (n) l[z] = { n, ultima: p.ultima || '' }; }
  c.depi_previas = l; await DB.guardar('clientas', c);
  await DB.anotar('Depilación: sesiones anteriores', c.nombre);
}
async function marcarFinDepi(c, termino) {
  DB.verificarEscritura();
  c.depi_fin = termino ? hoy() : ''; await DB.guardar('clientas', c);
  await DB.anotar(termino ? 'Depilación: terminó el tratamiento' : 'Depilación: sigue el tratamiento', c.nombre);
}

/* ---------------------------------------------------------------- elegir zonas (se usa al cobrar y al anotar una sesión) */
/* el: donde se dibuja · cid: clienta · ini: { zonas, zparam } · sesionId: si se está modificando una sesión ya guardada */
function zonasWidget(el, cid, ini = {}, sesionId = null) {
  let sel = [...(ini.zonas || [])]; const par = Object.assign({}, ini.zparam || {});
  const d = depiClienta(cid);
  const lleva = z => { const k = d.zonas.find(x => x.zona === z); if (!k) return 0; return sesionId ? (k.items.find(i => i.s.id === sesionId)?.nro || k.n + 1) - 1 : k.n; };
  const pintar = () => {
    const todas = [...new Set([...zonasConfig(), ...d.zonas.map(z => z.zona), ...sel])];
    el.innerHTML = `<label>Zonas que se trabajaron <span style="font-weight:600">(tocá las que correspondan)</span></label>
      <div class="chips zonas-chips">${todas.map(z => { const n = d.zonas.find(x => x.zona === z)?.n || 0;
        return `<button type="button" data-z="${esc(z)}" class="${sel.includes(z) ? 'act' : ''}">${esc(z)}${n ? ` <small>${n}</small>` : ''}</button>`; }).join('')}
        <button type="button" data-zotra class="otra">${ico('plus')} Otra</button></div>
      ${sel.length ? `<div class="zonas-sel">${sel.map(z => `<div class="zs"><div class="tx"><b>${esc(z)}</b><small>Sesión ${ord(lleva(z) + 1)}</small></div>
        <input data-zp="${esc(z)}" value="${esc(par[z] || '')}" placeholder="Parámetros (opcional)"></div>`).join('')}</div>` : ''}`;
  };
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-z]');
    if (b) { const z = b.dataset.z; sel = sel.includes(z) ? sel.filter(x => x !== z) : [...sel, z]; pintar(); return; }
    if (e.target.closest('[data-zotra]')) {
      const z = ((await pedirTexto('Otra zona', 'Nombre de la zona') || '').replace(/\s+/g, ' ').trim());
      if (z && !sel.includes(z)) { sel.push(z); pintar(); }
    }
  });
  el.addEventListener('input', e => { if (e.target.dataset.zp !== undefined) par[e.target.dataset.zp] = e.target.value; });
  pintar();
  return {
    get: () => ({ zonas: sel.slice(), zparam: Object.fromEntries(sel.filter(z => (par[z] || '').trim()).map(z => [z, par[z].trim()])) }),
    poner: zonas => { sel = [...zonas]; pintar(); },
    vacio: () => !sel.length,
  };
}

/* ---------------------------------------------------------------- pantalla */
let FILTRO_DEPI = 'toca', BUSCA_DEPI = '';
PANTALLAS.depilacion = async (main) => {
  titulo('Depilación');
  const h = hoy(), ini = h.slice(0, 8) + '01';
  const filas = DB.todos('clientas').map(c => { const d = depiClienta(c.id); return d.ultima ? { c, d, e: estadoDepi(c.id, d) } : null; }).filter(Boolean);
  const enTrat = filas.filter(x => !x.e.termino && x.c.activo !== false), toca = enTrat.filter(x => x.e.toca), terminaron = filas.filter(x => x.e.termino);
  const delMes = DB.donde('sesiones', s => s.fecha >= ini && s.fecha <= h && zonasSesion(s).length);
  const zMes = {}; for (const s of delMes) for (const z of zonasSesion(s)) zMes[z] = (zMes[z] || 0) + 1;
  const topZ = Object.entries(zMes).sort((a, b) => b[1] - a[1])[0];
  main.innerHTML = `<div class="kpis">
      <div class="kpi oscuro"><small>Les toca volver</small><b>${toca.length}</b><div class="sub">pasaron ${intervaloDepi()} días o más</div></div>
      <div class="kpi"><small>En tratamiento</small><b>${enTrat.length}</b><div class="sub">${filas.length} con sesiones</div></div>
      <div class="kpi"><small>Sesiones este mes</small><b>${delMes.length}</b><div class="sub">${topZ ? 'más hecha: ' + esc(topZ[0]) : 'todavía ninguna'}</div></div>
      <div class="kpi"><small>Terminaron</small><b>${terminaron.length}</b><div class="sub">tratamiento completo</div></div></div>
    <div class="fila" style="margin-bottom:12px"><div class="buscar">${ico('buscar')}<input id="dBus" placeholder="Buscar clienta" value="${esc(BUSCA_DEPI)}" autocomplete="off"></div>
      <button class="btn acento" id="dNueva">${ico('plus')} Anotar sesión</button></div>
    <div class="seg" id="dFil" style="margin-bottom:12px">${[['toca', `Le toca volver (${toca.length})`], ['trat', `En tratamiento (${enTrat.length})`], ['fin', `Terminaron (${terminaron.length})`], ['todas', 'Todas']]
      .map(([k, t]) => `<button data-f="${k}" class="${FILTRO_DEPI === k ? 'act' : ''}">${t}</button>`).join('')}</div>
    <div class="card" style="padding:6px 14px"><div class="lista" id="dLista"></div></div>
    <p class="muted chico">Las sesiones se anotan al cobrar (eligiendo las zonas) o con "Anotar sesión". En la ficha de cada clienta, pestaña <b>Depilación</b>, está todo zona por zona.</p>`;
  const pintar = () => {
    let l = FILTRO_DEPI === 'toca' ? toca : FILTRO_DEPI === 'trat' ? enTrat : FILTRO_DEPI === 'fin' ? terminaron : filas;
    if (BUSCA_DEPI) l = l.filter(x => coincide(`${x.c.nombre} ${x.c.telefono || ''}`, BUSCA_DEPI));
    l = l.slice().sort((a, b) => FILTRO_DEPI === 'toca' ? b.e.dias - a.e.dias : b.d.ultima.localeCompare(a.d.ultima));
    $('#dLista').innerHTML = l.map(({ c, d, e }) => `<div class="it" data-cli="${c.id}"><div class="av">${esc(iniciales(c.nombre))}</div><div class="tx"><b>${esc(c.nombre)}</b>
        <small>${esc(textoZonas(d))}</small><small>Última ${dm(d.ultima)} · ${haceDias(e.dias)}</small></div>
        ${e.termino ? '<span class="pill">Terminó</span>' : e.turno ? `<span class="pill ok">Turno ${dm(e.turno.fecha)}</span>` : e.toca ? '<span class="pill warn">Le toca</span>' : `<span class="pill info">${dm(e.proxima)}</span>`}
        ${e.toca && c.telefono ? `<button class="ib" data-wa="${c.id}" title="Avisarle por WhatsApp">${ico('wa')}</button>` : ''}</div>`).join('')
      || vacio('depi', !filas.length ? 'Todavía no hay sesiones de depilación anotadas.<br>Al cobrar una depilación, elegí las zonas y quedan acá.' : FILTRO_DEPI === 'toca' ? 'A nadie le toca volver por ahora ✨' : 'No hay clientas con ese filtro');
  };
  pintar();
  $('#dBus').oninput = debounce(e => { BUSCA_DEPI = e.target.value; pintar(); }, 150);
  $('#dFil').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; FILTRO_DEPI = b.dataset.f; $$('#dFil button').forEach(x => x.classList.toggle('act', x === b)); pintar(); };
  $('#dNueva').onclick = () => elegirClienta('¿A quién le hiciste la sesión?', c => editarSesion({ clienta_id: c.id, servicio: 'Depilación' }, recargar));
  $('#dLista').onclick = e => {
    const w = e.target.closest('[data-wa]');
    if (w) { const c = DB.get('clientas', +w.dataset.wa); abrirWa(c.telefono, msgDepi(c)); DB.anotar('Aviso de depilación por WhatsApp', c.nombre); return; }
    const b = e.target.closest('[data-cli]'); if (b) { TAB_FICHA = 'depi'; ir('ficha', { id: +b.dataset.cli }, true); }
  };
};
function msgDepi(c) {
  const d = depiClienta(c.id);
  return (DB.cfg.msg_depi || CONFIG_INICIAL.msg_depi).replace(/\{nombre\}/g, c.nombre.split(' ')[0]).replace(/\{negocio\}/g, DB.cfg.nombre)
    .replace(/\{zonas\}/g, d.zonas.filter(z => z.ultima === d.ultima).map(z => z.zona.toLowerCase()).join(', ') || 'depilación');
}

/* ---------------------------------------------------------------- pestaña "Depilación" de la ficha */
function fichaDepi(cont, c, re) {
  const d = depiClienta(c.id), e = estadoDepi(c.id, d), nuevas = d.ses.slice().reverse();
  cont.innerHTML = `<div class="card"><h2>${ico('depi')} Depilación<span class="sp"></span><button class="btn chico acento" id="dpN">${ico('plus')} Anotar sesión</button></h2>
      ${d.ultima ? `<div class="estado-cuota ${e.termino ? '' : e.turno ? 'ok' : e.toca ? 'warn' : 'ok'}" style="margin-bottom:12px;background:${e.termino ? 'var(--card2)' : ''}"><div class="tx">
        <b>${e.termino ? 'Terminó el tratamiento' : e.turno ? `Tiene turno el ${dm(e.turno.fecha)} a las ${e.turno.hora}` : e.toca ? 'Le toca volver' : `Próxima sesión: desde el ${dmy(e.proxima)}`}</b>
        <div class="chico">Última sesión: ${dmy(d.ultima)} (${haceDias(e.dias)})${d.fin ? ' · terminó el ' + dmy(d.fin) : ''}</div></div>
        ${e.toca && c.telefono ? `<button class="btn" id="dpWa">${ico('wa')} Avisarle</button>` : ''}</div>` : ''}
      ${d.zonas.length ? `<div class="tabla-x"><table class="t"><thead><tr><th>Zona</th><th class="r">Sesiones</th><th class="r">Última</th></tr></thead><tbody>
        ${d.zonas.map(z => `<tr data-zona="${esc(z.zona)}" style="cursor:pointer"><td><b>${esc(z.zona)}</b>${z.previas ? `<div class="chico muted">${z.previas} antes de la app</div>` : ''}</td>
          <td class="r"><b style="font-size:18px">${z.n}</b></td><td class="r">${z.ultima ? dmy(z.ultima) : '—'}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted chico" style="margin:8px 0 0">Tocá una zona para ver sesión por sesión.</p>`
      : vacio('depi', 'Todavía no tiene sesiones de depilación. Se anotan al cobrar (eligiendo las zonas) o con "Anotar sesión".')}
      <div class="fila" style="margin-top:12px"><button class="btn chico" id="dpPrev">${ico('reloj')} Sesiones que hizo antes</button>
        ${d.ultima ? `<button class="btn chico" id="dpFin">${d.fin ? 'Sigue con el tratamiento' : `${ico('check')} Terminó el tratamiento`}</button>` : ''}</div></div>
    ${nuevas.length ? `<div class="card" style="padding:6px 14px"><h2 style="margin:10px 0 4px">${ico('nota')} Sesión por sesión</h2><div class="lista">
      ${nuevas.map(s => `<div class="it" data-se="${s.id}" style="align-items:flex-start"><div class="av" style="font-size:12px">${dm(s.fecha)}</div><div class="tx">
        <b style="white-space:normal">${lineaZonasSesion(s, d.numeros[s.id])}</b><small>${dmy(s.fecha)}${s.detalle ? ' · ' + esc(s.detalle) : ''}</small>
        ${s.nota ? `<small style="white-space:normal">${esc(s.nota)}</small>` : ''}</div></div>`).join('')}</div></div>` : ''}`;
  $('#dpN').onclick = () => editarSesion({ clienta_id: c.id, servicio: 'Depilación' }, re);
  $('#dpPrev').onclick = () => editarPreviasDepi(c, re);
  if ($('#dpFin')) $('#dpFin').onclick = async () => { try { await marcarFinDepi(c, !d.fin); toast(d.fin ? 'Listo: sigue con el tratamiento' : 'Listo: no te va a aparecer en "Le toca volver"'); re(); } catch (er) { fallo(er); } };
  if ($('#dpWa')) $('#dpWa').onclick = () => { abrirWa(c.telefono, msgDepi(c)); DB.anotar('Aviso de depilación por WhatsApp', c.nombre); };
  cont.onclick = ev => {
    const s = ev.target.closest('[data-se]'); if (s) return editarSesion(DB.get('sesiones', s.dataset.se), re);
    const z = ev.target.closest('[data-zona]'); if (z) verZonaDepi(c, d.zonas.find(x => x.zona === z.dataset.zona), re);
  };
}
function verZonaDepi(c, z, re) {
  const m = modal(`${esc(z.zona)} · ${z.n} ${z.n === 1 ? 'sesión' : 'sesiones'}`, `<p class="muted" style="margin-top:0">${esc(c.nombre)}${z.previas ? ` · ${z.previas} ${z.previas === 1 ? 'sesión' : 'sesiones'} antes de usar la app${z.items.length ? '' : z.ultima ? ' (la última el ' + dmy(z.ultima) + ')' : ''}` : ''}</p>
    <div class="tabla-x"><table class="t"><thead><tr><th>N°</th><th>Fecha</th><th>Parámetros / notas</th></tr></thead><tbody>
    ${z.items.slice().reverse().map(({ s, nro }) => `<tr data-se="${s.id}" style="cursor:pointer"><td><b>${ord(nro)}</b></td><td>${dmy(s.fecha)}</td>
      <td>${esc([s.zparam && s.zparam[z.zona], s.detalle, s.nota].filter(Boolean).join(' · ')) || '<span class="muted">—</span>'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Sin sesiones anotadas en la app</td></tr>'}</tbody></table></div>`,
    '<button class="btn pri" data-cerrar>Cerrar</button>');
  $('.mb', m).onclick = e => { const s = e.target.closest('[data-se]'); if (s) { m.cerrar(); editarSesion(DB.get('sesiones', s.dataset.se), re); } };
}
function editarPreviasDepi(c, luego) {
  const prev = c.depi_previas || {}, todas = [...new Set([...zonasConfig(), ...Object.keys(prev)])];
  const m = modal('Sesiones que hizo antes', `<p class="muted" style="margin-top:0">Si <b>${esc(c.nombre)}</b> ya venía haciéndose depilación antes de usar la app (lo que tenías en la agenda de papel), poné cuántas sesiones llevaba en cada zona. Así la cuenta sigue desde ahí.</p>
    <div class="previas">${todas.map(z => `<div class="pv"><span>${esc(z)}</span><input data-pz="${esc(z)}" inputmode="numeric" value="${prev[z] ? prev[z].n : ''}" placeholder="0"></div>`).join('')}</div>
    <div class="campo" style="margin-top:12px"><label>Fecha de la última sesión que hizo antes (opcional)</label><input type="date" id="pvF" value="${esc(Object.values(prev).map(p => p.ultima).filter(Boolean).sort().pop() || '')}"></div>`,
    `<button class="btn" data-cerrar>Cancelar</button><button class="btn pri" id="pvOk">${ico('check')} Guardar</button>`);
  $('#pvOk', m).onclick = async () => {
    try { const f = val('pvF', m); if (f && f > hoy()) throw new Error('La fecha no puede ser futura');
      await guardarPreviasDepi(c, Object.fromEntries($$('[data-pz]', m).map(i => [i.dataset.pz, { n: i.value.trim(), ultima: f }])));
      m.cerrar(); toast('Guardado'); luego && luego(); } catch (e) { fallo(e); }
  };
}
