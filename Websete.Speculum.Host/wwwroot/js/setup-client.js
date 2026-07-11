'use strict';

(async () => {
  const statusEl  = document.getElementById('status');
  const missingEl = document.getElementById('missing');
  try {
    const res  = await fetch('/api/admin/config/status');
    const data = await res.json();
    if (data.operational) {
      statusEl.textContent = 'Motor configurado — a redirecionar…';
      statusEl.className   = 'ok';
      window.location.replace('/');
      return;
    }
    statusEl.textContent = 'Motor aguarda configuração.';
    statusEl.className   = '';
    missingEl.innerHTML  = (data.missing || [])
      .map(s => `<li>${s}</li>`)
      .join('');
  } catch (err) {
    statusEl.textContent = 'Erro ao contactar o motor: ' + err.message;
  }
})();
