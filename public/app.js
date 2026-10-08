const BARBER_DIAGNOSTIC_VERSION = 'prod-v1-1-social';

// ============================================================
// REDES SOCIALES · PEGA AQUÍ LOS ENLACES DE FERNANDO
// Ejemplo: facebook: 'https://www.facebook.com/usuario'
// Deja un valor vacío ('') para mantener esa red deshabilitada.
// ============================================================
const SOCIAL_LINKS = Object.freeze({
  facebook: 'https://www.facebook.com/share/1YviefD4vn/?mibextid=wwXIfr',
  tiktok: 'https://www.tiktok.com/@fernandobarbergt?_r=1&_t=ZS-9ANQxmaP4Jb',
  instagram: 'https://www.instagram.com/fernando_rd_21style?utm_source=qr'
});

const BARBER_DEBUG_FROM_URL = new URLSearchParams(window.location.search).get('debug') === '1';
if (BARBER_DEBUG_FROM_URL) sessionStorage.setItem('barber_debug', '1');
const BARBER_DEBUG_ENABLED = BARBER_DEBUG_FROM_URL || sessionStorage.getItem('barber_debug') === '1';
window.__BARBER_DIAGNOSTIC_VERSION__ = BARBER_DIAGNOSTIC_VERSION;

function initSocialLinks(){
  document.querySelectorAll('[data-social]').forEach(link => {
    const network = link.dataset.social;
    const url = String(SOCIAL_LINKS[network] || '').trim();
    if(url){
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.classList.remove('is-disabled');
      link.removeAttribute('aria-disabled');
    } else {
      link.removeAttribute('href');
      link.removeAttribute('target');
      link.removeAttribute('rel');
      link.classList.add('is-disabled');
      link.setAttribute('aria-disabled','true');
    }
  });
}

function ensureTestTimingPanel(){
  if(!BARBER_DEBUG_ENABLED) return null;
  let panel = document.getElementById('testTimingPanel');
  if(!panel){
    panel = document.createElement('pre');
    panel.id = 'testTimingPanel';
    panel.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;max-height:42vh;overflow:auto;margin:0;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.88);color:#fff;font:12px/1.35 monospace;white-space:pre-wrap;box-shadow:0 4px 24px rgba(0,0,0,.35)';
    document.body.appendChild(panel);
  }
  if(!panel.dataset.initialized){
    panel.dataset.initialized = '1';
    panel.textContent = 'BARBER PROD · DIAGNÓSTICO\nVersión: ' + BARBER_DIAGNOSTIC_VERSION + '\nEstado: activo, esperando respuesta del servidor...';
  }
  return panel;
}

let selectedTime = '';
  let selectedSlot = null;
  let services = [];
  let lastBooking = null;
  let editToken = '';
  let editingAppointmentId = '';
  let isEditingAppointment = false;
  let preferredEditTime = '';
  let availabilityRequestSeq = 0;

  async function apiCall(action, payload = {}) {
    const browserStarted = performance.now();
    const response = await fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload })
    });

    let envelope;
    try {
      envelope = await response.json();
    } catch (e) {
      throw new Error('El servidor devolvió una respuesta no válida.');
    }

    const browserTotalMs = Math.round(performance.now() - browserStarted);
    recordTestTiming(action, envelope && envelope.timing, browserTotalMs);

    if (!response.ok || !envelope || envelope.ok !== true) {
      throw new Error((envelope && envelope.error) || 'No se pudo completar la operación.');
    }
    return envelope.data;
  }

  function recordTestTiming(action, timing, browserTotalMs){
    const sample = {
      action,
      browserTotalMs,
      ...(timing || {})
    };
    window.__BARBER_LAST_TIMING__ = sample;
    window.__BARBER_TIMINGS__ = window.__BARBER_TIMINGS__ || [];
    window.__BARBER_TIMINGS__.push(sample);
    if(window.__BARBER_TIMINGS__.length > 30) window.__BARBER_TIMINGS__.shift();
    console.info('[Barber PROD timing]', sample);
    renderTestTiming(sample);
  }

  function renderTestTiming(sample){
    if(!BARBER_DEBUG_ENABLED) return;
    const panel = ensureTestTimingPanel();
    if(!panel) return;
    const a = sample.appsScript || {};
    const transportMs = Number.isFinite(sample.cloudflareToAppsScriptMs) && Number.isFinite(a.appsScriptTotalMs)
      ? Math.max(0, sample.cloudflareToAppsScriptMs - a.appsScriptTotalMs)
      : null;
    const browserEdgeMs = Number.isFinite(sample.browserTotalMs) && Number.isFinite(sample.cloudflareTotalMs)
      ? Math.max(0, sample.browserTotalMs - sample.cloudflareTotalMs)
      : null;
    const lines = [
      'BARBER PROD · DIAGNÓSTICO',
      `Acción: ${sample.action || '-'}`,
      `Navegador total: ${sample.browserTotalMs ?? '-'} ms`,
      `Navegador ↔ Cloudflare aprox.: ${browserEdgeMs ?? '-'} ms`,
      `Cloudflare total: ${sample.cloudflareTotalMs ?? '-'} ms`,
      `Cloudflare → Apps Script: ${sample.cloudflareToAppsScriptMs ?? '-'} ms`,
      `PublicConfig origen: ${sample.publicConfigSource || '-'}${Number.isFinite(sample.publicConfigAgeMs) ? ` · edad ${Math.round(sample.publicConfigAgeMs/1000)} s` : ''}`,
      `Transporte/redirect Google aprox.: ${transportMs ?? '-'} ms`,
      `Apps Script total: ${a.appsScriptTotalMs ?? '-'} ms`,
      `  Citas/Sheets: ${a.appointmentsReadMs ?? '-'} ms (${a.appointmentsCache || '-'})`,
      `  Horario: ${a.scheduleMs ?? '-'} ms`,
      `  Extraordinarios: ${a.extraHoursMs ?? '-'} ms`,
      `  Bloqueos: ${a.blocksMs ?? '-'} ms`,
      `  Pausas: ${a.breaksMs ?? '-'} ms`,
      `  Cálculo slots: ${a.slotCalculationMs ?? '-'} ms`,
      `  Validación reserva - citas: ${a.bookingAppointmentsMs ?? '-'} ms`,
      `  Revalidación reserva: ${a.bookingRevalidateMs ?? '-'} ms`,
      `  Escritura cita: ${a.bookingWriteMs ?? '-'} ms`,
      `  Actualización estado rápido: ${a.bookingFastStateMs ?? '-'} ms`,
      `Request ID Apps Script: ${a.requestId || '-'}`
    ];
    panel.textContent = lines.join('\n');
  }

  const PUBLIC_CONFIG_STORAGE_KEY = 'barber_public_config_v1';

  function savePublicConfigLocal_(cfg){
    try { localStorage.setItem(PUBLIC_CONFIG_STORAGE_KEY, JSON.stringify({savedAt:Date.now(),cfg})); } catch(e) {}
  }

  function loadPublicConfigLocal_(){
    try {
      const raw=localStorage.getItem(PUBLIC_CONFIG_STORAGE_KEY);
      if(!raw) return null;
      const parsed=JSON.parse(raw);
      if(!parsed || !parsed.cfg || !Array.isArray(parsed.cfg.services) || !parsed.cfg.services.length) return null;
      // Solo es fallback visual. Siempre intentamos refrescar contra el servidor al cargar.
      if(Date.now()-Number(parsed.savedAt||0) > 7*24*60*60*1000) return null;
      return parsed.cfg;
    } catch(e) { return null; }
  }

  function setServiceLoadingState_(text='Cargando servicios...'){
    const service=document.getElementById('service');
    const status=document.getElementById('serviceLoadStatus');
    if(!services.length){
      service.disabled=true;
      service.innerHTML='<option value="">Cargando servicios...</option>';
    }
    if(status){
      status.className='service-load-status loading';
      status.innerHTML=`<span class="service-spinner" aria-hidden="true"></span><span>${esc(text)}</span>`;
    }
  }

  function setServiceRefreshingState_(text='Servicios disponibles. Actualizando información...'){
    const service=document.getElementById('service');
    const status=document.getElementById('serviceLoadStatus');
    if(services.length) service.disabled=false;
    if(status){
      status.className='service-load-status refreshing';
      status.innerHTML=`<span class="service-spinner" aria-hidden="true"></span><span>${esc(text)}</span>`;
    }
  }

  function setServiceReadyState_(){
    const service=document.getElementById('service');
    const status=document.getElementById('serviceLoadStatus');
    service.disabled=services.length===0;
    if(status){
      status.className='service-load-status ready';
      status.innerHTML='<span class="service-ready-dot" aria-hidden="true"></span><span>Servicios disponibles.</span>';
      window.setTimeout(()=>{
        if(status.classList.contains('ready')) status.classList.add('compact');
      },1800);
    }
  }

  function setServiceErrorState_(message){
    const service=document.getElementById('service');
    const status=document.getElementById('serviceLoadStatus');
    if(!services.length){
      service.disabled=true;
      service.innerHTML='<option value="">No se pudieron cargar los servicios</option>';
    } else {
      service.disabled=false;
    }
    if(status){
      status.className='service-load-status error';
      status.innerHTML=`<span>${esc(message || 'No se pudieron actualizar los servicios.')}</span><button type="button" class="service-retry" onclick="retryPublicConfig()">Reintentar</button>`;
    }
  }

  function applyPublicConfig_(cfg){
    if(!cfg || !Array.isArray(cfg.services) || !cfg.services.length) return false;
    const service = document.getElementById('service');
    const previousValue = service.value;
    services = cfg.services || [];
    service.innerHTML = '<option value="">Selecciona un servicio</option>' + services.map(s => `<option value="${escAttr(s.id)}">${esc(s.name)}</option>`).join('');
    if(previousValue && services.some(s=>String(s.id)===String(previousValue))) service.value=previousValue;
    service.disabled=false;
    const date = document.getElementById('date');
    if(cfg.today) date.min = cfg.today;
    date.max = cfg.maxBookingDate || '';
    date.dataset.maxBookingDays = String(cfg.maxBookingDays || 90);
    return true;
  }

  async function getPublicConfigWithRetry_(){
    const waits=[0,450,1100];
    let lastErr=null;
    for(let i=0;i<waits.length;i++){
      if(waits[i]) await new Promise(r=>setTimeout(r,waits[i]));
      try { return await apiCall('getPublicConfig'); }
      catch(err){ lastErr=err; console.warn('[Barber TEST config retry]',i+1,err); }
    }
    throw lastErr || new Error('No se pudo cargar la configuración.');
  }

  async function retryPublicConfig(){
    if(services.length) setServiceRefreshingState_('Actualizando servicios...');
    else setServiceLoadingState_('Cargando servicios...');
    try {
      const cfg=await getPublicConfigWithRetry_();
      if(!applyPublicConfig_(cfg)) throw new Error('La configuración no contiene servicios disponibles.');
      savePublicConfigLocal_(cfg);
      setServiceReadyState_();
      warmAvailabilityCacheInBackground();
    } catch(err){
      console.warn('[Barber TEST config manual retry]',err);
      setServiceErrorState_(services.length ? 'No se pudo actualizar. Puedes continuar con la última lista disponible.' : 'No se pudieron cargar los servicios.');
    }
  }
  window.retryPublicConfig = retryPublicConfig;

  async function warmAvailabilityCacheInBackground(){
    const started = performance.now();
    try {
      const response = await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action:'warmAvailabilityCache', payload:{} })
      });
      const envelope = await response.json();
      window.__BARBER_WARM_STATUS__ = {
        ok: response.ok && envelope && envelope.ok === true,
        durationMs: Math.round(performance.now() - started),
        result: envelope && envelope.data ? envelope.data : null,
        timing: envelope && envelope.timing ? envelope.timing : null
      };
      console.info('[Barber TEST prewarm]', window.__BARBER_WARM_STATUS__);
    } catch(err) {
      window.__BARBER_WARM_STATUS__ = {
        ok:false,
        durationMs:Math.round(performance.now() - started),
        error:err && err.message ? err.message : String(err)
      };
      console.warn('[Barber TEST prewarm]', window.__BARBER_WARM_STATUS__);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    ensureTestTimingPanel();
    initSocialLinks();
    document.getElementById('service').addEventListener('change', onServiceChange);
    document.getElementById('date').addEventListener('change', loadDateInfo);
    document.getElementById('phone').addEventListener('input', enforcePhoneDigits);
    setupFloatingBrand();

    // V4: desde el primer frame dejamos claro que la lista todavía se está cargando.
    setServiceLoadingState_('Cargando servicios...');

    // Si el navegador ya tiene una configuración válida, la mostramos inmediatamente
    // y refrescamos contra Cloudflare en segundo plano. Así una visita recurrente no
    // espera a Apps Script para poder seleccionar un servicio.
    const localCfg=loadPublicConfigLocal_();
    const hadLocalConfig=applyPublicConfig_(localCfg);
    if(hadLocalConfig){
      setServiceRefreshingState_('Servicios disponibles. Actualizando información...');
      setTimeout(()=>warmAvailabilityCacheInBackground(),250);
    }

    try {
      const cfg = await getPublicConfigWithRetry_();
      if(!applyPublicConfig_(cfg)) throw new Error('La configuración no contiene servicios disponibles.');
      savePublicConfigLocal_(cfg);
      setServiceReadyState_();
      if(!hadLocalConfig) warmAvailabilityCacheInBackground();
    } catch (err) {
      if(hadLocalConfig){
        console.warn('[Barber TEST] Se conserva configuración local por fallo temporal del backend.',err);
        setServiceErrorState_('No se pudo actualizar. Puedes continuar con la última lista disponible.');
      } else {
        setServiceErrorState_('No se pudieron cargar los servicios.');
        showMessage(err.message || String(err), 'error');
      }
    }
  });

  function setupFloatingBrand(){
    const hero = document.getElementById('mainHero');
    const floating = document.getElementById('floatingBrand');
    if(!hero || !floating) return;
    const update = () => {
      const show = hero.getBoundingClientRect().bottom <= 86;
      floating.classList.toggle('visible', show);
      floating.setAttribute('aria-hidden', show ? 'false' : 'true');
    };
    update();
    window.addEventListener('scroll', update, {passive:true});
    window.addEventListener('resize', update);
  }

  function enforcePhoneDigits(e){
    e.target.value = String(e.target.value || '').replace(/\D/g,'').slice(0,8);
  }

  function onServiceChange(){
    // El servicio define la duración de la cita y, por lo tanto, su disponibilidad.
    // Al cambiarlo se invalida cualquier consulta previa y se obliga a elegir
    // nuevamente fecha y hora para evitar mezclar resultados del servicio anterior.
    availabilityRequestSeq++;
    selectedTime = '';
    selectedSlot = null;
    preferredEditTime = '';
    hideExtraWarning();
    clearMessage();

    const serviceId = document.getElementById('service').value;
    const date = document.getElementById('date');
    const box = document.getElementById('slots');

    renderServiceDescription(serviceId);
    date.value = '';
    setDateStatus('', '');

    if(!serviceId){
      date.disabled = true;
      box.innerHTML = '<div class="empty" style="grid-column:1/-1">Selecciona un tipo de corte y una fecha.</div>';
      return;
    }

    date.disabled = false;
    box.innerHTML = '<div class="empty" style="grid-column:1/-1">Selecciona una fecha.</div>';
  }

  function loadDateInfo(){
    // Cada consulta recibe un identificador. Si el usuario cambia de fecha o servicio
    // antes de que responda el servidor, las respuestas anteriores se descartan.
    const requestId = ++availabilityRequestSeq;
    selectedTime = '';
    selectedSlot = null;
    hideExtraWarning();
    const serviceId = document.getElementById('service').value;
    const date = document.getElementById('date').value;
    const box = document.getElementById('slots');
    clearMessage();
    setDateStatus('', '');

    if(!serviceId){
      box.innerHTML = '<div class="empty" style="grid-column:1/-1">Selecciona primero el tipo de corte.</div>';
      return;
    }
    if(!date){
      box.innerHTML = '<div class="empty" style="grid-column:1/-1">Selecciona una fecha.</div>';
      return;
    }

    // Validación inmediata del rango visible del calendario. El backend conserva
    // la validación definitiva, pero este control evita enviar una consulta que
    // sabemos que será rechazada y mantiene el aviso junto al selector de fecha.
    const dateInput = document.getElementById('date');
    if(dateInput.min && date < dateInput.min){
      setDateStatus('Esta fecha ya pasó. Selecciona una fecha a partir de hoy.', 'blocked');
      box.innerHTML = '<div class="empty" style="grid-column:1/-1">Selecciona una fecha válida para consultar horarios.</div>';
      return;
    }
    if(dateInput.max && date > dateInput.max){
      const maxDays = dateInput.dataset.maxBookingDays || '';
      const limitText = maxDays
        ? `Las citas pueden reservarse con un máximo de ${maxDays} días de anticipación. Última fecha disponible: ${formatDate(dateInput.max)}.`
        : `La última fecha disponible para reservar es ${formatDate(dateInput.max)}.`;
      setDateStatus(limitText, 'blocked');
      box.innerHTML = '<div class="empty" style="grid-column:1/-1">Selecciona una fecha dentro del rango permitido.</div>';
      return;
    }

    const isCurrentRequest = () =>
      requestId === availabilityRequestSeq &&
      document.getElementById('service').value === serviceId &&
      document.getElementById('date').value === date;

    box.innerHTML = '<div class="empty" style="grid-column:1/-1">Consultando horarios...</div>';
    const action = (isEditingAppointment && editToken)
      ? 'getEditableAvailability'
      : 'getDateAvailabilityInfo';
    const payload = (isEditingAppointment && editToken)
      ? { date, serviceId, editToken }
      : { date, serviceId };

    apiCall(action, payload)
      .then(info => {
        if(!isCurrentRequest()) return;
        renderAvailability(info);
      })
      .catch(err => {
        if(!isCurrentRequest()) return;
        box.innerHTML = '<div class="empty" style="grid-column:1/-1">No se pudo consultar la disponibilidad.</div>';
        showMessage(err.message || String(err), 'error');
      });
  }

  function renderAvailability(info){
    const box = document.getElementById('slots');
    const slots = info.slots || [];
    if(!slots.length){
      box.innerHTML = '<div class="empty" style="grid-column:1/-1">No hay horarios disponibles para este tipo de corte.</div>';
      if(info.reason) setDateStatus(info.reason, 'blocked');
      return;
    }

    setDateStatus('Fecha disponible. Selecciona una hora.', 'ok');
    box.innerHTML = slots.map(s => {
      const classes = ['slot'];
      if(s.extraordinary) classes.push('extra-slot');
      return `<button type="button" class="${classes.join(' ')}" data-time="${s.time}" data-extra="${s.extraordinary ? '1':'0'}" onclick="selectSlot(this)">${formatTime(s.time)}${s.extraordinary ? '<small class="extra-label">Extraordinario</small>' : ''}</button>`;
    }).join('');
    const wantedTime = preferredEditTime;
    preferredEditTime = '';
    if(isEditingAppointment && wantedTime){
      const current = Array.from(box.querySelectorAll('.slot')).find(b => b.dataset.time === wantedTime);
      if(current){
        current.classList.add('active');
        selectedTime = wantedTime;
        selectedSlot = {time:selectedTime, extraordinary:current.dataset.extra === '1'};
        if(selectedSlot.extraordinary) showExtraWarning();
      }
    }
  }

  function selectSlot(btn){
    document.querySelectorAll('.slot').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    selectedTime = btn.dataset.time;
    selectedSlot = { time:selectedTime, extraordinary:btn.dataset.extra === '1' };
    if(selectedSlot.extraordinary) showExtraWarning(); else hideExtraWarning();
  }

  function submitBooking(){
    const btn = document.getElementById('bookBtn');
    const payload = {
      serviceId: document.getElementById('service').value,
      date: document.getElementById('date').value,
      time: selectedTime,
      name: document.getElementById('name').value.trim(),
      phone: document.getElementById('phone').value.replace(/\D/g,'')
    };

    if(!payload.serviceId || !payload.date || !payload.time || !payload.name || !payload.phone){
      showMessage('Completa tipo de corte, fecha, hora, nombre y teléfono.', 'error');
      return;
    }
    if(!/^\d{8}$/.test(payload.phone)){
      showMessage('El teléfono debe contener exactamente 8 dígitos.', 'error');
      document.getElementById('phone').focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = isEditingAppointment ? 'Guardando cambios...' : 'Registrando...';
    const action = (isEditingAppointment && editToken)
      ? 'updatePublicAppointment'
      : 'createAppointment';
    const apiPayload = (isEditingAppointment && editToken)
      ? { editToken, appointment: payload }
      : { appointment: payload };

    apiCall(action, apiPayload)
      .then(res => {
        btn.disabled = false;
        btn.textContent = 'Confirmar cita';
        showBookingSuccess(res, payload);
      })
      .catch(err => {
        showMessage(err.message || String(err), 'error');
        btn.disabled = false;
        btn.textContent = isEditingAppointment ? 'Guardar cambios' : 'Confirmar cita';
        loadDateInfo();
      });
  }

  function showBookingSuccess(res, payload){
    const service = services.find(s => s.id === payload.serviceId);
    lastBooking = {
      id: res.id || editingAppointmentId || '',
      serviceId: payload.serviceId,
      service: (service && service.name) || res.service || '',
      date: payload.date,
      time: payload.time,
      name: payload.name,
      phone: payload.phone
    };
    if(res.editToken) editToken = res.editToken;
    if(res.id) editingAppointmentId = res.id;

    const logoHost = document.getElementById('successLogo');
    logoHost.innerHTML = '';
    const sourceLogo = document.querySelector('#mainHero .barber-logo');
    if(sourceLogo) logoHost.appendChild(sourceLogo.cloneNode(true));

    document.getElementById('successTitle').textContent = isEditingAppointment ? 'Cita Actualizada' : 'Cita Agendada';
    document.getElementById('successSummary').innerHTML = `
      <div><span>Servicio</span><strong>${esc(lastBooking.service)}</strong></div>
      <div><span>Fecha</span><strong>${esc(formatDate(payload.date))}</strong></div>
      <div><span>Hora</span><strong>${esc(formatTime(payload.time))}</strong></div>
      <div><span>Nombre</span><strong>${esc(payload.name)}</strong></div>
    `;

    // En confirmación dejamos únicamente el logo animado de esta sección.
    document.body.classList.add('success-mode');
    document.getElementById('mainHero').style.display = 'none';
    document.getElementById('bookingFormView').style.display = 'none';
    document.getElementById('bookingSuccessView').style.display = 'grid';
    hideExtraWarning();
    clearMessage();
    setTimeout(() => document.getElementById('bookingCard').scrollIntoView({behavior:'smooth', block:'start'}), 60);
  }

  function editLastAppointment(){
    if(!lastBooking || !editToken){
      showMessage('La sesión para modificar esta cita ya no está disponible.', 'error');
      return;
    }
    isEditingAppointment = true;
    document.body.classList.remove('success-mode');
    editingAppointmentId = lastBooking.id || editingAppointmentId;
    document.getElementById('bookingSuccessView').style.display = 'none';
    document.getElementById('bookingFormView').style.display = 'block';
    document.getElementById('mainHero').style.display = 'none';
    document.querySelector('#bookingFormView h3').textContent = 'Modificar tu cita';
    document.querySelector('#bookingFormView .sub').textContent = 'Puedes cambiar el tipo de corte, fecha, hora, nombre o teléfono. Volveremos a validar la disponibilidad antes de guardar.';
    document.getElementById('service').value = lastBooking.serviceId;
    renderServiceDescription(lastBooking.serviceId);
    document.getElementById('date').disabled = false;
    document.getElementById('date').value = lastBooking.date;
    document.getElementById('name').value = lastBooking.name;
    document.getElementById('phone').value = lastBooking.phone;
    document.getElementById('bookBtn').textContent = 'Guardar cambios';
    selectedTime = '';
    selectedSlot = null;
    preferredEditTime = lastBooking.time;
    loadDateInfo();
    setTimeout(() => document.getElementById('bookingCard').scrollIntoView({behavior:'smooth', block:'start'}), 60);
  }

  function resetBookingForm(){
    // Evita que una respuesta pendiente vuelva a pintar el formulario reiniciado.
    availabilityRequestSeq++;
    selectedTime = '';
    selectedSlot = null;
    isEditingAppointment = false;
    editingAppointmentId = '';
    editToken = '';
    lastBooking = null;
    preferredEditTime = '';
    document.getElementById('service').value = '';
    renderServiceDescription('');
    document.getElementById('date').value = '';
    document.getElementById('date').disabled = true;
    document.getElementById('name').value = '';
    document.getElementById('phone').value = '';
    document.getElementById('slots').innerHTML = '<div class="empty" style="grid-column:1/-1">Selecciona un tipo de corte y una fecha.</div>';
    document.querySelector('#bookingFormView h3').textContent = 'Agenda tu cita';
    document.querySelector('#bookingFormView .sub').textContent = 'Elige primero el tipo de corte. Los horarios se calculan según el tiempo requerido.';
    document.getElementById('bookBtn').textContent = 'Confirmar cita';
    setDateStatus('', '');
    clearMessage();
    hideExtraWarning();
  }

  function bookAnotherAppointment(){
    resetBookingForm();
    document.body.classList.remove('success-mode');
    document.getElementById('bookingSuccessView').style.display = 'none';
    document.getElementById('bookingFormView').style.display = 'block';
    document.getElementById('mainHero').style.display = '';
    window.scrollTo({top:0, behavior:'smooth'});
  }

  function renderServiceDescription(serviceId){
    const card=document.getElementById('serviceDescription');
    const svc=services.find(s=>s.id===serviceId);
    if(!svc){card.style.display='none';document.getElementById('serviceDescriptionTitle').textContent='';document.getElementById('serviceDescriptionText').textContent='';return;}
    document.getElementById('serviceDescriptionTitle').textContent=svc.name;
    document.getElementById('serviceDescriptionText').textContent=svc.description || 'Servicio de barbería personalizado según el estilo seleccionado.';
    card.style.display='block';
  }

  function showExtraWarning(){ document.getElementById('extraWarning').style.display = 'grid'; }
  function hideExtraWarning(){ document.getElementById('extraWarning').style.display = 'none'; }
  function setDateStatus(text,type){ const el=document.getElementById('dateStatus'); el.textContent=text; el.className='availability-note'+(type?' '+type:''); }
  function showMessage(text,type){ const el=document.getElementById('message'); el.textContent=text; el.className='message show '+type; }
  function clearMessage(){ const el=document.getElementById('message'); el.textContent=''; el.className='message'; }
  function formatDate(s){ const [y,m,d]=String(s).split('-'); return `${d}/${m}/${y}`; }
  function formatTime(t){ const [h,m]=t.split(':').map(Number); const d=new Date(); d.setHours(h,m,0,0); return d.toLocaleTimeString('es-GT',{hour:'numeric',minute:'2-digit'}); }
  function esc(s){ return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function escAttr(s){ return esc(s); }
