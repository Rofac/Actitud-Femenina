/* Gastos del estudio: mes por mes, por tipo de gasto, últimos 6 meses. Son los mismos gastos que se ven en la Caja. */
'use strict';

async function guardarGasto(id, d) {
  DB.verificarEscritura();
  if (d.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) throw new Error('Revisá la fecha');
  if (!(d.concepto || '').trim() && !d.categoria) throw new Error('Escribí qué es el gasto');
  if (!id) return movimiento({ tipo: 'GASTO', concepto: d.concepto, categoria: d.categoria, medio: d.medio, monto: d.monto, fecha: d.fecha });
  const x = DB.get('movimientos', id); if (!x || x.estado !== 'ACTIVO' || x.tipo !== 'GASTO') throw new Error('Ese gasto no existe o ya se borró');
  const monto = r2(n0(d.monto)); if (monto <= 0) throw new Error('Poné el importe');
  if (!d.medio) throw new Error('Elegí el medio');
  const antes = money2(x.monto);
  Object.assign(x, { fecha: (d.fecha || x.fecha.slice(0, 10)) + x.fecha.slice(10), concepto: (d.concepto || '').trim(), categoria: d.categoria || '', medio: d.medio, monto });
  await DB.guardar('movimientos', x);
  await DB.anotar('Gasto modificado', `${x.concepto || x.categoria} · ${antes} → ${money2(monto)}`);
  return x;
}
async function borrarGasto(id) {
  DB.verificarEscritura();
  const x = DB.get('movimientos', id); if (!x || x.estado !== 'ACTIVO') throw new Error('Ese gasto ya estaba borrado');
  x.estado = 'ANULADO'; x.anulado = ahora(); await DB.guardar('movimientos', x);
  await DB.anotar('Gasto borrado', `${x.concepto || x.categoria} · ${money2(x.monto)}`);
}
const gastosDelMes = ym => DB.donde('movimientos', m => m.estado === 'ACTIVO' && m.tipo === 'GASTO' && m.fecha.slice(0, 7) === ym);
const mesMas = (ym, n) => sumarMeses(ym + '-01', n).slice(0, 7);
const nombreMes = ym => `${MESES[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

function editarGasto(x, luego, fechaSug) {
  x = x || {};
  const cats = [...new Set([...(DB.cfg.categorias_gasto || []), ...(x.categoria ? [x.categoria] : [])])];
  const m = modal(x.id ? 'Modificar gasto' : `${ico('plata')} Gasto nuevo`, `<div class="form">
    <div class="campo"><label>Tipo de gasto</label><select id="gaC">${opciones(cats, x.categoria || '')}</select></div>
    <div class="campo"><label>Detalle</label><input id="gaD" value="${esc(x.concepto || '')}" placeholder="Ej. cera, sábanas descartables" ${x.id ? '' : 'autofocus'}></div>
    <div class="campo"><label>Importe</label>${campoMonto('id="gaM"', x.monto ?? '')}</div>
    <div class="campo"><label>Cómo lo pagaste</label><select id="gaMe">${opciones([...new Set([...DB.cfg.medios, ...(x.medio ? [x.medio] : [])])], x.medio || '')}</select></div>
    <div class="campo"><label>Fecha</label><input type="date" id="gaF" value="${x.fecha ? x.fecha.slice(0, 10) : fechaSug || hoy()}"></div></div>
    <p class="muted chico" style="margin:0">Los tipos de gasto se cambian en Configuración &gt; Listas. Este gasto también se descuenta en la Caja.</p>`,
    `${x.id ? `<button class="btn rojo" id="gaB">${ico('trash')} Borrar</button>` : ''}<button class="btn" data-cerrar>Cancelar</button><button class="btn pri" id="gaOk">${ico('check')} Guardar</button>`);
  if ($('#gaB', m)) $('#gaB', m).onclick = async () => {
    if (!await confirmar(`¿Borrar este gasto de ${money2(x.monto)}?`, 'Borrar', true)) return;
    try { await borrarGasto(x.id); m.cerrar(); toast('Gasto borrado'); luego && luego(); } catch (e) { fallo(e); }
  };
  $('#gaOk', m).onclick = async () => {
    try { await guardarGasto(x.id, { concepto: val('gaD', m), categoria: val('gaC', m), medio: val('gaMe', m), monto: $('#gaM', m).value, fecha: val('gaF', m) });
      m.cerrar(); toast('Gasto guardado'); luego && luego(); } catch (e) { fallo(e); }
  };
}

let MES_G = '', CAT_G = '';
PANTALLAS.gastos = async (main) => {
  titulo('Gastos');
  if (!MES_G) MES_G = hoy().slice(0, 7);
  const l = gastosDelMes(MES_G).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
  const total = r2(l.reduce((s, x) => s + x.monto, 0)), ant = r2(gastosDelMes(mesMas(MES_G, -1)).reduce((s, x) => s + x.monto, 0));
  const seis = [...Array(6)].map((_, i) => mesMas(MES_G, i - 5)).map(ym => ({ ym, t: r2(gastosDelMes(ym).reduce((s, x) => s + x.monto, 0)) }));
  const prom = r2(seis.reduce((s, x) => s + x.t, 0) / Math.max(1, seis.filter(x => x.t).length));
  const max6 = Math.max(1, ...seis.map(x => x.t));
  const porCat = {}; for (const x of l) porCat[x.categoria || 'Otros'] = (porCat[x.categoria || 'Otros'] || 0) + x.monto;
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  if (CAT_G && !porCat[CAT_G]) CAT_G = '';
  const dif = ant ? Math.round((total - ant) / ant * 100) : null;
  const esteMes = MES_G === hoy().slice(0, 7);
  main.innerHTML = `<div class="fila" style="margin-bottom:12px"><div class="mes-nav"><button class="btn" id="gaAnt" aria-label="Mes anterior">‹</button><b>${nombreMes(MES_G)}</b>
      <button class="btn" id="gaSig" aria-label="Mes siguiente" ${esteMes ? 'disabled' : ''}>›</button></div><span class="sp"></span>
      <button class="btn acento" id="gaN">${ico('plus')} Gasto</button></div>
    <div class="kpis"><div class="kpi oscuro"><small>Gastaste en ${MESES[+MES_G.slice(5, 7) - 1]}</small><b>${money(total)}</b><div class="sub">${l.length} ${l.length === 1 ? 'gasto' : 'gastos'}</div></div>
      <div class="kpi"><small>Mes anterior</small><b>${money(ant)}</b><div class="sub">${dif === null ? '—' : dif === 0 ? 'igual' : `<span class="${dif > 0 ? 'mal' : 'ok'}">${dif > 0 ? '▲' : '▼'} ${Math.abs(dif)}% ${dif > 0 ? 'más' : 'menos'}</span> este mes`}</div></div>
      <div class="kpi"><small>Promedio por mes</small><b>${money(prom)}</b><div class="sub">últimos 6 meses</div></div>
      <div class="kpi"><small>En lo que más</small><b style="font-size:18px">${cats.length ? esc(cats[0][0]) : '—'}</b><div class="sub">${cats.length ? money(cats[0][1]) : 'sin gastos'}</div></div></div>
    <div class="grid g2">
      <div class="card"><h2>${ico('caja')} Por tipo de gasto</h2><div id="gaCats">${cats.map(([k, v]) => `<div class="cat-g ${CAT_G === k ? 'act' : ''}" data-cat="${esc(k)}"><div class="fila"><b class="sp">${esc(k)}</b><span class="muted chico">${Math.round(v / total * 100)}%</span><b class="num">${money(v)}</b></div>
        <div class="barra"><i style="width:${Math.max(2, v / cats[0][1] * 100)}%"></i></div></div>`).join('') || '<p class="muted" style="margin:0">No cargaste gastos este mes.</p>'}</div>
        ${cats.length > 1 ? '<p class="muted chico" style="margin:8px 0 0">Tocá un tipo para ver sólo esos gastos.</p>' : ''}</div>
      <div class="card"><h2>${ico('progreso')} Últimos 6 meses</h2><div class="barras6" id="ga6">${seis.map(x => `<div class="b ${x.ym === MES_G ? 'act' : ''}" data-ym="${x.ym}">
        ${x.ym === MES_G && x.t ? `<em>${money(x.t)}</em>` : ''}<i style="height:${x.t / max6 * 100}%"></i><small>${MESES[+x.ym.slice(5, 7) - 1].slice(0, 3)}</small></div>`).join('')}</div>
        <p class="muted chico" style="margin:8px 0 0">Tocá un mes para verlo.</p></div></div>
    <div class="card" style="padding:6px 14px"><h2 style="margin:10px 0 4px">Gastos de ${MESES[+MES_G.slice(5, 7) - 1]}${CAT_G ? ` · <span class="pill acento" id="gaQ" style="cursor:pointer">${esc(CAT_G)} ${ico('x')}</span>` : ''}<span class="sp"></span>
      ${gastosDelMes(mesMas(MES_G, -1)).length ? `<button class="btn chico" id="gaRep">${ico('rutina')} Repetir del mes anterior</button>` : ''}</h2>
      <div class="lista" id="gaL">${l.filter(x => !CAT_G || (x.categoria || 'Otros') === CAT_G).map(x => `<div class="it" data-g="${x.id}"><div class="av">${+x.fecha.slice(8, 10)}</div><div class="tx">
        <b>${esc(x.concepto || x.categoria || 'Gasto')}</b><small>${DIAS_C[diaSemana(x.fecha)]} ${dm(x.fecha)} · ${esc(x.categoria || 'Otros')} · ${esc(x.medio)}</small></div><b class="num mal">− ${money2(x.monto)}</b></div>`).join('')
        || vacio('plata', 'Sin gastos en este mes. Tocá "+ Gasto" para cargar uno.')}</div></div>`;
  const re = () => PANTALLAS.gastos(main);
  $('#gaAnt').onclick = () => { MES_G = mesMas(MES_G, -1); CAT_G = ''; re(); };
  $('#gaSig').onclick = () => { MES_G = mesMas(MES_G, 1); CAT_G = ''; re(); };
  $('#gaN').onclick = () => editarGasto(null, re, esteMes ? hoy() : MES_G + '-01');
  if ($('#gaQ')) $('#gaQ').onclick = () => { CAT_G = ''; re(); };
  if ($('#gaRep')) $('#gaRep').onclick = () => repetirGastos(MES_G, re);
  $('#gaCats').onclick = e => { const b = e.target.closest('[data-cat]'); if (b) { CAT_G = CAT_G === b.dataset.cat ? '' : b.dataset.cat; re(); } };
  $('#ga6').onclick = e => { const b = e.target.closest('[data-ym]'); if (b) { MES_G = b.dataset.ym; CAT_G = ''; re(); } };
  $('#gaL').onclick = e => { const b = e.target.closest('[data-g]'); if (b) editarGasto(DB.get('movimientos', b.dataset.g), re); };
};

/* gastos fijos (alquiler, luz…): se copian los del mes anterior al mes que se está viendo, eligiendo cuáles */
function repetirGastos(ym, luego) {
  const prev = gastosDelMes(mesMas(ym, -1)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ya = gastosDelMes(ym), repetido = x => ya.some(y => normal(y.concepto) === normal(x.concepto) && y.categoria === x.categoria && Math.abs(y.monto - x.monto) < 0.01);
  const ult = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
  const fechaEn = x => { const f = `${ym}-${String(Math.min(+x.fecha.slice(8, 10), ult)).padStart(2, '0')}`; return f > hoy() ? (ym === hoy().slice(0, 7) ? hoy() : f) : f; };
  const m = modal('Repetir gastos del mes anterior', `<p class="muted" style="margin-top:0">Marcá los que se repiten todos los meses (alquiler, luz…). Se cargan en ${nombreMes(ym)} con el mismo importe; después los podés cambiar.</p>
    <div class="lista">${prev.map(x => `<label class="it" style="cursor:pointer"><input type="checkbox" data-rp="${x.id}" ${repetido(x) ? 'disabled' : ''}><div class="tx"><b>${esc(x.concepto || x.categoria)}</b>
      <small>${esc(x.categoria || 'Otros')} · ${esc(x.medio)}${repetido(x) ? ' · <b class="ok">ya está cargado</b>' : ' · va el ' + dm(fechaEn(x))}</small></div><b class="num">${money2(x.monto)}</b></label>`).join('')}</div>`,
    `<button class="btn" data-cerrar>Cancelar</button><button class="btn pri" id="rpOk">${ico('check')} Cargar los marcados</button>`);
  $('#rpOk', m).onclick = async () => {
    const sel = $$('[data-rp]:checked', m).map(i => DB.get('movimientos', i.dataset.rp));
    if (!sel.length) return toast('Marcá al menos uno', true);
    try { for (const x of sel) await movimiento({ tipo: 'GASTO', concepto: x.concepto, categoria: x.categoria, medio: x.medio, monto: x.monto, fecha: fechaEn(x) });
      m.cerrar(); toast(sel.length === 1 ? 'Gasto cargado' : `${sel.length} gastos cargados`); luego && luego(); } catch (e) { fallo(e); }
  };
}
