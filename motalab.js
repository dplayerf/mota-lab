/**
 * =====================================================
 * MOTALAB — CARTÃO FIDELIDADE  ·  JavaScript principal
 * =====================================================
 */

/* ─────────────────────────────────────────────────────
   CONFIGURAÇÕES
   ───────────────────────────────────────────────────── */
const CONFIG = {
  CHAVE_PIX:        '43.909.626/0001-28',
  NOME_RECEBEDOR:   'MotaLab Saude',
  CIDADE_RECEBEDOR: 'Lagoa de Roca',
  VALOR:            '70.00',
  DESCRICAO_PIX:    'Adesao Fidelidade',
  MAX_MEMBROS:      5,
};

/* ─────────────────────────────────────────────────────
   ESTADO
   ───────────────────────────────────────────────────── */
let userData    = {};
let cardFlipped = false;
let proxNum     = parseInt(localStorage.getItem('ml_nn') || '1');
let users       = JSON.parse(localStorage.getItem('ml_us') || '[]');
let tempDeps    = [];

/* ─────────────────────────────────────────────────────
   UTILITÁRIOS
   ───────────────────────────────────────────────────── */
function numCard(n) {
  return 'N° ' + String(n).padStart(7, '0');
}

function validCPF(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += +cpf[i] * (10 - i);
  let r = (s * 10) % 11; if (r >= 10) r = 0;
  if (r !== +cpf[9]) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += +cpf[i] * (11 - i);
  r = (s * 10) % 11; if (r >= 10) r = 0;
  return r === +cpf[10];
}

function iniciais(nome) {
  const p = nome.trim().split(' ').filter(Boolean);
  if (!p.length) return '?';
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[p.length-1][0]).toUpperCase();
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 3500);
}

function showLoading(show, msg = 'Processando...') {
  document.getElementById('loadingMsg').textContent = msg;
  document.getElementById('loadingOv').classList.toggle('show', show);
}

function mostrarScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function aplicarMascaraCPF(el) {
  if (!el) return;
  el.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, '$1.$2')
         .replace(/(\d{3}\.\d{3})(\d)/, '$1.$2')
         .replace(/(\d{3}\.\d{3}\.\d{3})(\d{1,2})/, '$1-$2');
    this.value = v;
  });
}

/* ─────────────────────────────────────────────────────
   INICIALIZAÇÃO
   ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  aplicarMascaraCPF(document.getElementById('iCpf'));
  aplicarMascaraCPF(document.getElementById('mCpf'));

  document.querySelectorAll('.pix-key-val').forEach(el => { el.textContent = CONFIG.CHAVE_PIX; });

  /* Fechar modais clicando fora */
  ['modalOv','modalLogin','modalMembro'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', function(e) {
      if (e.target === this) {
        if (id === 'modalLogin')  fecharLogin();
        else if (id === 'modalMembro') fecharModalMembro();
        else fecharModal();
      }
    });
  });

  verificarSessao();
});

/* ─────────────────────────────────────────────────────
   MODAL LOGIN
   ───────────────────────────────────────────────────── */
function abrirLogin() {
  /* Se já logado, vai direto para home */
  const saved = localStorage.getItem('ml_cur');
  if (saved) {
    try {
      const u = JSON.parse(saved);
      if (u.status === 'ativo') {
        userData = u;
        preencherHome();
        mostrarScreen('homeScreen');
        setTimeout(restaurarFoto, 200);
        return;
      }
    } catch { /* continua */ }
  }

  /* Limpa campos */
  document.getElementById('lEmail').value = '';
  document.getElementById('lSenha').value = '';
  document.getElementById('lEmail').classList.remove('err');
  document.getElementById('lSenha').classList.remove('err');
  document.getElementById('loginErr').style.display = 'none';

  document.getElementById('modalLogin').classList.add('open');
  setTimeout(() => document.getElementById('lEmail').focus(), 350);
}

function fecharLogin() {
  document.getElementById('modalLogin').classList.remove('open');
}

function fazerLogin() {
  const emailEl = document.getElementById('lEmail');
  const senhaEl = document.getElementById('lSenha');
  const errEl   = document.getElementById('loginErr');

  emailEl.classList.remove('err');
  senhaEl.classList.remove('err');
  errEl.style.display = 'none';

  const email = emailEl.value.trim().toLowerCase();
  const senha = senhaEl.value;

  if (!email || !senha) {
    if (!email) emailEl.classList.add('err');
    if (!senha) senhaEl.classList.add('err');
    showToast('Preencha e-mail e senha', 'err');
    return;
  }

  /* Recarrega users do localStorage */
  users = JSON.parse(localStorage.getItem('ml_us') || '[]');

  const encontrado = users.find(u =>
    u.email && u.email.toLowerCase() === email && u.senha === senha && u.status === 'ativo'
  );

  if (!encontrado) {
    errEl.style.display = 'flex';
    emailEl.classList.add('err');
    senhaEl.classList.add('err');
    return;
  }

  /* Login bem-sucedido */
  userData = encontrado;
  localStorage.setItem('ml_cur', JSON.stringify(userData));
  fecharLogin();
  showLoading(true, 'Entrando...');

  setTimeout(() => {
    showLoading(false);
    preencherHome();
    mostrarScreen('homeScreen');
    setTimeout(restaurarFoto, 200);
    showToast(`Bem-vindo(a), ${userData.nome.split(' ')[0]}! 👋`, 'ok');
  }, 900);
}

/* Enter no campo senha dispara login */
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('modalLogin').classList.contains('open')) {
    fazerLogin();
  }
});

/* ─────────────────────────────────────────────────────
   MODAL CADASTRO
   ───────────────────────────────────────────────────── */
function abrirCadastro() {
  const saved = localStorage.getItem('ml_cur');
  if (saved) {
    try {
      const u = JSON.parse(saved);
      if (u.status === 'ativo') {
        userData = u; preencherHome(); mostrarScreen('homeScreen'); setTimeout(restaurarFoto, 200); return;
      }
    } catch { }
  }
  document.getElementById('modalOv').classList.add('open');
  mostrarStep('cad');
}

function fecharModal() {
  document.getElementById('modalOv').classList.remove('open');
}

function mostrarStep(step) {
  ['cad','dep','pix','ok'].forEach(s => {
    document.getElementById('s-' + s).style.display = 'none';
  });
  document.getElementById('s-' + step).style.display = 'block';

  const map = { cad:1, dep:2, pix:3, ok:4 };
  const cur = map[step];
  [1,2,3,4].forEach(n => {
    const el = document.getElementById('ms' + n);
    if (el) el.className = 'mstep' + (n < cur ? ' done' : n === cur ? ' active' : '');
  });

  document.getElementById('modalBox').scrollTop = 0;
  if (step === 'pix') setTimeout(renderizarQrPix, 150);
  if (step === 'dep') renderizarDepList();
}

/* ─────────────────────────────────────────────────────
   STEP 1 — CADASTRO
   ───────────────────────────────────────────────────── */
function goToDeps() {
  const nome  = document.getElementById('iNome');
  const cpf   = document.getElementById('iCpf');
  const email = document.getElementById('iEmail');
  const senha = document.getElementById('iSenha');
  const conf  = document.getElementById('iConf');

  let ok = true;
  const cl = el => el.classList.remove('err');
  const er = el => { el.classList.add('err'); ok = false; };

  nome.value.trim().split(' ').filter(Boolean).length >= 2 ? cl(nome) : er(nome);
  validCPF(cpf.value)                                       ? cl(cpf)  : er(cpf);
  /\S+@\S+\.\S+/.test(email.value)                         ? cl(email): er(email);
  senha.value.length >= 6                                   ? cl(senha): er(senha);
  conf.value === senha.value && conf.value.length >= 6      ? cl(conf) : er(conf);

  if (!ok) { showToast('Verifique os campos em vermelho', 'err'); return; }

  /* Verifica se e-mail já existe */
  users = JSON.parse(localStorage.getItem('ml_us') || '[]');
  if (users.find(u => u.email && u.email.toLowerCase() === email.value.trim().toLowerCase())) {
    email.classList.add('err');
    showToast('Este e-mail já está cadastrado', 'err');
    return;
  }

  userData = {
    nome:  nome.value.trim(),
    cpf:   cpf.value,
    nasc:  document.getElementById('iNasc').value,
    email: email.value.trim(),
    senha: senha.value,
  };

  tempDeps = [];
  mostrarStep('dep');
}

function voltarCad() { mostrarStep('cad'); }

/* ─────────────────────────────────────────────────────
   STEP 2 — DEPENDENTES
   ───────────────────────────────────────────────────── */
function renderizarDepList() {
  const list    = document.getElementById('depList');
  const btn     = document.getElementById('btnAddDep');
  const counter = document.getElementById('depCounter');
  if (!list) return;

  list.innerHTML = '';
  tempDeps.forEach((dep, idx) => {
    const item = document.createElement('div');
    item.className = 'dep-item';
    item.innerHTML = `
      <div class="dep-item-avatar">${iniciais(dep.nome)}</div>
      <div class="dep-item-info">
        <div class="dep-item-name">${dep.nome}</div>
        <div class="dep-item-meta">${dep.parentesco} · CPF: ${dep.cpf}</div>
      </div>
      <button class="dep-item-remove" onclick="removerDep(${idx})" title="Remover">×</button>
    `;
    list.appendChild(item);
  });

  const total = tempDeps.length;
  if (counter) counter.textContent = `${total} de ${CONFIG.MAX_MEMBROS} vagas preenchidas`;
  if (btn) btn.disabled = total >= CONFIG.MAX_MEMBROS;
}

function adicionarDepForm() {
  if (tempDeps.length >= CONFIG.MAX_MEMBROS) { showToast(`Limite de ${CONFIG.MAX_MEMBROS} participantes`, 'err'); return; }
  const existing = document.getElementById('depFormInline');
  if (existing) { existing.remove(); return; }

  const list = document.getElementById('depList');
  const form = document.createElement('div');
  form.className = 'dep-form'; form.id = 'depFormInline';
  form.innerHTML = `
    <div class="row2" style="margin-bottom:8px;">
      <div class="field" style="margin-bottom:0;">
        <label>Nome completo</label>
        <input type="text" id="dfNome" placeholder="Nome do participante">
        <div class="errmsg">Informe o nome</div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>CPF</label>
        <input type="text" id="dfCpf" placeholder="000.000.000-00" maxlength="14">
        <div class="errmsg">CPF inválido</div>
      </div>
    </div>
    <div class="field" style="margin-bottom:8px;">
      <label>Parentesco</label>
      <select id="dfParentesco" class="field-select">
        <option value="Cônjuge">Cônjuge</option>
        <option value="Filho(a)">Filho(a)</option>
        <option value="Pai / Mãe">Pai / Mãe</option>
        <option value="Irmão(ã)">Irmão(ã)</option>
        <option value="Outro">Outro</option>
      </select>
    </div>
    <div class="dep-form-actions">
      <button class="dep-form-ok" onclick="confirmarDepForm()">✓ Adicionar</button>
      <button class="dep-form-cancel" onclick="cancelarDepForm()">Cancelar</button>
    </div>
  `;
  list.appendChild(form);
  aplicarMascaraCPF(document.getElementById('dfCpf'));
  document.getElementById('dfNome').focus();
}

function confirmarDepForm() {
  const nomeEl = document.getElementById('dfNome');
  const cpfEl  = document.getElementById('dfCpf');
  if (!nomeEl || !cpfEl) return;

  let ok = true;
  const nome = nomeEl.value.trim();
  const cpf  = cpfEl.value;

  nome.split(' ').filter(Boolean).length >= 2 ? nomeEl.classList.remove('err') : (nomeEl.classList.add('err'), ok=false);
  validCPF(cpf) ? cpfEl.classList.remove('err') : (cpfEl.classList.add('err'), ok=false);

  if (!ok) { showToast('Verifique os campos', 'err'); return; }

  tempDeps.push({ nome, cpf, parentesco: document.getElementById('dfParentesco').value });
  cancelarDepForm();
  renderizarDepList();
  showToast(`${nome.split(' ')[0]} adicionado(a)!`, 'ok');
}

function cancelarDepForm() {
  const f = document.getElementById('depFormInline');
  if (f) f.remove();
}

function removerDep(idx) {
  const nome = tempDeps[idx]?.nome?.split(' ')[0] || 'Participante';
  tempDeps.splice(idx, 1);
  renderizarDepList();
  showToast(`${nome} removido(a)`, '');
}

/* ─────────────────────────────────────────────────────
   STEP 3 — PAGAMENTO
   ───────────────────────────────────────────────────── */
function goToPix() {
  cancelarDepForm();
  mostrarStep('pix');
}
function voltarDep() { mostrarStep('dep'); }

function confirmarPix() {
  showLoading(true, 'Ativando seu cartão...');
  setTimeout(() => {
    showLoading(false);
    const num  = proxNum++;
    localStorage.setItem('ml_nn', proxNum);
    const hoje = new Date();
    const venc = new Date(); venc.setFullYear(venc.getFullYear() + 1);

    userData = {
      ...userData,
      numCartao:  num,
      dataAdesao: hoje.toLocaleDateString('pt-BR'),
      dataVenc:   venc.toLocaleDateString('pt-BR'),
      status:     'ativo',
      membros:    tempDeps.slice(),
      foto:       null,
    };

    users = JSON.parse(localStorage.getItem('ml_us') || '[]');
    users.push(userData);
    localStorage.setItem('ml_us',  JSON.stringify(users));
    localStorage.setItem('ml_cur', JSON.stringify(userData));
    mostrarStep('ok');
  }, 2200);
}

function irHome() {
  fecharModal();
  preencherHome();
  mostrarScreen('homeScreen');
}

/* ─────────────────────────────────────────────────────
   HOME — PREENCHER TELA
   ───────────────────────────────────────────────────── */
function preencherHome() {
  const u  = userData;
  const ns = numCard(u.numCartao);

  document.getElementById('hwbName').textContent = u.nome.split(' ')[0];

  /* Frente do cartão */
  document.getElementById('dcName').textContent = u.nome.toUpperCase();
  document.getElementById('dcNum').textContent  = ns;

  /* Verso do cartão */
  renderizarVersoCartao();

  /* Painel de dados */
  document.getElementById('infoNome').textContent  = u.nome;
  document.getElementById('infoCpf').textContent   = u.cpf;
  document.getElementById('infoEmail').textContent = u.email;
  document.getElementById('infoNum').textContent   = ns;
  document.getElementById('infoVal').textContent   = u.dataVenc || '—';

  /* Painel de participantes */
  renderizarMembrosPanel();
}

/* ─────────────────────────────────────────────────────
   FOTO DO USUÁRIO NO CARTÃO
   ───────────────────────────────────────────────────── */
function loadPhoto(input) {
  if (!input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;

    /* Salva no userData */
    userData.foto = dataUrl;
    localStorage.setItem('ml_cur', JSON.stringify(userData));
    const ui = users.findIndex(u => u.cpf === userData.cpf);
    if (ui >= 0) { users[ui] = userData; localStorage.setItem('ml_us', JSON.stringify(users)); }

    aplicarFotoNoCartao(dataUrl);
    showToast('Foto adicionada ao cartão!', 'ok');
  };
  reader.readAsDataURL(input.files[0]);
}

function aplicarFotoNoCartao(dataUrl) {
  const img         = document.getElementById('cardPhotoImg');
  const placeholder = document.getElementById('cardPhotoPlaceholder');
  if (!img) return;

  img.src = dataUrl;
  img.classList.add('visible');
  if (placeholder) placeholder.style.display = 'none';
}

function restaurarFoto() {
  if (userData.foto) {
    aplicarFotoNoCartao(userData.foto);
  }
}

/* ─────────────────────────────────────────────────────
   VERSO DO CARTÃO — participantes sem QR
   ───────────────────────────────────────────────────── */
function renderizarVersoCartao() {
  const cont = document.getElementById('cobMembers');
  if (!cont) return;

  const membros = userData.membros || [];
  let html = `<div class="cob-titular">★ ${userData.nome}</div>`;
  membros.forEach(m => {
    html += `<div class="cob-dep">· ${m.nome} <span style="opacity:0.65;">(${m.parentesco})</span></div>`;
  });

  cont.innerHTML = html;
}

/* ─────────────────────────────────────────────────────
   PAINEL DE PARTICIPANTES (home)
   ───────────────────────────────────────────────────── */
function renderizarMembrosPanel() {
  const panel = document.getElementById('membersPanel');
  const btn   = document.getElementById('addMemberBtn');
  const cnt   = document.getElementById('memberCount');
  if (!panel) return;

  const membros = userData.membros || [];
  if (cnt) cnt.textContent = `(${membros.length}/${CONFIG.MAX_MEMBROS})`;
  if (btn) btn.disabled = membros.length >= CONFIG.MAX_MEMBROS;

  let html = `
    <div class="mp-item">
      <div class="mp-avatar titular-av">${iniciais(userData.nome)}</div>
      <div class="mp-info">
        <div class="mp-name">${userData.nome}</div>
        <div class="mp-meta">CPF: ${userData.cpf}</div>
      </div>
      <span class="mp-badge titular">Titular</span>
    </div>
  `;

  if (!membros.length) {
    html += `<div class="members-empty">Nenhum participante adicionado ainda.</div>`;
  } else {
    membros.forEach((m, idx) => {
      html += `
        <div class="mp-item">
          <div class="mp-avatar">${iniciais(m.nome)}</div>
          <div class="mp-info">
            <div class="mp-name">${m.nome}</div>
            <div class="mp-meta">${m.parentesco} · CPF: ${m.cpf}</div>
          </div>
          <button class="mp-remove" onclick="removerMembro(${idx})" title="Remover">×</button>
        </div>
      `;
    });
  }

  panel.innerHTML = html;
}

function abrirAddMembro() {
  const membros = userData.membros || [];
  if (membros.length >= CONFIG.MAX_MEMBROS) { showToast(`Limite de ${CONFIG.MAX_MEMBROS} participantes atingido`, 'err'); return; }
  document.getElementById('mNome').value = '';
  document.getElementById('mCpf').value  = '';
  document.getElementById('mNome').classList.remove('err');
  document.getElementById('mCpf').classList.remove('err');
  document.getElementById('mParentesco').selectedIndex = 0;
  document.getElementById('modalMembro').classList.add('open');
}

function fecharModalMembro() {
  document.getElementById('modalMembro').classList.remove('open');
}

function salvarMembro() {
  const nomeEl = document.getElementById('mNome');
  const cpfEl  = document.getElementById('mCpf');
  let ok = true;
  const nome = nomeEl.value.trim();
  const cpf  = cpfEl.value;

  nome.split(' ').filter(Boolean).length >= 2 ? nomeEl.classList.remove('err') : (nomeEl.classList.add('err'), ok=false);
  validCPF(cpf) ? cpfEl.classList.remove('err') : (cpfEl.classList.add('err'), ok=false);

  if (!ok) { showToast('Verifique os campos', 'err'); return; }

  if (!userData.membros) userData.membros = [];
  userData.membros.push({ nome, cpf, parentesco: document.getElementById('mParentesco').value });

  localStorage.setItem('ml_cur', JSON.stringify(userData));
  users = JSON.parse(localStorage.getItem('ml_us') || '[]');
  const ui = users.findIndex(u => u.cpf === userData.cpf);
  if (ui >= 0) { users[ui] = userData; localStorage.setItem('ml_us', JSON.stringify(users)); }

  fecharModalMembro();
  renderizarMembrosPanel();
  renderizarVersoCartao();
  showToast(`${nome.split(' ')[0]} adicionado(a) ao plano!`, 'ok');
}

function removerMembro(idx) {
  if (!userData.membros) return;
  const nome = userData.membros[idx]?.nome || 'Participante';
  if (!confirm(`Remover ${nome} do plano?`)) return;
  userData.membros.splice(idx, 1);
  localStorage.setItem('ml_cur', JSON.stringify(userData));
  users = JSON.parse(localStorage.getItem('ml_us') || '[]');
  const ui = users.findIndex(u => u.cpf === userData.cpf);
  if (ui >= 0) { users[ui] = userData; localStorage.setItem('ml_us', JSON.stringify(users)); }
  renderizarMembrosPanel();
  renderizarVersoCartao();
  showToast(`${nome.split(' ')[0]} removido(a) do plano`, '');
}

/* ─────────────────────────────────────────────────────
   PIX — PAYLOAD & QR
   ───────────────────────────────────────────────────── */
function emvField(tag, value) { return `${tag}${String(value.length).padStart(2,'0')}${value}`; }

function gerarPayloadPix() {
  const chave  = CONFIG.CHAVE_PIX;
  const nome   = CONFIG.NOME_RECEBEDOR.slice(0,25);
  const cidade = CONFIG.CIDADE_RECEBEDOR.slice(0,15);
  const desc   = CONFIG.DESCRICAO_PIX.slice(0,25);
  const gui    = emvField('00','BR.GOV.BCB.PIX');
  const key    = emvField('01',chave);
  const addInf = desc ? emvField('02',desc) : '';
  const mai    = emvField('26', gui+key+addInf);
  let p = emvField('00','01')+mai+emvField('52','0000')+emvField('53','986')+
          emvField('54',CONFIG.VALOR)+emvField('58','BR')+emvField('59',nome)+
          emvField('60',cidade)+emvField('62',emvField('05','***'))+'6304';
  p += calcCRC16(p);
  return p;
}

function calcCRC16(payload) {
  const bytes = new TextEncoder().encode(payload);
  let crc = 0xFFFF;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i=0; i<8; i++) crc = (crc & 0x8000) ? ((crc<<1)^0x1021)&0xFFFF : (crc<<1)&0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4,'0');
}

function renderizarQrPix() {
  const canvas = document.getElementById('pixQrCanvas');
  if (!canvas) return;
  const payload = gerarPayloadPix();
  const size = 160;
  canvas.getContext('2d').clearRect(0,0,size,size);
  if (typeof QRCode !== 'undefined') {
    QRCode.toCanvas(canvas, payload, { width:size, margin:1, color:{ dark:'#12323A', light:'#FFFFFF' }, errorCorrectionLevel:'M' },
      err => { if (err) console.warn('QR Pix falhou', err); });
  }
}

function copiarPix() {
  const txt = CONFIG.CHAVE_PIX;
  const btn = document.querySelector('.copy-btn');
  const ok = () => {
    showToast('✅ Chave Pix copiada!', 'ok');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✅ Copiado!'; btn.classList.add('copied');
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2500);
    }
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(ok).catch(() => copiarFallback(txt,ok));
  else copiarFallback(txt,ok);
}

function copiarFallback(txt, cb) {
  const el = document.createElement('textarea');
  el.value = txt; el.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
  document.body.appendChild(el); el.select();
  try { document.execCommand('copy'); cb(); }
  catch { showToast('Copie manualmente', 'err'); }
  finally { document.body.removeChild(el); }
}

/* ─────────────────────────────────────────────────────
   FLIP & SESSÃO
   ───────────────────────────────────────────────────── */
function flipCard() {
  cardFlipped = !cardFlipped;
  document.getElementById('dcInner').classList.toggle('flipped', cardFlipped);
}

function verificarSessao() {
  const saved = localStorage.getItem('ml_cur');
  if (saved) {
    try {
      const u = JSON.parse(saved);
      if (u.status === 'ativo') {
        userData = u;
        preencherHome();
        mostrarScreen('homeScreen');
        setTimeout(restaurarFoto, 200);
        return;
      }
    } catch { }
  }
  mostrarScreen('landingScreen');
}

function logout() {
  if (!confirm('Deseja sair da sua conta?')) return;
  localStorage.removeItem('ml_cur');
  userData    = {};
  cardFlipped = false;
  document.getElementById('dcInner').classList.remove('flipped');
  /* Limpa foto */
  const img = document.getElementById('cardPhotoImg');
  const ph  = document.getElementById('cardPhotoPlaceholder');
  if (img) { img.src = ''; img.classList.remove('visible'); }
  if (ph)  ph.style.display = 'flex';
  mostrarScreen('landingScreen');
  window.scrollTo(0,0);
}

function goHome() {
  if (userData?.status === 'ativo') mostrarScreen('homeScreen');
  else { mostrarScreen('landingScreen'); window.scrollTo(0,0); }
}
