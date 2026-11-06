const BARBER_DIAGNOSTIC_VERSION = 'prod-v1-3-estabilidad';

// ============================================================
// REDES SOCIALES · PEGA AQUÍ LOS ENLACES DE FERNANDO
// Ejemplo: facebook: 'https://www.facebook.com/usuario'
// Deja un valor vacío ('') para mantener esa red deshabilitada.
// ============================================================
const SOCIAL_LINKS = Object.freeze({
  facebook: '',
  tiktok: '',
  instagram: ''
});

const BARBER_DEBUG_FROM_URL = new URLSearchParams(window.location.search).get('debug') === '1';
let BARBER_DEBUG_ENABLED = BARBER_DEBUG_FROM_URL;
try {
  if (BARBER_DEBUG_FROM_URL) sessionStorage.setItem('barber_debug', '1');
  BARBER_DEBUG_ENABLED = BARBER_DEBUG_ENABLED || sessionStorage.getItem('barber_debug') === '1';
} catch (err) { /* El calendario y la reserva deben funcionar aunque el navegador bloquee almacenamiento. */ }
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
  let confirmedAvailabilityKey = '';
  let bookingInFlight = false;
  let pendingBookingAttempt = null;
  let bookingNeedsRecovery = false;
  let businessTimezone = 'America/Guatemala';
  let calendarVisibleMonth = '';
  const READ_TIMEOUT_MS = 45000;
  const WRITE_TIMEOUT_MS = 90000;

  async function apiCall(action, payload = {}) {
    const browserStarted = performance.now();
    const isWrite = action === 'createAppointment' || action === 'updatePublicAppointment';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), isWrite ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS);
    let response;
    try {
      response = await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
        signal: controller.signal
      });
      let envelope;
      try {
        envelope = await response.json();
      } catch (err) {
        const failure = new Error('El servidor devolvió una respuesta no válida.');
        failure.uncertain = true;
        throw failure;
      }
      recordTestTiming(action, envelope && envelope.timing, Math.round(performance.now() - browserStarted));
      if (!response.ok || !envelope || envelope.ok !== true) {
        const failure = new Error((envelope && envelope.error) || 'No se pudo completar la operación.');
        // Errores 5xx pueden ocurrir después de que Apps Script ya guardó la cita.
        failure.uncertain = response.status >= 500;
        throw failure;
      }
      return envelope.data;
    } catch (err) {
      if (err.name === 'AbortError') {
        const failure = new Error('La operación tardó demasiado. No cierres esta página hasta comprobar el resultado.');
        failure.uncertain = true;
        throw failure;
      }
      if (err instanceof TypeError) {
        const failure = new Error('Se perdió la conexión con el servidor.');
        failure.uncertain = true;
        throw failure;
      }
      throw err;
    } finally {
      window.clearTimeout(timeout);
    }
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
      if(Date.now()-Number(parsed.savedAt||0) > 24*60*60*1000) return null;
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
    const previousService=services.find(item=>String(item.id)===String(previousValue));
    services = cfg.services || [];
    service.innerHTML = '<option value="">Selecciona un servicio</option>' + services.map(s => `<option value="${escAttr(s.id)}">${esc(s.name)}</option>`).join('');
    if(previousValue && services.some(s=>String(s.id)===String(previousValue))) service.value=previousValue;
    service.disabled=false;
    const date = document.getElementById('date');
    businessTimezone = cfg.timezone || 'America/Guatemala';
    date.dataset.maxBookingDays = String(cfg.maxBookingDays || 90);
    refreshCalendarBounds_();
    refreshDatePickerLabel_();
    document.getElementById('datePickerButton').disabled=!service.value || bookingInFlight || bookingNeedsRecovery;
    const nextService=services.find(item=>String(item.id)===String(previousValue));
    if(previousValue && (!nextService || (previousService && Number(previousService.duration)!==Number(nextService.duration)))) onServiceChange();
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
      // El precalentamiento se realiza por trigger de Apps Script.
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

  // Calendario propio: el usuario nunca escribe la fecha en un teclado.
  // Siempre usamos YYYY-MM-DD y calculamos días al mediodía/UTC para evitar desfases.
  function localBusinessToday_(){
    const parts=new Intl.DateTimeFormat('en-US',{
      timeZone:businessTimezone,year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date());
    const find=type=>parts.find(x=>x.type===type).value;
    return `${find('year')}-${find('month')}-${find('day')}`;
  }

  function addCalendarDays_(iso,days){
    const d=new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate()+days);
    return d.toISOString().slice(0,10);
  }

  function validCalendarISO_(iso){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(iso||''))) return false;
    const d=new Date(`${iso}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===iso;
  }

  function refreshCalendarBounds_(){
    const input=document.getElementById('date');
    const today=localBusinessToday_();
    const days=Number(input.dataset.maxBookingDays||90);
    input.min=today;
    input.max=addCalendarDays_(today,Number.isInteger(days)&&days>=0?days:90);
    if(input.value && !isCalendarDateAllowed_(input.value)){
      input.value='';
      confirmedAvailabilityKey='';
      selectedTime='';selectedSlot=null;
      availabilityRequestSeq++;
      hideExtraWarning();
      setAvailabilitySectionVisible(false);
    }
    refreshDatePickerLabel_();
  }

  function isCalendarDateAllowed_(iso){
    const input=document.getElementById('date');
    return validCalendarISO_(iso) && (!input.min||iso>=input.min) && (!input.max||iso<=input.max);
  }

  function refreshDatePickerLabel_(){
    const selected=document.getElementById('date').value;
    document.getElementById('datePickerText').textContent=selected?formatDate(selected):'Selecciona una fecha';
  }

  function closeCalendar_(){
    document.getElementById('dateCalendar').hidden=true;
    document.getElementById('datePickerButton').setAttribute('aria-expanded','false');
  }

  function drawCalendar_(){
    const input=document.getElementById('date');
    const y=Number(calendarVisibleMonth.slice(0,4));
    const m=Number(calendarVisibleMonth.slice(5,7));
    const first=new Date(Date.UTC(y,m-1,1,12));
    const heading=first.toLocaleDateString('es-GT',{month:'long',year:'numeric',timeZone:'UTC'});
    document.getElementById('calendarTitle').textContent=heading.charAt(0).toUpperCase()+heading.slice(1);
    const offset=(first.getUTCDay()+6)%7;
    const count=new Date(Date.UTC(y,m,0,12)).getUTCDate();
    const elements=[];
    for(let i=0;i<offset;i++) elements.push('<span class="date-calendar-empty"></span>');
    const today=localBusinessToday_();
    for(let day=1;day<=count;day++){
      const iso=`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const disabled=!isCalendarDateAllowed_(iso);
      const classes=['date-calendar-day'];
      if(iso===today) classes.push('is-today');
      if(iso===input.value) classes.push('is-selected');
      elements.push(`<button type="button" class="${classes.join(' ')}" data-date="${iso}" aria-label="${day} de ${first.toLocaleDateString('es-GT',{month:'long',timeZone:'UTC'})} de ${y}" ${iso===input.value?'aria-pressed="true"':''} ${disabled?'disabled':''}>${day}</button>`);
    }
    document.getElementById('calendarDays').innerHTML=elements.join('');
    const prev=new Date(Date.UTC(y,m-2,1,12)).toISOString().slice(0,7);
    const next=new Date(Date.UTC(y,m,1,12)).toISOString().slice(0,7);
    document.getElementById('calendarPrev').disabled=prev<input.min.slice(0,7);
    document.getElementById('calendarNext').disabled=next>input.max.slice(0,7);
  }

  function moveCalendarMonth_(delta){
    const [y,m]=calendarVisibleMonth.split('-').map(Number);
    const month=new Date(Date.UTC(y,m-1+delta,1,12)).toISOString().slice(0,7);
    const input=document.getElementById('date');
    if(month<input.min.slice(0,7)||month>input.max.slice(0,7)) return;
    calendarVisibleMonth=month;
    drawCalendar_();
  }

  function setupDateCalendar_(){
    const trigger=document.getElementById('datePickerButton');
    const panel=document.getElementById('dateCalendar');
    trigger.addEventListener('click',()=>{
      if(trigger.disabled||bookingInFlight||bookingNeedsRecovery) return;
      if(!panel.hidden){closeCalendar_();return;}
      refreshCalendarBounds_();
      calendarVisibleMonth=(document.getElementById('date').value||localBusinessToday_()).slice(0,7);
      drawCalendar_();
      panel.hidden=false;
      trigger.setAttribute('aria-expanded','true');
    });
    document.getElementById('calendarPrev').addEventListener('click',()=>moveCalendarMonth_(-1));
    document.getElementById('calendarNext').addEventListener('click',()=>moveCalendarMonth_(1));
    document.getElementById('calendarClose').addEventListener('click',()=>{closeCalendar_();trigger.focus();});
    document.getElementById('calendarDays').addEventListener('click',ev=>{
      const day=ev.target.closest('[data-date]');
      if(!day||day.disabled) return;
      const value=day.dataset.date;
      if(!isCalendarDateAllowed_(value)) return;
      document.getElementById('date').value=value;
      refreshDatePickerLabel_();
      closeCalendar_();
      trigger.focus();
      loadDateInfo();
    });
    document.addEventListener('pointerdown',ev=>{
      if(!panel.hidden&&!document.getElementById('datePickerWrap').contains(ev.target)) closeCalendar_();
    });
    document.addEventListener('keydown',ev=>{
      if(ev.key==='Escape'&&!panel.hidden){closeCalendar_();trigger.focus();}
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    ensureTestTimingPanel();
    initSocialLinks();
    document.getElementById('service').addEventListener('change', onServiceChange);
    setupDateCalendar_();
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
      // El activador del servidor mantiene la caché; evitamos un POST adicional por visitante.
    }

    try {
      const cfg = await getPublicConfigWithRetry_();
      if(!applyPublicConfig_(cfg)) throw new Error('La configuración no contiene servicios disponibles.');
      savePublicConfigLocal_(cfg);
      setServiceReadyState_();
      // El precalentamiento periódico evita carga extra por cada visitante.
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
    confirmedAvailabilityKey = '';
    preferredEditTime = '';
    closeCalendar_();
    hideExtraWarning();
    clearMessage();

    const serviceId = document.getElementById('service').value;
    const date = document.getElementById('date');
    const box = document.getElementById('slots');

    renderServiceDescription(serviceId);
    date.value = '';
    refreshDatePickerLabel_();
    setDateStatus('', '');
    setAvailabilitySectionVisible(false);

    if(!serviceId){
      document.getElementById('datePickerButton').disabled = true;
      box.innerHTML = '<div class="empty" style="grid-column:1/-1">Selecciona un tipo de corte y una fecha.</div>';
      return;
    }

    document.getElementById('datePickerButton').disabled = false;
    box.innerHTML = '<div class="empty" style="grid-column:1/-1">Selecciona una fecha.</div>';
  }

  function setAvailabilitySectionVisible(visible){
    const section = document.getElementById('availabilitySection');
    if(!section) return;
    section.hidden = !visible;
  }

  function loadDateInfo(){
    // Cada consulta recibe un identificador. Si el usuario cambia de fecha o servicio
    // antes de que responda el servidor, las respuestas anteriores se descartan.
    const requestId = ++availabilityRequestSeq;
    selectedTime = '';
    selectedSlot = null;
    confirmedAvailabilityKey = '';
    hideExtraWarning();
    refreshCalendarBounds_();
    const serviceId = document.getElementById('service').value;
    const date = document.getElementById('date').value;
    const box = document.getElementById('slots');
    setAvailabilitySectionVisible(Boolean(date));
    clearMessage();
    setDateStatus('', '');

    if(!serviceId){
      setAvailabilitySectionVisible(false);
      box.innerHTML = '<div class="empty" style="grid-column:1/-1">Selecciona primero el tipo de corte.</div>';
      return;
    }
    if(!date){
      setAvailabilitySectionVisible(false);
      box.innerHTML = '<div class="empty" style="grid-column:1/-1">Selecciona una fecha.</div>';
      return;
    }

    // Validación inmediata del rango visible del calendario. El backend conserva
    // la validación definitiva, pero este control evita enviar una consulta que
    // sabemos que será rechazada y mantiene el aviso junto al selector de fecha.
    const dateInput = document.getElementById('date');
    if(!validCalendarISO_(date)){
      setDateStatus('Selecciona una fecha válida en el calendario.', 'blocked');
      return;
    }
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
        confirmedAvailabilityKey = `${serviceId}|${date}`;
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
    if(bookingInFlight||bookingNeedsRecovery||!confirmedAvailabilityKey) return;
    document.querySelectorAll('.slot').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    selectedTime = btn.dataset.time;
    selectedSlot = { time:selectedTime, extraordinary:btn.dataset.extra === '1' };
    if(selectedSlot.extraordinary) showExtraWarning(); else hideExtraWarning();
  }

  function setBookingFieldsLocked_(locked){
    document.getElementById('service').disabled = locked || !services.length;
    document.getElementById('datePickerButton').disabled = locked || !document.getElementById('service').value;
    document.getElementById('name').disabled = locked;
    document.getElementById('phone').disabled = locked;
    document.querySelectorAll('#slots .slot').forEach(btn=>{btn.disabled=locked;});
  }

  function newBookingRequestId_(){
    if(!window.crypto || !window.crypto.getRandomValues) throw new Error('Tu navegador no permite generar una solicitud segura. Actualízalo para reservar.');
    const bytes=new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return 'brq_'+Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  }

  async function submitBooking(){
    if(bookingInFlight) return;
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
    if(!bookingNeedsRecovery) refreshCalendarBounds_();
    if(!validCalendarISO_(payload.date) || (!bookingNeedsRecovery && !isCalendarDateAllowed_(payload.date))){
      showMessage('La fecha no es válida o ya quedó fuera del rango permitido. Selecciónala nuevamente.', 'error');
      loadDateInfo();
      return;
    }
    if(!/^\d{8}$/.test(payload.phone)){
      showMessage('El teléfono debe contener exactamente 8 dígitos.', 'error');
      document.getElementById('phone').focus();
      return;
    }
    if(!bookingNeedsRecovery && (confirmedAvailabilityKey!==`${payload.serviceId}|${payload.date}` || !selectedSlot || selectedSlot.time!==payload.time ||
        !Array.from(document.querySelectorAll('#slots .slot')).some(b=>b.dataset.time===payload.time && b.classList.contains('active')))){
      showMessage('Vuelve a seleccionar un horario disponible para esta fecha y este servicio.', 'error');
      loadDateInfo();
      return;
    }

    const editing = isEditingAppointment && Boolean(editToken);
    const signature = JSON.stringify(payload);
    if(!editing){
      if(pendingBookingAttempt && pendingBookingAttempt.signature !== signature){
        showMessage('Existe una reserva sin confirmar. Reintenta esa misma solicitud antes de cambiar sus datos.', 'error');
        return;
      }
      if(!pendingBookingAttempt){
        try { pendingBookingAttempt = {signature,requestId:newBookingRequestId_()}; }
        catch(err){showMessage(err.message,'error');return;}
      }
    }

    bookingInFlight=true;
    bookingNeedsRecovery=false;
    btn.disabled=true;
    btn.textContent=editing?'Guardando cambios...':'Registrando...';
    setBookingFieldsLocked_(true);
    const action=editing?'updatePublicAppointment':'createAppointment';
    const apiPayload=editing?{editToken,appointment:payload}:
      {appointment:{...payload,bookingRequestId:pendingBookingAttempt.requestId}};
    try {
      const result=await apiCall(action,apiPayload);
      pendingBookingAttempt=null;
      showBookingSuccess(result,payload);
    } catch(err){
      if(!editing && err.uncertain && pendingBookingAttempt){
        // Esta consulta NO crea citas: pregunta si el primer POST llegó a escribirse.
        try {
          const verification=await apiCall('getBookingAttemptStatus',{
            bookingRequestId:pendingBookingAttempt.requestId,phone:payload.phone
          });
          if(verification && verification.found && verification.appointment){
            pendingBookingAttempt=null;
            showBookingSuccess(verification,verification.appointment);
            return;
          }
        } catch(verificationError) {
          console.warn('[Barber] No se pudo verificar todavía el intento de reserva.',verificationError);
        }
        bookingNeedsRecovery=true;
        showMessage('No pudimos confirmar si la cita quedó registrada. Para evitar duplicados, pulsa «Verificar / reintentar». No cierres esta página ni cambies los datos hasta recibir la confirmación.', 'error');
      } else if(editing && err.uncertain){
        bookingNeedsRecovery=true;
        showMessage('No se pudo confirmar si los cambios quedaron guardados. Pulsa «Reintentar cambios»; no se creará una segunda cita.', 'error');
      } else {
        pendingBookingAttempt=null;
        bookingNeedsRecovery=false;
        showMessage(err.message || String(err), 'error');
        loadDateInfo();
      }
    } finally {
      bookingInFlight=false;
      btn.disabled=false;
      if(bookingNeedsRecovery){
        btn.textContent=editing?'Reintentar cambios':'Verificar / reintentar';
        setBookingFieldsLocked_(true);
      } else {
        btn.textContent=isEditingAppointment?'Guardar cambios':'Confirmar cita';
        setBookingFieldsLocked_(false);
      }
    }
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
    document.getElementById('datePickerButton').disabled = false;
    document.getElementById('date').value = lastBooking.date;
    refreshCalendarBounds_();
    refreshDatePickerLabel_();
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
    confirmedAvailabilityKey = '';
    pendingBookingAttempt = null;
    bookingNeedsRecovery = false;
    closeCalendar_();
    setAvailabilitySectionVisible(false);
    isEditingAppointment = false;
    editingAppointmentId = '';
    editToken = '';
    lastBooking = null;
    preferredEditTime = '';
    document.getElementById('service').value = '';
    renderServiceDescription('');
    document.getElementById('date').value = '';
    document.getElementById('datePickerButton').disabled = true;
    refreshDatePickerLabel_();
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
