/**
 * ================================================================
 * MOTALAB — CARTÃO FIDELIDADE
 * Firebase Auth + Firestore + Storage
 * ================================================================
 * ESTRUTURA FIRESTORE:
 *
 *  /users/{uid}
 *    nome, cpf, nasc, email, telefone
 *    numCartao (código 8 dígitos sem repetição)
 *    dataAdesao, dataVenc, status
 *    membros: [{ nome, cpf, parentesco }]
 *    fotoUrl, createdAt, updatedAt
 *
 *  /codes/{codigo}   ← reserva de códigos únicos
 *    uid, criadoEm
 * ================================================================
 */

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, sendPasswordResetEmail,
  signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import {
  getFirestore, doc, setDoc, getDoc, updateDoc,
  runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js';
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js';

/* ── Firebase ── */
const app  = initializeApp({
  apiKey:            'AIzaSyDyJmQUyNKLGMdUJhdK2YxCYuaQkel7uiI',
  authDomain:        'mota-lab-e10e0.firebaseapp.com',
  projectId:         'mota-lab-e10e0',
  storageBucket:     'mota-lab-e10e0.firebasestorage.app',
  messagingSenderId: '1052790107201',
  appId:             '1:1052790107201:web:6321f87d3b73f324bc6ac0',
});
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

/* ── Config ── */
const CFG = {
  CHAVE_PIX: '43.909.626/0001-28',
  NOME_PIX:  'MotaLab Saude',
  CIDADE_PIX:'Lagoa de Roca',
  VALOR_PIX: '70.00',
  DESC_PIX:  'Adesao Fidelidade',
  MAX_MBR:   5,
  MAX_FOTO:  5,
};

/* ── Estado ── */
let userData      = null;
let cardFlipped   = false;
let tempDeps      = [];
let tempCadData   = null;
let isRegistering = false;

/* ================================================================
   AUTH OBSERVER — ponto central de sessão
   ================================================================ */
onAuthStateChanged(auth, async (user) => {
  if (isRegistering) return; // cadastro em andamento, não interferir

  if (user) {
    showLoading(true, 'Carregando seu cartão...');
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists() && snap.data().status === 'ativo') {
        userData = { uid: user.uid, ...snap.data() };
        atualizarNavbar(userData);
        preencherHome();
        mostrarTela('homeScreen');
        setTimeout(restaurarFoto, 200);
        showToast(`Bem-vindo(a), ${primeiroNome(userData.nome)}! 👋`, 'ok');
      } else {
        await signOut(auth);
        mostrarTela('landingScreen');
      }
    } catch (e) {
      console.error('[Observer]', e);
      showToast('Erro ao carregar dados. Verifique sua conexão.', 'err');
      await signOut(auth).catch(() => {});
      mostrarTela('landingScreen');
    } finally {
      showLoading(false);
    }
  } else {
    userData = null;
    atualizarNavbar(null);
    mostrarTela('landingScreen');
  }
});

/* ================================================================
   UTILITÁRIOS
   ================================================================ */
const primeiroNome = (nome = '') => nome.trim().split(' ')[0] || '—';

const iniciais = (nome = '') => {
  const p = nome.trim().split(' ').filter(Boolean);
  if (!p.length) return '?';
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[p.length-1][0]).toUpperCase();
};

const formatarCodigo = (c) => {
  const s = String(c).padStart(8, '0');
  return 'Nº ' + s.slice(0,4) + ' ' + s.slice(4);
};

const formatarTel = (v) => {
  v = v.replace(/\D/g, '').slice(0, 11);
  if (v.length <= 10) v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  else                v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
  return v;
};

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

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3500);
}

function showLoading(show, msg = 'Processando...') {
  document.getElementById('loadingMsg').textContent = msg;
  document.getElementById('loadingOv').classList.toggle('show', show);
}

function mostrarTela(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function mascaraCPF(el) {
  if (!el) return;
  el.addEventListener('input', function() {
    let v = this.value.replace(/\D/g,'').slice(0,11);
    v = v.replace(/(\d{3})(\d)/,'$1.$2')
         .replace(/(\d{3}\.\d{3})(\d)/,'$1.$2')
         .replace(/(\d{3}\.\d{3}\.\d{3})(\d{1,2})/,'$1-$2');
    this.value = v;
  });
}

/** Mostra/esconde senha */
window.togglePw = (id, btn) => {
  const el = document.getElementById(id);
  if (!el) return;
  const isText = el.type === 'text';
  el.type = isText ? 'password' : 'text';
  const open   = btn.querySelector('.eye-open');
  const closed = btn.querySelector('.eye-closed');
  if (open)   open.style.display   = isText ? '' : 'none';
  if (closed) closed.style.display = isText ? 'none' : '';
};

/** Modal de confirmação assíncrona */
function confirmarAcao(msg, tipo = 'danger') {
  return new Promise(resolve => {
    const ov  = document.getElementById('modalConfirm');
    const box = ov.querySelector('.confirm-box');
    document.getElementById('confirmMsg').textContent = msg;

    // Ícone SVG em vez de emoji
    const iconEl = document.getElementById('confirmIcon');
    if (tipo === 'logout') {
      iconEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26" style="color:var(--teal-dark)"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;
    } else {
      iconEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26" style="color:var(--red)"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/></svg>`;
    }

    // Subtítulo contextual
    let subEl = box.querySelector('.confirm-sub');
    if (!subEl) { subEl = document.createElement('p'); subEl.className = 'confirm-sub'; document.getElementById('confirmMsg').after(subEl); }
    subEl.textContent = tipo === 'logout' ? 'Você será desconectado da sua conta.' : 'Esta ação não pode ser desfeita.';

    // Texto dos botões
    document.getElementById('confirmSim').textContent = tipo === 'logout' ? 'Sair da conta' : 'Confirmar';
    document.getElementById('confirmNao').textContent = 'Cancelar';

    box.classList.toggle('logout', tipo === 'logout');
    ov.classList.add('open');

    const sim = document.getElementById('confirmSim');
    const nao = document.getElementById('confirmNao');
    const res = (v) => { ov.classList.remove('open'); sim.removeEventListener('click', hs); nao.removeEventListener('click', hn); resolve(v); };
    const hs  = () => res(true);
    const hn  = () => res(false);
    sim.addEventListener('click', hs);
    nao.addEventListener('click', hn);
  });
}

/* ================================================================
   NAVBAR
   ================================================================ */
function atualizarNavbar(user) {
  const guest = document.getElementById('navGuest');
  const prof  = document.getElementById('navUser');
  if (!guest || !prof) return;
  if (user) {
    document.getElementById('navUserName').textContent = user.nome || '—';
    document.getElementById('navAvatar').textContent   = iniciais(user.nome || '?');
    guest.style.display = 'none';
    prof.style.display  = 'flex';
  } else {
    guest.style.display = 'flex';
    prof.style.display  = 'none';
  }
}

/* ================================================================
   CÓDIGO ÚNICO — 8 dígitos sem repetição
   ================================================================ */
function gerarCodigoAleatorio() {
  const d = [0,1,2,3,4,5,6,7,8,9];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  if (d[0] === 0) {
    const idx = d.findIndex((x, i) => i > 0 && x !== 0);
    [d[0], d[idx]] = [d[idx], d[0]];
  }
  return d.slice(0, 8).join('');
}

async function gerarCodigoUnico() {
  for (let i = 0; i < 15; i++) {
    const codigo  = gerarCodigoAleatorio();
    const cRef    = doc(db, 'codes', codigo);
    let reservado = false;
    await runTransaction(db, async (t) => {
      const snap = await t.get(cRef);
      if (snap.exists()) return;
      t.set(cRef, { uid: auth.currentUser.uid, criadoEm: serverTimestamp() });
      reservado = true;
    });
    if (reservado) return codigo;
  }
  throw new Error('Não foi possível gerar código único.');
}

/* ================================================================
   MODAL LOGIN
   ================================================================ */
function abrirLogin() {
  ['lEmail','lSenha'].forEach(id => { const e = document.getElementById(id); if(e){e.value='';e.classList.remove('err');} });
  document.getElementById('loginErr').style.display = 'none';
  document.getElementById('modalLogin').classList.add('open');
  setTimeout(() => document.getElementById('lEmail')?.focus(), 350);
}
window.abrirLogin = abrirLogin;

function fecharLogin() { document.getElementById('modalLogin').classList.remove('open'); }
window.fecharLogin = fecharLogin;

async function fazerLogin() {
  const eEl = document.getElementById('lEmail');
  const sEl = document.getElementById('lSenha');
  const err = document.getElementById('loginErr');
  eEl.classList.remove('err'); sEl.classList.remove('err');
  err.style.display = 'none';
  const email = eEl.value.trim().toLowerCase();
  const senha = sEl.value;
  if (!email) eEl.classList.add('err');
  if (!senha) sEl.classList.add('err');
  if (!email || !senha) { showToast('Preencha e-mail e senha', 'err'); return; }
  showLoading(true, 'Entrando...'); fecharLogin();
  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (e) {
    showLoading(false);
    abrirLogin();
    err.style.display = 'flex';
    eEl.classList.add('err'); sEl.classList.add('err');
    if (e.code === 'auth/too-many-requests') showToast('Conta temporariamente bloqueada. Tente mais tarde.', 'err');
  }
}
window.fazerLogin = fazerLogin;

async function recuperarSenha() {
  const email = document.getElementById('lEmail').value.trim();
  if (!email || !/\S+@\S+\.\S+/.test(email)) {
    document.getElementById('lEmail').classList.add('err');
    showToast('Informe um e-mail válido primeiro.', 'err');
    return;
  }
  showLoading(true, 'Enviando e-mail...');
  try {
    await sendPasswordResetEmail(auth, email);
    fecharLogin();
    showToast('E-mail de recuperação enviado! Verifique sua caixa.', 'ok');
  } catch (e) {
    showToast('E-mail não encontrado.', 'err');
  } finally {
    showLoading(false);
  }
}
window.recuperarSenha = recuperarSenha;

/* ================================================================
   MODAL CADASTRO
   ================================================================ */
function abrirCadastro() {
  tempCadData = null; tempDeps = [];
  ['iNome','iCpf','iNasc','iEmail','iTel','iSenha','iConf'].forEach(id => {
    const el = document.getElementById(id); if (el) { el.value = ''; el.classList.remove('err'); }
  });
  document.getElementById('modalOv').classList.add('open');
  mostrarStep('cad');
}
window.abrirCadastro = abrirCadastro;

function fecharModal() { document.getElementById('modalOv').classList.remove('open'); }
window.fecharModal = fecharModal;

function mostrarStep(step) {
  ['cad','dep','pix','ok'].forEach(s => { document.getElementById('s-'+s).style.display = 'none'; });
  document.getElementById('s-'+step).style.display = 'block';
  const map = {cad:1,dep:2,pix:3,ok:4};
  const cur = map[step];
  [1,2,3,4].forEach(n => {
    const el = document.getElementById('ms'+n);
    if (el) el.className = 'step' + (n < cur ? ' done' : n === cur ? ' active' : '');
  });
  document.getElementById('modalBox').scrollTop = 0;
  if (step === 'dep') renderizarDepList();
  if (step === 'pix') setTimeout(renderizarQrPix, 150);
}

/* ── STEP 1 ── */
function goToDeps() {
  const nome  = document.getElementById('iNome');
  const cpf   = document.getElementById('iCpf');
  const nasc  = document.getElementById('iNasc');
  const email = document.getElementById('iEmail');
  const tel   = document.getElementById('iTel');
  const senha = document.getElementById('iSenha');
  const conf  = document.getElementById('iConf');
  let ok = true;
  const cl = el => el.classList.remove('err');
  const er = el => { el.classList.add('err'); ok = false; };
  nome.value.trim().split(' ').filter(Boolean).length >= 2 ? cl(nome) : er(nome);
  validCPF(cpf.value) ? cl(cpf) : er(cpf);
  nasc.value ? cl(nasc) : er(nasc);
  /\S+@\S+\.\S+/.test(email.value) ? cl(email) : er(email);
  tel.value.replace(/\D/g,'').length >= 10 ? cl(tel) : er(tel);
  senha.value.length >= 6 ? cl(senha) : er(senha);
  conf.value === senha.value && conf.value.length >= 6 ? cl(conf) : er(conf);
  if (!ok) { showToast('Verifique os campos em vermelho', 'err'); return; }
  tempCadData = {
    nome:  nome.value.trim(),
    cpf:   cpf.value,
    nasc:  nasc.value,
    email: email.value.trim().toLowerCase(),
    tel:   tel.value,
    senha: senha.value,
  };
  tempDeps = [];
  mostrarStep('dep');
}
window.goToDeps = goToDeps;
window.voltarCad = () => mostrarStep('cad');

/* ── STEP 2 ── */
function renderizarDepList() {
  const list = document.getElementById('depList');
  const btn  = document.getElementById('btnAddDep');
  const cnt  = document.getElementById('depCounter');
  if (!list) return;
  list.innerHTML = '';
  tempDeps.forEach((d, idx) => {
    const item = document.createElement('div');
    item.className = 'dep-item';
    item.innerHTML = `
      <div class="dep-item-av">${iniciais(d.nome)}</div>
      <div class="dep-item-info">
        <div class="dep-item-name">${d.nome}</div>
        <div class="dep-item-meta">${d.parentesco} · CPF: ${d.cpf}</div>
      </div>
      <button class="dep-item-rm" onclick="removerDep(${idx})">×</button>`;
    list.appendChild(item);
  });
  if (cnt) cnt.textContent = `${tempDeps.length} de ${CFG.MAX_MBR} vagas preenchidas`;
  if (btn) btn.disabled = tempDeps.length >= CFG.MAX_MBR;
}

function adicionarDepForm() {
  if (tempDeps.length >= CFG.MAX_MBR) { showToast(`Limite de ${CFG.MAX_MBR} participantes`, 'err'); return; }
  const ex = document.getElementById('depFormInline');
  if (ex) { ex.remove(); return; }
  const list = document.getElementById('depList');
  const form = document.createElement('div');
  form.className = 'dep-form'; form.id = 'depFormInline';
  form.innerHTML = `
    <div class="row2" style="margin-bottom:8px;">
      <div class="field" style="margin-bottom:0;"><label>Nome completo</label><input type="text" id="dfNome" placeholder="Nome do participante"><div class="errmsg">Informe o nome</div></div>
      <div class="field" style="margin-bottom:0;"><label>CPF</label><input type="text" id="dfCpf" placeholder="000.000.000-00" maxlength="14"><div class="errmsg">CPF inválido</div></div>
    </div>
    <div class="field" style="margin-bottom:8px;"><label>Parentesco</label>
      <select id="dfParentesco" class="field-select">
        <option value="Cônjuge">Cônjuge</option><option value="Filho(a)">Filho(a)</option>
        <option value="Pai / Mãe">Pai / Mãe</option><option value="Irmão(ã)">Irmão(ã)</option>
        <option value="Outro">Outro</option>
      </select>
    </div>
    <div class="dep-form-actions">
      <button class="dep-form-ok" onclick="confirmarDepForm()">✓ Adicionar</button>
      <button class="dep-form-cancel" onclick="cancelarDepForm()">Cancelar</button>
    </div>`;
  list.appendChild(form);
  mascaraCPF(document.getElementById('dfCpf'));
  document.getElementById('dfNome').focus();
}
window.adicionarDepForm = adicionarDepForm;

function confirmarDepForm() {
  const nEl = document.getElementById('dfNome');
  const cEl = document.getElementById('dfCpf');
  if (!nEl || !cEl) return;
  let ok = true;
  const nome = nEl.value.trim(), cpf = cEl.value;
  nome.split(' ').filter(Boolean).length >= 2 ? nEl.classList.remove('err') : (nEl.classList.add('err'), ok=false);
  validCPF(cpf) ? cEl.classList.remove('err') : (cEl.classList.add('err'), ok=false);
  if (!ok) { showToast('Verifique os campos', 'err'); return; }
  tempDeps.push({ nome, cpf, parentesco: document.getElementById('dfParentesco').value });
  cancelarDepForm();
  renderizarDepList();
  showToast(`${primeiroNome(nome)} adicionado(a)!`, 'ok');
}
window.confirmarDepForm = confirmarDepForm;

function cancelarDepForm() { document.getElementById('depFormInline')?.remove(); }
window.cancelarDepForm = cancelarDepForm;

function removerDep(idx) {
  tempDeps.splice(idx, 1);
  renderizarDepList();
}
window.removerDep = removerDep;

/* ── STEP 3 ── */
function goToPix() { cancelarDepForm(); mostrarStep('pix'); }
window.goToPix  = goToPix;
window.voltarDep = () => mostrarStep('dep');

/* ── STEP 4 — CRIAR CONTA + SALVAR ── */
async function confirmarPix() {
  if (!tempCadData) { showToast('Dados inválidos. Reinicie o cadastro.', 'err'); return; }
  let createdUser = null;
  isRegistering   = true;
  showLoading(true, 'Criando sua conta...');
  try {
    const cred   = await createUserWithEmailAndPassword(auth, tempCadData.email, tempCadData.senha);
    createdUser  = cred.user;
    showLoading(true, 'Gerando seu código exclusivo...');
    const numCartao = await gerarCodigoUnico();
    showLoading(true, 'Salvando seus dados...');
    const hoje = new Date(), venc = new Date();
    venc.setFullYear(venc.getFullYear() + 1);
    const docData = {
      uid:        createdUser.uid,
      nome:       tempCadData.nome,
      cpf:        tempCadData.cpf,
      nasc:       tempCadData.nasc,
      email:      tempCadData.email,
      telefone:   tempCadData.tel,
      numCartao,
      dataAdesao: hoje.toLocaleDateString('pt-BR'),
      dataVenc:   venc.toLocaleDateString('pt-BR'),
      status:     'ativo',
      membros:    tempDeps.slice(),
      fotoUrl:    null,
      createdAt:  serverTimestamp(),
      updatedAt:  serverTimestamp(),
    };
    await setDoc(doc(db, 'users', createdUser.uid), docData);
    userData      = { ...docData };
    isRegistering = false;
    atualizarNavbar(userData);
    showLoading(false);
    mostrarStep('ok');
  } catch (err) {
    isRegistering = false;
    showLoading(false);
    console.error('[confirmarPix]', err.code, err.message);
    if (createdUser && err.code !== 'auth/email-already-in-use') {
      try { await createdUser.delete(); } catch {}
    }
    const msgs = {
      'auth/email-already-in-use':       null,
      'auth/operation-not-allowed':      '⚠️ Ative Email/Password em Authentication → Sign-in method.',
      'auth/weak-password':              'Senha muito fraca. Use ao menos 6 caracteres.',
      'auth/invalid-email':              'E-mail inválido.',
      'auth/network-request-failed':     'Sem conexão com a internet.',
      'auth/too-many-requests':          'Muitas tentativas. Aguarde alguns minutos.',
      'permission-denied':               'Permissão negada. Verifique as regras do Firestore.',
    };
    if (err.code === 'auth/email-already-in-use') {
      showToast('Este e-mail já está cadastrado. Faça login.', 'err');
      fecharModal(); abrirLogin();
    } else {
      showToast(msgs[err.code] || `Erro: ${err.code}`, 'err');
      if (['auth/weak-password','auth/invalid-email'].includes(err.code)) mostrarStep('cad');
    }
  }
}
window.confirmarPix = confirmarPix;

function irHome() { fecharModal(); preencherHome(); mostrarTela('homeScreen'); }
window.irHome = irHome;

/* ================================================================
   HOME — PREENCHER TELA
   ================================================================ */
function preencherHome() {
  if (!userData) return;
  const u  = userData;
  const nc = formatarCodigo(u.numCartao);

  // Welcome bar
  document.getElementById('hwbName').textContent = primeiroNome(u.nome);

  // Frente do cartão
  document.getElementById('dcName').textContent = u.nome.toUpperCase();
  if (u.dataVenc) {
    const p = u.dataVenc.split('/');
    document.getElementById('dcVenc').textContent = p.length === 3 ? `${p[1]}/${p[2]}` : u.dataVenc;
  }

  // Verso do cartão — dados pessoais
  const fbNome = document.getElementById('fbNome');
  const fbCpf  = document.getElementById('fbCpf');
  const fbNum  = document.getElementById('fbNum');
  const fbVenc = document.getElementById('fbVenc');
  if (fbNome) fbNome.textContent = u.nome.toUpperCase();
  if (fbCpf)  fbCpf.textContent  = u.cpf;
  if (fbNum)  fbNum.textContent   = nc;
  if (fbVenc) fbVenc.textContent  = u.dataVenc || '—';

  // Dados do cadastro
  document.getElementById('infoNome').textContent   = u.nome;
  document.getElementById('infoCpf').textContent    = u.cpf;
  document.getElementById('infoEmail').textContent  = u.email;
  document.getElementById('infoTel').textContent    = u.telefone || '—';
  document.getElementById('infoNasc').textContent   = u.nasc ? formatarDataNasc(u.nasc) : '—';
  document.getElementById('infoNum').textContent    = nc;
  document.getElementById('infoAdesao').textContent = u.dataAdesao || '—';
  document.getElementById('infoVal').textContent    = u.dataVenc   || '—';

  renderizarVersoMembros();
  renderizarMembrosPanel();
  atualizarNavbar(u);
}

function formatarDataNasc(nasc) {
  if (!nasc) return '—';
  const [y, m, d] = nasc.split('-');
  return y && m && d ? `${d}/${m}/${y}` : nasc;
}

/* ================================================================
   VERSO DO CARTÃO — participantes
   ================================================================ */
function renderizarVersoMembros() {
  const cont = document.getElementById('cobMembers');
  if (!cont || !userData) return;
  const membros = userData.membros || [];
  // Titular sempre aparece primeiro
  let html = `<div class="fb-m-titular">★ ${userData.nome} <span style="opacity:0.55;font-size:0.85em;">(Titular)</span></div>`;
  membros.forEach(m => {
    html += `<div class="fb-m-row">· ${m.nome} <span style="opacity:.6;">(${m.parentesco})</span></div>`;
  });
  cont.innerHTML = html;
}

/* ================================================================
   PAINEL DE PARTICIPANTES (home)
   ================================================================ */
function renderizarMembrosPanel() {
  const panel = document.getElementById('membersPanel');
  const btn   = document.getElementById('addMemberBtn');
  const cnt   = document.getElementById('memberCount');
  if (!panel || !userData) return;
  const membros = userData.membros || [];
  // Total = 1 titular + dependentes. Máximo total = 6 (1 titular + 5 dependentes)
  const totalPlano = 1 + membros.length;
  const totalMax   = 1 + CFG.MAX_MBR;
  if (cnt) cnt.textContent = `(${totalPlano}/${totalMax})`;
  if (btn) btn.disabled = membros.length >= CFG.MAX_MBR;
  let html = `
    <div class="mp-item">
      <div class="mp-av titular">${iniciais(userData.nome)}</div>
      <div class="mp-info">
        <div class="mp-name">${userData.nome}</div>
        <div class="mp-meta">CPF: ${userData.cpf}</div>
      </div>
      <span class="mp-badge">Titular</span>
    </div>`;
  if (!membros.length) {
    html += `<div class="mp-empty">Nenhum participante adicionado.</div>`;
  } else {
    membros.forEach((m, idx) => {
      html += `
        <div class="mp-item">
          <div class="mp-av">${iniciais(m.nome)}</div>
          <div class="mp-info">
            <div class="mp-name">${m.nome}</div>
            <div class="mp-meta">${m.parentesco} · CPF: ${m.cpf}</div>
          </div>
          <button class="mp-rm" onclick="removerMembro(${idx})">×</button>
        </div>`;
    });
  }
  panel.innerHTML = html;
}

function abrirAddMembro() {
  if ((userData?.membros || []).length >= CFG.MAX_MBR) { showToast(`Limite de ${CFG.MAX_MBR} participantes`, 'err'); return; }
  ['mNome','mCpf'].forEach(id => { const e=document.getElementById(id); if(e){e.value='';e.classList.remove('err');} });
  document.getElementById('mParentesco').selectedIndex = 0;
  document.getElementById('modalMembro').classList.add('open');
}
window.abrirAddMembro = abrirAddMembro;

function fecharModalMembro() { document.getElementById('modalMembro').classList.remove('open'); }
window.fecharModalMembro = fecharModalMembro;

async function salvarMembro() {
  const nEl = document.getElementById('mNome');
  const cEl = document.getElementById('mCpf');
  let ok = true;
  const nome = nEl.value.trim(), cpf = cEl.value;
  nome.split(' ').filter(Boolean).length >= 2 ? nEl.classList.remove('err') : (nEl.classList.add('err'), ok=false);
  validCPF(cpf) ? cEl.classList.remove('err') : (cEl.classList.add('err'), ok=false);
  if (!ok) { showToast('Verifique os campos', 'err'); return; }
  if (!userData.membros) userData.membros = [];
  const novo = { nome, cpf, parentesco: document.getElementById('mParentesco').value };
  userData.membros.push(novo);
  showLoading(true, 'Salvando participante...');
  try {
    await updateDoc(doc(db, 'users', auth.currentUser.uid), { membros: userData.membros, updatedAt: serverTimestamp() });
    fecharModalMembro();
    renderizarMembrosPanel();
    renderizarVersoMembros();
    showToast(`${primeiroNome(nome)} adicionado(a) ao plano!`, 'ok');
  } catch (e) {
    userData.membros.pop();
    console.error('[salvarMembro]', e);
    showToast('Erro ao salvar. Verifique sua conexão.', 'err');
  } finally {
    showLoading(false);
  }
}
window.salvarMembro = salvarMembro;

async function removerMembro(idx) {
  if (!userData?.membros) return;
  const nome = primeiroNome(userData.membros[idx]?.nome || 'Participante');
  const ok   = await confirmarAcao(`Remover ${nome} do plano?`);
  if (!ok) return;
  const backup = [...userData.membros];
  userData.membros.splice(idx, 1);
  showLoading(true, 'Removendo...');
  try {
    await updateDoc(doc(db, 'users', auth.currentUser.uid), { membros: userData.membros, updatedAt: serverTimestamp() });
    renderizarMembrosPanel();
    renderizarVersoMembros();
    showToast(`${nome} removido(a) do plano`, '');
  } catch (e) {
    userData.membros = backup;
    renderizarMembrosPanel();
    showToast('Erro ao remover. Tente novamente.', 'err');
  } finally {
    showLoading(false);
  }
}
window.removerMembro = removerMembro;

/* ================================================================
   FOTO DO CARTÃO — Firebase Storage
   ================================================================ */
async function loadPhoto(input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];
  if (file.size > CFG.MAX_FOTO * 1024 * 1024) { showToast(`Imagem muito grande. Máximo ${CFG.MAX_FOTO}MB.`, 'err'); return; }
  if (!file.type.startsWith('image/')) { showToast('Selecione uma imagem válida.', 'err'); return; }
  showLoading(true, 'Enviando foto...');
  try {
    const uid  = auth.currentUser.uid;
    const ref  = sRef(storage, `photos/${uid}`);
    await uploadBytes(ref, file);
    const url  = await getDownloadURL(ref);
    await updateDoc(doc(db, 'users', uid), { fotoUrl: url, updatedAt: serverTimestamp() });
    userData.fotoUrl = url;
    aplicarFoto(url);
    showToast('Foto adicionada ao cartão!', 'ok');
  } catch (e) {
    console.error('[loadPhoto]', e);
    showToast('Erro ao enviar foto. Tente novamente.', 'err');
  } finally {
    showLoading(false);
    input.value = '';
  }
}
window.loadPhoto = loadPhoto;

function aplicarFoto(url) {
  const img = document.getElementById('cardPhotoImg');
  const ph  = document.getElementById('cardPhotoPlaceholder');
  if (!img || !url) return;
  img.src = url;
  img.classList.add('visible');
  if (ph) ph.style.display = 'none';
}

function restaurarFoto() { if (userData?.fotoUrl) aplicarFoto(userData.fotoUrl); }

/* ================================================================
   PIX — PAYLOAD EMV + QR
   ================================================================ */
const emvF = (tag, v) => `${tag}${String(v.length).padStart(2,'0')}${v}`;

function gerarPayloadPix() {
  const gui  = emvF('00','BR.GOV.BCB.PIX');
  const key  = emvF('01', CFG.CHAVE_PIX);
  const ai   = CFG.DESC_PIX ? emvF('02', CFG.DESC_PIX.slice(0,25)) : '';
  const mai  = emvF('26', gui + key + ai);
  let p = emvF('00','01') + mai + emvF('52','0000') + emvF('53','986') +
          emvF('54', CFG.VALOR_PIX) + emvF('58','BR') +
          emvF('59', CFG.NOME_PIX.slice(0,25)) + emvF('60', CFG.CIDADE_PIX.slice(0,15)) +
          emvF('62', emvF('05','***')) + '6304';
  const enc = new TextEncoder().encode(p);
  let crc = 0xFFFF;
  for (const b of enc) { crc ^= b << 8; for (let i=0;i<8;i++) crc=(crc&0x8000)?((crc<<1)^0x1021)&0xFFFF:(crc<<1)&0xFFFF; }
  return p + crc.toString(16).toUpperCase().padStart(4,'0');
}

function renderizarQrPix() {
  const img = document.getElementById('pixQrImg');
  if (!img) return;
  let t = 0;
  const tentar = () => {
    if (typeof QRCode === 'undefined') { if (++t < 30) setTimeout(tentar, 100); return; }
    QRCode.toDataURL(gerarPayloadPix(), {
      width:160, margin:1,
      color:{ dark:'#12323A', light:'#FFFFFF' },
      errorCorrectionLevel:'M',
    }, (err, url) => { if (!err) img.src = url; });
  };
  tentar();
}

function copiarPix() {
  const btn = document.querySelector('.copy-btn');
  const ok  = () => {
    showToast('✅ Chave Pix copiada!', 'ok');
    if (btn) { const o=btn.innerHTML; btn.innerHTML='✅ Copiado!'; btn.classList.add('copied'); setTimeout(()=>{btn.innerHTML=o;btn.classList.remove('copied');},2500); }
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(CFG.CHAVE_PIX).then(ok).catch(()=>fallbackCopy(ok));
  else fallbackCopy(ok);
}
window.copiarPix = copiarPix;

function fallbackCopy(cb) {
  const el=document.createElement('textarea'); el.value=CFG.CHAVE_PIX;
  el.style.cssText='position:fixed;opacity:0;'; document.body.appendChild(el); el.select();
  try { document.execCommand('copy'); cb(); } catch {}
  document.body.removeChild(el);
}

/* ================================================================
   FLIP CARD
   ================================================================ */
function flipCard() {
  cardFlipped = !cardFlipped;
  document.getElementById('dcInner').classList.toggle('flipped', cardFlipped);
}
window.flipCard = flipCard;

/* ================================================================
   SESSÃO — LOGOUT / NAVIGATE
   ================================================================ */
async function logout() {
  const ok = await confirmarAcao('Deseja sair da sua conta?', 'logout');
  if (!ok) return;
  await signOut(auth);
  userData = null; cardFlipped = false;
  document.getElementById('dcInner')?.classList.remove('flipped');
  const img=document.getElementById('cardPhotoImg'); const ph=document.getElementById('cardPhotoPlaceholder');
  if (img){img.src='';img.classList.remove('visible');} if(ph)ph.style.display='flex';
  atualizarNavbar(null);
  mostrarTela('landingScreen');
  showToast('Você saiu da conta.', '');
}
window.logout = logout;

function goHome() {
  if (userData?.status === 'ativo') mostrarTela('homeScreen');
  else { mostrarTela('landingScreen'); window.scrollTo(0,0); }
}
window.goHome = goHome;

/* ================================================================
   INIT DOM
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  mascaraCPF(document.getElementById('iCpf'));
  mascaraCPF(document.getElementById('mCpf'));

  // Máscara de telefone
  const telEl = document.getElementById('iTel');
  if (telEl) telEl.addEventListener('input', function(){ this.value = formatarTel(this.value); });

  // Fechar modais clicando fora
  ['modalOv','modalLogin','modalMembro'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function(e) {
      if (e.target !== this) return;
      if (id === 'modalLogin')   fecharLogin();
      else if (id === 'modalMembro') fecharModalMembro();
      else fecharModal();
    });
  });
});

// Enter no login
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('modalLogin')?.classList.contains('open')) fazerLogin();
});
