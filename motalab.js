/**
 * =====================================================================
 * MOTALAB — CARTÃO FIDELIDADE  ·  JavaScript principal
 * Firebase Authentication + Firestore + Storage
 * =====================================================================
 *
 * ESTRUTURA DO FIRESTORE:
 *
 *   /users/{uid}
 *     uid          : string   (igual ao Firebase Auth UID)
 *     nome         : string
 *     cpf          : string   (formatado: 000.000.000-00)
 *     nasc         : string   (YYYY-MM-DD)
 *     email        : string
 *     numCartao    : number   (gerado via transação atômica)
 *     dataAdesao   : string   (pt-BR)
 *     dataVenc     : string   (pt-BR)
 *     status       : 'ativo' | 'inativo'
 *     membros      : array<{ nome, cpf, parentesco }>
 *     fotoUrl      : string | null   (URL do Firebase Storage)
 *     createdAt    : Timestamp
 *     updatedAt    : Timestamp
 *
 *   /counters/global
 *     proximoCartao : number  (inicializado com 1, incrementa atomicamente)
 *
 * REGRAS DO FIRESTORE (cole no Console do Firebase):
 *
 *   rules_version = '2';
 *   service cloud.firestore {
 *     match /databases/{database}/documents {
 *       match /users/{userId} {
 *         allow read, write: if request.auth != null
 *                            && request.auth.uid == userId;
 *       }
 *       match /counters/{counterId} {
 *         allow read:   if request.auth != null;
 *         allow write:  if request.auth != null;
 *       }
 *     }
 *   }
 *
 * REGRAS DO STORAGE (cole no Console do Firebase):
 *
 *   rules_version = '2';
 *   service firebase.storage {
 *     match /b/{bucket}/o {
 *       match /photos/{userId} {
 *         allow read:  if request.auth != null && request.auth.uid == userId;
 *         allow write: if request.auth != null
 *                      && request.auth.uid == userId
 *                      && request.resource.size < 5 * 1024 * 1024
 *                      && request.resource.contentType.matches('image/.*');
 *       }
 *     }
 *   }
 * =====================================================================
 */

/* ─────────────────────────────────────────────────────
   IMPORTS FIREBASE
   ───────────────────────────────────────────────────── */
import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js';

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  increment,
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js';

import {
  getStorage,
  ref       as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js';

/* ─────────────────────────────────────────────────────
   INICIALIZAÇÃO FIREBASE
   ───────────────────────────────────────────────────── */
const firebaseConfig = {
  apiKey:            'AIzaSyDyJmQUyNKLGMdUJhdK2YxCYuaQkel7uiI',
  authDomain:        'mota-lab-e10e0.firebaseapp.com',
  projectId:         'mota-lab-e10e0',
  storageBucket:     'mota-lab-e10e0.firebasestorage.app',
  messagingSenderId: '1052790107201',
  appId:             '1:1052790107201:web:6321f87d3b73f324bc6ac0',
};

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

/* ─────────────────────────────────────────────────────
   CONFIGURAÇÕES DO APP
   ───────────────────────────────────────────────────── */
const CONFIG = {
  CHAVE_PIX:        '43.909.626/0001-28',
  NOME_RECEBEDOR:   'MotaLab Saude',
  CIDADE_RECEBEDOR: 'Lagoa de Roca',
  VALOR:            '70.00',
  DESCRICAO_PIX:    'Adesao Fidelidade',
  MAX_MEMBROS:      5,
  MAX_FOTO_MB:      5,
};

/* ─────────────────────────────────────────────────────
   ESTADO LOCAL
   ───────────────────────────────────────────────────── */
let userData      = null;   // objeto do usuário autenticado (vindo do Firestore)
let cardFlipped   = false;
let tempDeps      = [];     // dependentes temporários durante o cadastro
let tempCadData   = null;   // dados do Step 1 antes de salvar no Firebase
let isRegistering = false;  // impede onAuthStateChanged de interferir no cadastro

/* ─────────────────────────────────────────────────────
   OBSERVER DE AUTENTICAÇÃO
   Ponto central de controle de sessão.
   ───────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────
   NAVBAR — ESTADO DO PERFIL
   ───────────────────────────────────────────────────── */
function atualizarNavbar(user) {
  const navGuest = document.getElementById('navGuest');
  const navUser  = document.getElementById('navUser');
  if (!navGuest || !navUser) return;

  if (user) {
    const primeiroNome = user.nome ? user.nome.split(' ')[0] : '—';
    document.getElementById('navUserName').textContent = user.nome || '—';
    document.getElementById('navAvatar').textContent   = iniciais(user.nome || '?');
    navGuest.style.display = 'none';
    navUser.style.display  = 'flex';
  } else {
    navGuest.style.display = 'flex';
    navUser.style.display  = 'none';
  }
}
onAuthStateChanged(auth, async (user) => {
  // Durante o cadastro, ignora completamente — confirmarPix() controla o fluxo
  if (isRegistering) return;

  if (user) {
    showLoading(true, 'Carregando seu cartão...');
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists() && snap.data().status === 'ativo') {
        userData = { uid: user.uid, ...snap.data() };
        atualizarNavbar(userData);
        preencherHome();
        mostrarScreen('homeScreen');
        setTimeout(restaurarFoto, 200);
        showToast(`Bem-vindo(a), ${userData.nome.split(' ')[0]}! 👋`, 'ok');
      } else {
        // Conta Auth existe mas sem documento Firestore (cadastro incompleto)
        await signOut(auth);
        mostrarScreen('landingScreen');
      }
    } catch (err) {
      console.error('[Auth Observer] Erro ao carregar dados:', err);
      showToast('Erro ao carregar dados. Verifique sua conexão.', 'err');
      await signOut(auth).catch(() => {});
      mostrarScreen('landingScreen');
    } finally {
      showLoading(false);
    }
  } else {
    userData = null;
    mostrarScreen('landingScreen');
  }
});

/* ─────────────────────────────────────────────────────
   UTILITÁRIOS GERAIS
   ───────────────────────────────────────────────────── */

/** Formata número do cartão com zeros à esquerda */
/**
 * Formata o código do cartão para exibição.
 * Entrada: string "47829163" → Saída: "Nº 4782 9163"
 */
function numCard(codigo) {
  const s = String(codigo).padStart(8, '0');
  return 'Nº ' + s.slice(0,4) + ' ' + s.slice(4);
}

/** Validação completa de CPF (dígitos verificadores) */
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

/** Retorna as iniciais de um nome */
function iniciais(nome) {
  const p = nome.trim().split(' ').filter(Boolean);
  if (!p.length) return '?';
  return p.length === 1
    ? p[0][0].toUpperCase()
    : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

/** Exibe toast de notificação */
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 3500);
}

/** Exibe/esconde overlay de carregamento */
function showLoading(show, msg = 'Processando...') {
  document.getElementById('loadingMsg').textContent = msg;
  document.getElementById('loadingOv').classList.toggle('show', show);
}

/** Alterna a tela visível */
function mostrarScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

/** Máscara de CPF em tempo real */
function aplicarMascaraCPF(el) {
  if (!el) return;
  el.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 11);
    v = v
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3}\.\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3}\.\d{3}\.\d{3})(\d{1,2})/, '$1-$2');
    this.value = v;
  });
}

/**
 * Gera um código aleatório de 8 dígitos SEM dígitos repetidos.
 * Exemplo: "74829163" (cada dígito aparece no máximo 1 vez).
 */
function gerarCodigoAleatorio() {
  const digits = [0,1,2,3,4,5,6,7,8,9];
  // Fisher-Yates shuffle
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  // Garante que o primeiro dígito não seja 0
  if (digits[0] === 0) {
    const idx = digits.findIndex((d, i) => i > 0 && d !== 0);
    [digits[0], digits[idx]] = [digits[idx], digits[0]];
  }
  return digits.slice(0, 8).join('');
}

/**
 * Gera e reserva um código único no Firestore.
 * Usa a coleção /codes/{codigo} como "lock" atômico.
 * Tenta até 10 vezes em caso de colisão (extremamente raro).
 */
async function gerarCodigoUnico() {
  const MAX = 10;
  for (let tentativa = 0; tentativa < MAX; tentativa++) {
    const codigo   = gerarCodigoAleatorio();
    const codeRef  = doc(db, 'codes', codigo);
    let reservado  = false;

    await runTransaction(db, async (t) => {
      const snap = await t.get(codeRef);
      if (snap.exists()) return; // colisão, tenta outro
      t.set(codeRef, { uid: auth.currentUser.uid, criadoEm: serverTimestamp() });
      reservado = true;
    });

    if (reservado) return codigo;
  }
  throw new Error('Não foi possível gerar um código único após 10 tentativas.');
}

/**
 * Modal de confirmação customizado (substitui window.confirm nativo).
 * Retorna Promise<boolean>.
 */
function confirmarAcao(mensagem, tipo = 'danger') {
  return new Promise((resolve) => {
    const ov     = document.getElementById('modalConfirm');
    const box    = ov.querySelector('.confirm-box');
    const msgEl  = document.getElementById('confirmMsg');
    const btnSim = document.getElementById('confirmSim');
    const btnNao = document.getElementById('confirmNao');

    msgEl.textContent = mensagem;
    box.classList.toggle('logout', tipo === 'logout');
    ov.classList.add('open');

    const resolver = (val) => {
      ov.classList.remove('open');
      btnSim.removeEventListener('click', handleSim);
      btnNao.removeEventListener('click', handleNao);
      resolve(val);
    };

    const handleSim = () => resolver(true);
    const handleNao = () => resolver(false);

    btnSim.addEventListener('click', handleSim);
    btnNao.addEventListener('click', handleNao);
  });
}

/* ─────────────────────────────────────────────────────
   INICIALIZAÇÃO DO DOM
   ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  aplicarMascaraCPF(document.getElementById('iCpf'));
  aplicarMascaraCPF(document.getElementById('mCpf'));

  // Preenche a chave Pix em todos os elementos com a classe
  document.querySelectorAll('.pix-key-val').forEach(el => {
    el.textContent = CONFIG.CHAVE_PIX;
  });

  // Fecha modais ao clicar no overlay
  ['modalOv', 'modalLogin', 'modalMembro'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function (e) {
      if (e.target !== this) return;
      if (id === 'modalLogin')    fecharLogin();
      else if (id === 'modalMembro') fecharModalMembro();
      else fecharModal();
    });
  });
});

// Enter na tela de login dispara fazerLogin
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('modalLogin')?.classList.contains('open')) {
    fazerLogin();
  }
});

/* ─────────────────────────────────────────────────────
   MODAL LOGIN
   ───────────────────────────────────────────────────── */
function abrirLogin() {
  ['lEmail', 'lSenha'].forEach(id => {
    document.getElementById(id).value = '';
    document.getElementById(id).classList.remove('err');
  });
  document.getElementById('loginErr').style.display = 'none';
  document.getElementById('modalLogin').classList.add('open');
  setTimeout(() => document.getElementById('lEmail').focus(), 350);
}

function fecharLogin() {
  document.getElementById('modalLogin').classList.remove('open');
}

async function fazerLogin() {
  const emailEl = document.getElementById('lEmail');
  const senhaEl = document.getElementById('lSenha');
  const errEl   = document.getElementById('loginErr');

  emailEl.classList.remove('err');
  senhaEl.classList.remove('err');
  errEl.style.display = 'none';

  const email = emailEl.value.trim().toLowerCase();
  const senha = senhaEl.value;

  if (!email) { emailEl.classList.add('err'); }
  if (!senha) { senhaEl.classList.add('err'); }
  if (!email || !senha) { showToast('Preencha e-mail e senha', 'err'); return; }

  showLoading(true, 'Entrando...');
  fecharLogin();

  try {
    await signInWithEmailAndPassword(auth, email, senha);
    // onAuthStateChanged cuida de carregar os dados e redirecionar
  } catch (err) {
    showLoading(false);
    console.error('[Login] Erro:', err.code);
    // Reabre o modal com erro
    abrirLogin();
    errEl.style.display = 'flex';
    emailEl.classList.add('err');
    senhaEl.classList.add('err');

    if (err.code === 'auth/too-many-requests') {
      showToast('Conta temporariamente bloqueada. Tente mais tarde.', 'err');
    }
  }
}

async function recuperarSenha() {
  const email = document.getElementById('lEmail').value.trim();
  if (!email || !/\S+@\S+\.\S+/.test(email)) {
    document.getElementById('lEmail').classList.add('err');
    showToast('Informe um e-mail válido para recuperar a senha.', 'err');
    return;
  }
  showLoading(true, 'Enviando e-mail...');
  try {
    await sendPasswordResetEmail(auth, email);
    fecharLogin();
    showToast('E-mail de recuperação enviado! Verifique sua caixa de entrada.', 'ok');
  } catch (err) {
    console.error('[RecuperarSenha] Erro:', err.code);
    showToast('E-mail não encontrado. Verifique o endereço informado.', 'err');
  } finally {
    showLoading(false);
  }
}

/* ─────────────────────────────────────────────────────
   MODAL CADASTRO — CONTROLE DE TELAS
   ───────────────────────────────────────────────────── */
function abrirCadastro() {
  tempCadData = null;
  tempDeps    = [];
  // Limpa os campos do Step 1
  ['iNome','iCpf','iEmail','iNasc','iSenha','iConf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('err'); }
  });
  document.getElementById('modalOv').classList.add('open');
  mostrarStep('cad');
}

function fecharModal() {
  document.getElementById('modalOv').classList.remove('open');
}

function mostrarStep(step) {
  ['cad', 'dep', 'pix', 'ok'].forEach(s => {
    document.getElementById('s-' + s).style.display = 'none';
  });
  document.getElementById('s-' + step).style.display = 'block';

  const map = { cad: 1, dep: 2, pix: 3, ok: 4 };
  const cur = map[step];
  [1, 2, 3, 4].forEach(n => {
    const el = document.getElementById('ms' + n);
    if (el) el.className = 'mstep' + (n < cur ? ' done' : n === cur ? ' active' : '');
  });

  document.getElementById('modalBox').scrollTop = 0;
  if (step === 'dep') renderizarDepList();
  if (step === 'pix') setTimeout(renderizarQrPix, 150);
}

/* ─────────────────────────────────────────────────────
   STEP 1 — DADOS DO TITULAR
   ───────────────────────────────────────────────────── */
function goToDeps() {
  const nome  = document.getElementById('iNome');
  const cpf   = document.getElementById('iCpf');
  const nasc  = document.getElementById('iNasc');
  const email = document.getElementById('iEmail');
  const senha = document.getElementById('iSenha');
  const conf  = document.getElementById('iConf');

  let ok = true;
  const cl = el => el.classList.remove('err');
  const er = el => { el.classList.add('err'); ok = false; };

  nome.value.trim().split(' ').filter(Boolean).length >= 2 ? cl(nome) : er(nome);
  validCPF(cpf.value)                                       ? cl(cpf)  : er(cpf);
  nasc.value                                                ? cl(nasc) : er(nasc);
  /\S+@\S+\.\S+/.test(email.value)                         ? cl(email): er(email);
  senha.value.length >= 6                                   ? cl(senha): er(senha);
  conf.value === senha.value && conf.value.length >= 6      ? cl(conf) : er(conf);

  if (!ok) { showToast('Verifique os campos em vermelho', 'err'); return; }

  // Salva temporariamente — não cria a conta ainda
  tempCadData = {
    nome:  nome.value.trim(),
    cpf:   cpf.value,
    nasc:  nasc.value,
    email: email.value.trim().toLowerCase(),
    senha: senha.value,
  };
  tempDeps = [];
  mostrarStep('dep');
}

function voltarCad() { mostrarStep('cad'); }

/* ─────────────────────────────────────────────────────
   STEP 2 — DEPENDENTES / PARTICIPANTES
   ───────────────────────────────────────────────────── */
function renderizarDepList() {
  const list    = document.getElementById('depList');
  const btn     = document.getElementById('btnAddDep');
  const counter = document.getElementById('depCounter');
  if (!list) return;

  list.innerHTML = '';
  tempDeps.forEach((dep, idx) => {
    const item       = document.createElement('div');
    item.className   = 'dep-item';
    item.innerHTML   = `
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
  if (btn)     btn.disabled = total >= CONFIG.MAX_MEMBROS;
}

function adicionarDepForm() {
  if (tempDeps.length >= CONFIG.MAX_MEMBROS) {
    showToast(`Limite de ${CONFIG.MAX_MEMBROS} participantes atingido`, 'err');
    return;
  }
  // Toggle: se o formulário já existe, remove
  const existing = document.getElementById('depFormInline');
  if (existing) { existing.remove(); return; }

  const list = document.getElementById('depList');
  const form = document.createElement('div');
  form.className = 'dep-form';
  form.id        = 'depFormInline';
  form.innerHTML = `
    <div class="row2" style="margin-bottom:8px;">
      <div class="field" style="margin-bottom:0;">
        <label>Nome completo</label>
        <input type="text" id="dfNome" placeholder="Nome do participante">
        <div class="errmsg">Informe o nome completo</div>
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
      <button class="dep-form-ok"     onclick="confirmarDepForm()">✓ Adicionar</button>
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

  let ok   = true;
  const nome = nomeEl.value.trim();
  const cpf  = cpfEl.value;

  nome.split(' ').filter(Boolean).length >= 2
    ? nomeEl.classList.remove('err')
    : (nomeEl.classList.add('err'), ok = false);
  validCPF(cpf)
    ? cpfEl.classList.remove('err')
    : (cpfEl.classList.add('err'), ok = false);

  if (!ok) { showToast('Verifique os campos', 'err'); return; }

  tempDeps.push({
    nome,
    cpf,
    parentesco: document.getElementById('dfParentesco').value,
  });
  cancelarDepForm();
  renderizarDepList();
  showToast(`${nome.split(' ')[0]} adicionado(a)!`, 'ok');
}

function cancelarDepForm() {
  document.getElementById('depFormInline')?.remove();
}

function removerDep(idx) {
  const nome = tempDeps[idx]?.nome?.split(' ')[0] || 'Participante';
  tempDeps.splice(idx, 1);
  renderizarDepList();
  showToast(`${nome} removido(a)`, '');
}

/* ─────────────────────────────────────────────────────
   STEP 3 — PAGAMENTO PIX
   ───────────────────────────────────────────────────── */
function goToPix() {
  cancelarDepForm();
  mostrarStep('pix');
}

function voltarDep() { mostrarStep('dep'); }

/**
 * Confirmar pagamento:
 * 1. Cria conta no Firebase Authentication
 * 2. Gera número de cartão via transação atômica
 * 3. Salva todos os dados no Firestore
 * Em caso de erro, faz rollback da conta Auth criada.
 */
async function confirmarPix() {
  if (!tempCadData) {
    showToast('Dados inválidos. Reinicie o cadastro.', 'err');
    return;
  }

  let createdUser = null;
  isRegistering   = true;  // bloqueia onAuthStateChanged durante o fluxo
  showLoading(true, 'Criando sua conta...');

  try {
    // ── 1. Cria conta no Firebase Auth ──
    const cred  = await createUserWithEmailAndPassword(auth, tempCadData.email, tempCadData.senha);
    createdUser  = cred.user;

    showLoading(true, 'Gerando número do cartão...');

    // ── 2. Código único de 8 dígitos sem repetição ──
    const numCartao = await gerarCodigoUnico();

    showLoading(true, 'Salvando seus dados...');

    // ── 3. Datas ──
    const hoje = new Date();
    const venc = new Date();
    venc.setFullYear(venc.getFullYear() + 1);

    // ── 4. Salva documento do usuário no Firestore ──
    const docData = {
      uid:        createdUser.uid,
      nome:       tempCadData.nome,
      cpf:        tempCadData.cpf,
      nasc:       tempCadData.nasc,
      email:      tempCadData.email,
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

    // Atualiza estado local e finaliza o fluxo
    userData      = { ...docData };
    isRegistering = false;  // libera o observer
    atualizarNavbar(userData);
    showLoading(false);
    mostrarStep('ok');

  } catch (err) {
    isRegistering = false;  // libera o observer mesmo com erro
    showLoading(false);
    console.error('[confirmarPix] Erro:', err.code, err.message);

    // Rollback: remove conta Auth se Firestore falhou
    if (createdUser && err.code !== 'auth/email-already-in-use') {
      try { await createdUser.delete(); } catch { /* ignora */ }
    }

    const msgs = {
      'auth/email-already-in-use':       null,
      'auth/operation-not-allowed':      'Login por e-mail não ativado. Ative em Authentication → Sign-in method.',
      'auth/admin-restricted-operation': 'Autenticação não habilitada no Firebase Console.',
      'auth/weak-password':              'Senha muito fraca. Use ao menos 6 caracteres.',
      'auth/invalid-email':              'E-mail inválido. Volte e corrija.',
      'auth/network-request-failed':     'Sem conexão. Verifique sua internet.',
      'auth/too-many-requests':          'Muitas tentativas. Aguarde alguns minutos.',
      'permission-denied':               'Permissão negada. Verifique as regras do Firestore.',
      'unavailable':                     'Serviço indisponível. Tente novamente.',
    };

    if (err.code === 'auth/email-already-in-use') {
      showToast('Este e-mail já está cadastrado. Faça login.', 'err');
      fecharModal();
      abrirLogin();
    } else if (msgs[err.code]) {
      showToast(msgs[err.code], 'err');
      if (['auth/weak-password', 'auth/invalid-email'].includes(err.code)) mostrarStep('cad');
    } else {
      showToast(`Erro: ${err.code || 'desconhecido'}`, 'err');
    }
  }
}

function irHome() {
  fecharModal();
  preencherHome();
  mostrarScreen('homeScreen');
}

/* ─────────────────────────────────────────────────────
   HOME — PREENCHER TELA DO USUÁRIO
   ───────────────────────────────────────────────────── */
function preencherHome() {
  const u = userData;
  if (!u) return;

  const ns = numCard(u.numCartao);

  document.getElementById('hwbName').textContent = u.nome.split(' ')[0];
  document.getElementById('dcName').textContent  = u.nome.toUpperCase();
  document.getElementById('dcNum').textContent   = ns;

  // Data de vencimento no cartão (MM/AAAA)
  const vencEl = document.getElementById('dcVenc');
  if (vencEl && u.dataVenc) {
    // dataVenc formato dd/mm/yyyy → exibir mm/yyyy
    const partes = u.dataVenc.split('/');
    vencEl.textContent = partes.length === 3 ? `${partes[1]}/${partes[2]}` : u.dataVenc;
  }

  atualizarNavbar(u);

  renderizarVersoCartao();

  document.getElementById('infoNome').textContent  = u.nome;
  document.getElementById('infoCpf').textContent   = u.cpf;
  document.getElementById('infoEmail').textContent = u.email;
  document.getElementById('infoNum').textContent   = ns;
  document.getElementById('infoVal').textContent   = u.dataVenc || '—';

  renderizarMembrosPanel();
}

/* ─────────────────────────────────────────────────────
   CARTÃO — VERSO (participantes)
   ───────────────────────────────────────────────────── */
function renderizarVersoCartao() {
  const cont = document.getElementById('cobMembers');
  if (!cont || !userData) return;

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
  if (!panel || !userData) return;

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
  const membros = userData?.membros || [];
  if (membros.length >= CONFIG.MAX_MEMBROS) {
    showToast(`Limite de ${CONFIG.MAX_MEMBROS} participantes atingido`, 'err');
    return;
  }
  ['mNome', 'mCpf'].forEach(id => {
    document.getElementById(id).value = '';
    document.getElementById(id).classList.remove('err');
  });
  document.getElementById('mParentesco').selectedIndex = 0;
  document.getElementById('modalMembro').classList.add('open');
}

function fecharModalMembro() {
  document.getElementById('modalMembro').classList.remove('open');
}

/** Salva novo participante no Firestore */
async function salvarMembro() {
  const nomeEl = document.getElementById('mNome');
  const cpfEl  = document.getElementById('mCpf');

  let ok   = true;
  const nome = nomeEl.value.trim();
  const cpf  = cpfEl.value;

  nome.split(' ').filter(Boolean).length >= 2
    ? nomeEl.classList.remove('err')
    : (nomeEl.classList.add('err'), ok = false);
  validCPF(cpf)
    ? cpfEl.classList.remove('err')
    : (cpfEl.classList.add('err'), ok = false);

  if (!ok) { showToast('Verifique os campos', 'err'); return; }

  if (!userData.membros) userData.membros = [];
  const novoMembro = {
    nome,
    cpf,
    parentesco: document.getElementById('mParentesco').value,
  };
  userData.membros.push(novoMembro);

  showLoading(true, 'Salvando participante...');

  try {
    await updateDoc(doc(db, 'users', auth.currentUser.uid), {
      membros:   userData.membros,
      updatedAt: serverTimestamp(),
    });

    fecharModalMembro();
    renderizarMembrosPanel();
    renderizarVersoCartao();
    showToast(`${nome.split(' ')[0]} adicionado(a) ao plano!`, 'ok');
  } catch (err) {
    // Rollback local
    userData.membros.pop();
    console.error('[salvarMembro] Erro:', err);
    showToast('Erro ao salvar. Verifique sua conexão.', 'err');
  } finally {
    showLoading(false);
  }
}

/** Remove participante do Firestore */
async function removerMembro(idx) {
  if (!userData?.membros) return;
  const nomeDisplay = userData.membros[idx]?.nome?.split(' ')[0] || 'Participante';

  const confirmado = await confirmarAcao(`Remover ${nomeDisplay} do plano?`);
  if (!confirmado) return;

  const membrosBackup = [...userData.membros];
  userData.membros.splice(idx, 1);

  showLoading(true, 'Removendo participante...');

  try {
    await updateDoc(doc(db, 'users', auth.currentUser.uid), {
      membros:   userData.membros,
      updatedAt: serverTimestamp(),
    });

    renderizarMembrosPanel();
    renderizarVersoCartao();
    showToast(`${nomeDisplay} removido(a) do plano`, '');
  } catch (err) {
    // Rollback local
    userData.membros = membrosBackup;
    renderizarMembrosPanel();
    console.error('[removerMembro] Erro:', err);
    showToast('Erro ao remover. Verifique sua conexão.', 'err');
  } finally {
    showLoading(false);
  }
}

/* ─────────────────────────────────────────────────────
   FOTO DO TITULAR — Firebase Storage
   ───────────────────────────────────────────────────── */

/**
 * Upload da foto para Firebase Storage.
 * A URL pública fica salva no Firestore (campo fotoUrl).
 * Cada usuário pode ter apenas uma foto no caminho photos/{uid}.
 */
async function loadPhoto(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];

  if (file.size > CONFIG.MAX_FOTO_MB * 1024 * 1024) {
    showToast(`Imagem muito grande. Máximo ${CONFIG.MAX_FOTO_MB}MB.`, 'err');
    return;
  }
  if (!file.type.startsWith('image/')) {
    showToast('Selecione um arquivo de imagem válido.', 'err');
    return;
  }

  showLoading(true, 'Enviando foto...');

  try {
    const uid     = auth.currentUser.uid;
    const fileRef = storageRef(storage, `photos/${uid}`);

    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);

    await updateDoc(doc(db, 'users', uid), {
      fotoUrl:   url,
      updatedAt: serverTimestamp(),
    });

    userData.fotoUrl = url;
    aplicarFotoNoCartao(url);
    showToast('Foto adicionada ao cartão!', 'ok');
  } catch (err) {
    console.error('[loadPhoto] Erro:', err);
    showToast('Erro ao enviar foto. Tente novamente.', 'err');
  } finally {
    showLoading(false);
    // Limpa o input para permitir o mesmo arquivo novamente
    input.value = '';
  }
}

function aplicarFotoNoCartao(url) {
  const img         = document.getElementById('cardPhotoImg');
  const placeholder = document.getElementById('cardPhotoPlaceholder');
  if (!img || !url) return;
  img.src = url;
  img.classList.add('visible');
  if (placeholder) placeholder.style.display = 'none';
}

function restaurarFoto() {
  if (userData?.fotoUrl) aplicarFotoNoCartao(userData.fotoUrl);
}

/* ─────────────────────────────────────────────────────
   PIX — PAYLOAD EMV + QR CODE
   ───────────────────────────────────────────────────── */

/** Formata um campo EMV (tag + comprimento + valor) */
function emvField(tag, value) {
  return `${tag}${String(value.length).padStart(2, '0')}${value}`;
}

/** Gera o payload Pix no formato EMV/BR Code */
function gerarPayloadPix() {
  const chave  = CONFIG.CHAVE_PIX;
  const nome   = CONFIG.NOME_RECEBEDOR.slice(0, 25);
  const cidade = CONFIG.CIDADE_RECEBEDOR.slice(0, 15);
  const desc   = CONFIG.DESCRICAO_PIX.slice(0, 25);

  const gui    = emvField('00', 'BR.GOV.BCB.PIX');
  const key    = emvField('01', chave);
  const addInf = desc ? emvField('02', desc) : '';
  const mai    = emvField('26', gui + key + addInf);

  let p =
    emvField('00', '01') +
    mai +
    emvField('52', '0000') +
    emvField('53', '986') +
    emvField('54', CONFIG.VALOR) +
    emvField('58', 'BR') +
    emvField('59', nome) +
    emvField('60', cidade) +
    emvField('62', emvField('05', '***')) +
    '6304';

  p += calcCRC16(p);
  return p;
}

/** Calcula CRC-16/CCITT-FALSE para validação do payload Pix */
function calcCRC16(payload) {
  const bytes = new TextEncoder().encode(payload);
  let crc     = 0xFFFF;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Renderiza o QR Code Pix como imagem (toDataURL é mais confiável que toCanvas
 * pois não depende das dimensões do canvas em elementos display:none).
 * Faz retry por até 3s caso a lib ainda não tenha carregado.
 */
function renderizarQrPix() {
  const img = document.getElementById('pixQrImg');
  if (!img) return;
  let t = 0;
  const tentar = () => {
    if (typeof QRCode === 'undefined') {
      if (++t < 30) { setTimeout(tentar, 100); } else { console.warn('[QR Pix] lib nao carregou'); }
      return;
    }
    QRCode.toDataURL(gerarPayloadPix(), {
      width: 160, margin: 1,
      color: { dark: '#12323A', light: '#FFFFFF' },
      errorCorrectionLevel: 'M',
    }, (err, url) => {
      if (err) { console.warn('[QR Pix] Erro ao gerar:', err); return; }
      img.src = url;
    });
  };
  tentar();
}

/** Copia a chave Pix para a área de transferência */
function copiarPix() {
  const txt = CONFIG.CHAVE_PIX;
  const btn = document.querySelector('.copy-btn');

  const onSuccess = () => {
    showToast('✅ Chave Pix copiada!', 'ok');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✅ Copiado!';
      btn.classList.add('copied');
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2500);
    }
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(txt).then(onSuccess).catch(() => copiarFallback(txt, onSuccess));
  } else {
    copiarFallback(txt, onSuccess);
  }
}

function copiarFallback(txt, cb) {
  const el = document.createElement('textarea');
  el.value = txt;
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
  document.body.appendChild(el);
  el.select();
  try { document.execCommand('copy'); cb(); }
  catch { showToast('Copie a chave manualmente.', 'err'); }
  finally { document.body.removeChild(el); }
}

/* ─────────────────────────────────────────────────────
   FLIP CARD
   ───────────────────────────────────────────────────── */
function flipCard() {
  cardFlipped = !cardFlipped;
  document.getElementById('dcInner').classList.toggle('flipped', cardFlipped);
}

/* ─────────────────────────────────────────────────────
   SESSÃO — LOGOUT
   ───────────────────────────────────────────────────── */
async function logout() {
  const confirmado = await confirmarAcao('Deseja sair da sua conta?', 'logout');
  if (!confirmado) return;

  await signOut(auth);

  // Reseta o estado local
  userData    = null;
  cardFlipped = false;
  atualizarNavbar(null);

  const dcInner = document.getElementById('dcInner');
  if (dcInner) dcInner.classList.remove('flipped');

  const img = document.getElementById('cardPhotoImg');
  const ph  = document.getElementById('cardPhotoPlaceholder');
  if (img) { img.src = ''; img.classList.remove('visible'); }
  if (ph)  ph.style.display = 'flex';

  mostrarScreen('landingScreen');
  showToast('Você saiu da sua conta.', '');
}

function goHome() {
  if (userData?.status === 'ativo') mostrarScreen('homeScreen');
  else { mostrarScreen('landingScreen'); window.scrollTo(0, 0); }
}

/* ─────────────────────────────────────────────────────
   EXPORTS GLOBAIS
   Necessário pois o arquivo usa type="module" —
   funções chamadas por onclick no HTML precisam estar
   disponíveis no escopo window.
   ───────────────────────────────────────────────────── */
window.goHome             = goHome;
window.abrirLogin         = abrirLogin;
window.fecharLogin        = fecharLogin;
window.fazerLogin         = fazerLogin;
window.recuperarSenha     = recuperarSenha;
window.abrirCadastro      = abrirCadastro;
window.fecharModal        = fecharModal;
window.goToDeps           = goToDeps;
window.voltarCad          = voltarCad;
window.adicionarDepForm   = adicionarDepForm;
window.confirmarDepForm   = confirmarDepForm;
window.cancelarDepForm    = cancelarDepForm;
window.removerDep         = removerDep;
window.goToPix            = goToPix;
window.voltarDep          = voltarDep;
window.confirmarPix       = confirmarPix;
window.irHome             = irHome;
window.flipCard           = flipCard;
window.loadPhoto          = loadPhoto;
window.abrirAddMembro     = abrirAddMembro;
window.fecharModalMembro  = fecharModalMembro;
window.salvarMembro       = salvarMembro;
window.removerMembro      = removerMembro;
window.copiarPix          = copiarPix;
window.logout             = logout;
