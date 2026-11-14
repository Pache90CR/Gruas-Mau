/* =============================================================================
   GRÚAS MAU · api/solicitud.js   (función del servidor en Vercel)

   Qué hace: recibe el formulario de la página (POST /api/solicitud) y manda una
   ALERTA INSTANTÁNEA con ntfy al celular del despacho secundario (7143-9256).
   Le llega en segundos, aunque el cliente no llegue a enviar su WhatsApp.

   El WhatsApp al 8875-5921 sale directo desde la página: al enviar el
   formulario se abre WhatsApp con el mensaje ya escrito y el cliente solo toca
   "Enviar".  Cada canal respalda al otro.

   Dónde va: en la raíz del proyecto, dentro de una carpeta llamada "api"
   (junto a index.html).  Ruta final:  api/solicitud.js

   Servicio de alertas: ntfy (https://ntfy.sh), gratis y sin cuenta.
   Se configura en Vercel (Settings → Environment Variables), NUNCA en el código:
       NTFY_TOPIC   →  nombre secreto del tema (funciona como contraseña)
   Opcionales:
       NTFY_SERVER  →  servidor propio de ntfy (por defecto https://ntfy.sh)
       NTFY_TOKEN   →  token de acceso, solo si se usa una cuenta de ntfy
   Después de guardar las variables hay que volver a desplegar (Redeploy).
   El celular recibe las alertas con la app ntfy, suscrita al mismo tema.
   ============================================================================= */
'use strict';

const ESPERA_ENVIO_MS = 4000;                    // tiempo máximo por intento
const INTENTOS = 2;                              // un reintento si ntfy falla por red o error 5xx
const PAUSA_REINTENTO_MS = 400;
const POR_IP = { max: 6, ventanaMs: 10 * 60 * 1000 };       // freno por visitante
const GENERAL = { max: 30, ventanaMs: 10 * 60 * 1000 };     // freno para todo el sitio
const REPETIDO_MS = 90 * 1000;                   // mismo pedido dos veces seguidas

/* Memoria temporal (se conserva mientras la función esté "caliente"). */
const estado = globalThis.__gruasMau || (globalThis.__gruasMau = { marcas: new Map(), vistos: new Map() });

/* Solo se acepta el enlace de Google Maps que genera la propia página. */
const RE_GPS = /^https:\/\/maps\.google\.com\/\?q=-?\d{1,3}(?:\.\d{1,8})?,-?\d{1,3}(?:\.\d{1,8})?$/;

/* ---------- Configuración (variables de Vercel) ---------- */

function leerConfig() {
  const tema = (process.env.NTFY_TOPIC || '').trim();
  if (!tema) return { error: 'Falta la variable NTFY_TOPIC en Vercel.' };
  if (!/^[-_A-Za-z0-9]{1,64}$/.test(tema)) {
    return { error: 'NTFY_TOPIC no es válido: solo letras, números, guion y guion bajo (máximo 64).' };
  }
  const servidor = (process.env.NTFY_SERVER || 'https://ntfy.sh').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(servidor)) return { error: 'NTFY_SERVER no es una dirección válida.' };
  if (tema.length < 16 && !estado.avisoTema) {
    estado.avisoTema = true;
    console.warn('[solicitud] El tema de ntfy es corto y fácil de adivinar. Usa uno largo y al azar.');
  }
  return { tema, servidor, token: (process.env.NTFY_TOKEN || '').trim() };
}

/* ---------- Limpieza de datos ---------- */

/* Una sola línea, sin caracteres de control ni invisibles. */
function limpiar(valor, max) {
  let t = '';
  const texto = typeof valor === 'string' || typeof valor === 'number' ? String(valor) : '';
  for (const ch of texto) {
    const c = ch.codePointAt(0);
    const raro = c < 32 || c === 127 || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0xfeff;
    t += raro ? ' ' : ch;
  }
  return t.replace(/\s+/g, ' ').trim().slice(0, max);
}

/* Devuelve solo dígitos con código de país (506 si escribieron 8 dígitos), o null si no sirve. */
function normalizarTelefono(valor) {
  let d = String(valor == null ? '' : valor).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = '506' + d;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

function mostrarTelefono(d) {
  if (d.length === 11 && d.startsWith('506')) return '+506 ' + d.slice(3, 7) + '-' + d.slice(7);
  return '+' + d;
}

function validar(b) {
  const d = {
    servicio: limpiar(b.servicio, 80),
    ubicacion: limpiar(b.ubicacion, 200),
    gps: typeof b.gps === 'string' && RE_GPS.test(b.gps.trim()) ? b.gps.trim() : '',
    destino: limpiar(b.destino, 200),
    vehiculo: limpiar(b.vehiculo, 200),
    nombre: limpiar(b.nombre, 80),
    telefono: normalizarTelefono(b.telefono)
  };
  if (!d.servicio) return { campo: 'servicio' };
  if (!d.ubicacion && !d.gps) return { campo: 'ubicacion' };
  if (d.nombre.length < 2) return { campo: 'nombre' };
  if (!d.telefono) return { campo: 'telefono' };
  return { d };
}

/* ---------- La alerta que llega al celular ---------- */

/* Al tocar la alerta se abre el chat de WhatsApp con el cliente; los botones
   permiten llamarlo o ver el mapa. */
function armarAlerta(d) {
  const l = ['Cliente: ' + d.nombre, 'Teléfono: ' + mostrarTelefono(d.telefono)];
  if (d.ubicacion) l.push('Ubicación: ' + d.ubicacion);
  if (d.gps) l.push('GPS: ' + d.gps);
  if (d.destino) l.push('Destino: ' + d.destino);
  if (d.vehiculo) l.push('Vehículo / carga: ' + d.vehiculo);
  const acciones = [{ action: 'view', label: 'Llamar', url: 'tel:+' + d.telefono }];
  if (d.gps) acciones.push({ action: 'view', label: 'Ver mapa', url: d.gps });
  return {
    title: 'Nueva solicitud: ' + d.servicio,
    message: l.join('\n'),
    priority: 5,
    tags: ['rotating_light'],
    click: 'https://wa.me/' + d.telefono,
    actions: acciones
  };
}

/* ---------- Envío (ntfy) ---------- */

function pausa(ms) { return new Promise(r => setTimeout(r, ms)); }

/* Texto corto para el registro de Vercel, sin el tema ni el token. */
function resumen(texto, cfg) {
  let t = String(texto == null ? '' : texto).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  for (const secreto of [cfg.tema, cfg.token]) if (secreto) t = t.split(secreto).join('***');
  return t;
}

async function enviarNtfy(cfg, aviso) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ESPERA_ENVIO_MS);
  try {
    const cabeceras = { 'Content-Type': 'application/json' };
    if (cfg.token) cabeceras.Authorization = 'Bearer ' + cfg.token;
    const r = await fetch(cfg.servidor + '/', {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify({ topic: cfg.tema, ...aviso }),
      signal: control.signal
    });
    const texto = await r.text();
    let j = null;
    try { j = JSON.parse(texto); } catch (e) { /* no era JSON */ }
    if (!r.ok) {
      const err = new Error('ntfy respondió ' + r.status + ': ' + resumen(texto, cfg));
      err.estado = r.status;
      throw err;
    }
    if (!j || (j.event !== 'message' && !j.id)) {
      const err = new Error('ntfy respondió algo inesperado: ' + resumen(texto, cfg));
      err.estado = 0;
      throw err;
    }
    return j;
  } finally {
    clearTimeout(reloj);
  }
}

/* Publica la alerta.  Si ntfy no acepta los botones o el enlace (error 400), se
   manda el aviso simple; si falla por red o error 5xx, se reintenta una vez. */
async function publicarAlerta(cfg, alerta) {
  let aviso = alerta;
  let ultimo = null;
  for (let intento = 1; intento <= INTENTOS; intento++) {
    try {
      return await enviarNtfy(cfg, aviso);
    } catch (e) {
      ultimo = e;
      if (e.estado === 400 && (aviso.actions || aviso.click)) {
        console.warn('[solicitud] ntfy rechazó los botones (400); se manda el aviso simple.');
        aviso = { ...aviso };
        delete aviso.actions;
        delete aviso.click;
        continue;
      }
      const reintentable = typeof e.estado !== 'number' || e.estado === 0 || e.estado >= 500;
      if (!reintentable || intento === INTENTOS) break;
      await pausa(PAUSA_REINTENTO_MS);
    }
  }
  throw ultimo;
}

/* ---------- Protección contra abuso ---------- */

function origenValido(req) {
  const origen = req.headers.origin;
  if (!origen) return true;
  try { return new URL(origen).host === req.headers.host; } catch (e) { return false; }
}

function ipDe(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || 'desconocida';
}

function permitido(clave, limite) {
  const ahora = Date.now();
  const marcas = (estado.marcas.get(clave) || []).filter(t => ahora - t < limite.ventanaMs);
  if (marcas.length >= limite.max) { estado.marcas.set(clave, marcas); return false; }
  marcas.push(ahora);
  estado.marcas.set(clave, marcas);
  if (estado.marcas.size > 500) {
    for (const [k, v] of estado.marcas) if (!v.some(t => ahora - t < 15 * 60 * 1000)) estado.marcas.delete(k);
  }
  return true;
}

function yaVisto(firma) {
  const ahora = Date.now();
  for (const [k, t] of estado.vistos) if (ahora - t > REPETIDO_MS) estado.vistos.delete(k);
  if (estado.vistos.has(firma)) return true;
  estado.vistos.set(firma, ahora);
  return false;
}

function leerCuerpo(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { return null; } }
  return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
}

/* ---------- Función principal ---------- */

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'metodo' });
  }
  if (!origenValido(req)) return res.status(403).json({ ok: false, error: 'origen' });

  const b = leerCuerpo(req);
  if (!b) return res.status(400).json({ ok: false, error: 'datos', campo: 'cuerpo' });

  /* Trampa para robots: este campo va oculto y una persona nunca lo llena.
     Se responde "todo bien" para que el robot no sepa que fue descubierto. */
  if (String(b.extra == null ? '' : b.extra).trim()) {
    return res.status(200).json({ ok: true });
  }

  const v = validar(b);
  if (!v.d) return res.status(400).json({ ok: false, error: 'datos', campo: v.campo });
  const d = v.d;

  if (!permitido('ip:' + ipDe(req), POR_IP) || !permitido('general', GENERAL)) {
    return res.status(429).json({ ok: false, error: 'demasiados' });
  }

  const cfg = leerConfig();
  if (cfg.error) {
    console.error('[solicitud] ' + cfg.error);
    return res.status(503).json({ ok: false, error: 'sin_configurar' });
  }

  /* Mismo pedido repetido (doble toque o reintento): se responde bien sin avisar otra vez. */
  const firma = [d.servicio, d.ubicacion, d.gps, d.nombre, d.telefono].join('|');
  if (yaVisto(firma)) {
    return res.status(200).json({ ok: true, repetido: true });
  }

  try {
    await publicarAlerta(cfg, armarAlerta(d));
  } catch (e) {
    console.error('[solicitud] No se pudo enviar la alerta por ntfy: ' + resumen(e && e.message, cfg));
    estado.vistos.delete(firma); // que un reintento sí se pueda enviar
    return res.status(502).json({ ok: false, error: 'envio' });
  }
  return res.status(200).json({ ok: true });
};
