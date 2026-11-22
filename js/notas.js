/* Anotaciones del calendario: cualquier cosa en un día (con hora si quiere), que se puede repetir
   (cada semana, cada mes, cada año) y que puede marcar días en que no atiende (vacaciones, día libre). */
'use strict';

const REPITE = { no: 'No se repite', semana: 'Todas las semanas', mes: 'Todos los meses', anio: 'Todos los años' };

/* ¿la anotación cae en el día d? */
function notaEn(n, d) {
  if (d < n.fecha || (n.excepciones || []).includes(d)) return false;
  const r = n.repite || 'no';
  if (r === 'no') return d <= (n.hasta || n.fecha);
  if (r === 'semana') return diaSemana(d) === diaSemana(n.fecha);
  if (r === 'anio') return d.slice(5) === n.fecha.slice(5) || (n.fecha.slice(5) === '02-29' && d.slice(5) === '02-28' && !esBisiesto(+d.slice(0, 4)));
  // todos los meses: el mismo número de día; si el mes es más corto, el último día
  const dia = +n.fecha.slice(8), ult = new Date(+d.slice(0, 4), +d.slice(5, 7), 0).getDate();
  return +d.slice(8) === Math.min(dia, ult);
}
const esBisiesto = a => new Date(a, 1, 29).getDate() === 29;
const notasDel = d => DB.donde('notas', n => notaEn(n, d)).sort((a, b) => (a.hora || '').localeCompare(b.hora || '') || a.id - b.id);
const cierreDel = d => notasDel(d).find(n => n.cierra) || null;
/* día en que atiende: según el horario y sin feriado ni "no atiendo" */
const atiende = d => horario().dias.includes(diaSemana(d)) && !feriado(d) && !cierreDel(d);

async function guardarNota(n, d) {
  DB.verificarEscritura();
  const texto = String(d.texto || '').replace(/\s+/g, ' ').trim();
  if (!texto) throw new Error(d.cierra ? 'Escribí el motivo (ej. Vacaciones)' : 'Escribí la anotación');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '')) throw new Error('Elegí el día');
  if (d.hora && !/^\d{2}:\d{2}$/.test(d.hora)) throw new Error('Revisá la hora');
  const repite = REPITE[d.repite] ? d.repite : 'no';
  const hasta = repite === 'no' && d.hasta && d.hasta !== d.fecha ? d.hasta : '';
  if (hasta && hasta < d.fecha) throw new Error('El "hasta" no puede ser antes del día');
  if (hasta && diasEntre(d.fecha, hasta) > 366) throw new Error('Como mucho un año');
  const nueva = !n.id;
  Object.assign(n, { texto, fecha: d.fecha, hasta, hora: d.hora || '', repite, cierra: !!d.cierra, excepciones: repite === 'no' ? [] : (n.excepciones || []) });
  const g = await DB.guardar('notas', n);
  await DB.anotar(nueva ? 'Anotación nueva' : 'Anotación modificada', `${dmy(n.fecha)} · ${texto}`);
  return g;
}
async function borrarNota(n, soloDia) {
  DB.verificarEscritura();
  if (soloDia && (n.repite || 'no') !== 'no') {
    n.excepciones = [...new Set([...(n.excepciones || []), soloDia])]; await DB.guardar('notas', n);
    await DB.anotar('Anotación borrada sólo un día', `${dmy(soloDia)} · ${n.texto}`); return;
  }
  await DB.borrar('notas', n.id);
  await DB.anotar('Anotación borrada', `${dmy(n.fecha)} · ${n.texto}`);
}

/* d: el día donde la tocaron (para "borrar sólo este día" de las que se repiten) */
function editarNota(n, luego, d) {
  n = n || {};
  const m = modal(n.id ? 'Anotación' : `${ico('nota')} Anotación nueva`, `<div class="form">
      <div class="campo full"><label>Qué querés anotar</label><textarea id="noT" style="min-height:70px" placeholder="Ej. comprar cera · pagar alquiler · curso de láser · vacaciones" autofocus>${esc(n.texto || '')}</textarea></div>
      <div class="campo"><label>Día</label><input type="date" id="noF" value="${n.fecha || d || hoy()}"></div>
      <div class="campo"><label>Hora (opcional)</label><input type="time" id="noH" value="${esc(n.hora || '')}"></div>
      <div class="campo"><label>Se repite</label><select id="noR">${opciones(Object.entries(REPITE).map(([v, t]) => ({ v, t })), n.repite || 'no')}</select></div>
      <div class="campo" id="noHw"><label>Hasta (si dura varios días)</label><input type="date" id="noHa" value="${esc(n.hasta || '')}"></div>
      <div class="campo full"><label class="chk"><input type="checkbox" id="noC" ${n.cierra ? 'checked' : ''}> Ese día no atiendo (vacaciones, día libre…)</label>
        <p class="muted chico" style="margin:4px 0 0">El día queda cerrado en la agenda y avisa si querés dar un turno ahí.</p></div></div>
    <div id="noAv" class="warn chico" style="font-weight:800"></div>`,
    `${n.id ? `<button class="btn rojo" id="noB">${ico('trash')} Borrar</button>` : ''}<button class="btn" data-cerrar>Cancelar</button><button class="btn pri" id="noOk">${ico('check')} Guardar</button>`);
  const revisar = () => {
    $('#noHw', m).hidden = val('noR', m) !== 'no';
    // si marca "no atiendo" y ya hay turnos esos días, avisa
    const f = val('noF', m), h = val('noR', m) === 'no' ? (val('noHa', m) || f) : f;
    const ch = $('#noC', m).checked && f && h >= f ? DB.donde('turnos', t => t.fecha >= f && t.fecha <= h && turnoVivo(t) && t.estado !== 'ATENDIDO') : [];
    $('#noAv', m).innerHTML = ch.length ? `${ico('alerta')} Ojo: ya tenés ${ch.length} turno${ch.length === 1 ? '' : 's'} dado${ch.length === 1 ? '' : 's'} esos días (${ch.slice(0, 4).map(t => `${esc(nomClienta(t.clienta_id).split(' ')[0])} ${dm(t.fecha)}`).join(', ')}${ch.length > 4 ? '…' : ''}). No se borran: avisales y movelos.` : '';
  };
  m.addEventListener('input', revisar); m.addEventListener('change', revisar); revisar();
  if ($('#noB', m)) $('#noB', m).onclick = async () => {
    const rep = (n.repite || 'no') !== 'no' && d;
    let solo = null;
    if (rep) {
      const q = modal('Borrar anotación', `<p style="margin-top:0">"${esc(n.texto)}" se repite ${esc(REPITE[n.repite].toLowerCase())}.</p>`,
        `<button class="btn" data-cerrar>Cancelar</button><button class="btn" id="bnD">Sólo el ${dm(d)}</button><button class="btn rojo" id="bnT">Todas</button>`);
      solo = await new Promise(ok => { $('#bnD', q).onclick = () => { q.cerrar(); ok(d); }; $('#bnT', q).onclick = () => { q.cerrar(); ok(''); }; q.querySelector('[data-cerrar]').addEventListener('click', () => ok(null)); });
      if (solo === null) return;
    } else if (!await confirmar('¿Borrar esta anotación?', 'Borrar', true)) return;
    try { await borrarNota(n, solo); m.cerrar(); toast('Anotación borrada'); luego && luego(); } catch (e) { fallo(e); }
  };
  $('#noOk', m).onclick = async () => {
    try { await guardarNota(n.id ? DB.get('notas', n.id) : {}, { texto: $('#noT', m).value, fecha: val('noF', m), hora: val('noH', m), repite: val('noR', m), hasta: val('noHa', m), cierra: $('#noC', m).checked });
      m.cerrar(); toast('Anotación guardada'); luego && luego(); } catch (e) { fallo(e); }
  };
}
/* cómo se ve una anotación en la agenda */
const notaHtml = (n, d, chica) => chica
  ? `<div class="mes-nota ${n.cierra ? 'cierra' : ''}" data-nota="${n.id}" data-nd="${d}">${n.cierra ? '🚫 ' : ''}${esc(n.texto)}</div>`
  : `<div class="nota-ag ${n.cierra ? 'cierra' : ''}" data-nota="${n.id}" data-nd="${d}">${ico(n.cierra ? 'candado' : 'nota')}<div class="tx"><b>${n.hora ? `<span class="hh">${n.hora}</span> ` : ''}${n.cierra ? 'No atiendo: ' : ''}${esc(n.texto)}</b>
      ${(n.repite || 'no') !== 'no' ? `<small>${esc(REPITE[n.repite])}</small>` : n.hasta ? `<small>Del ${dm(n.fecha)} al ${dm(n.hasta)}</small>` : ''}</div></div>`;
