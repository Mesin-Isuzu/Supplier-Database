var SUPABASE_URL = 'https://fjlrnizploxubxkotrin.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqbHJuaXpwbG94dWJ4a290cmluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMTcyNDUsImV4cCI6MjA5Nzg5MzI0NX0.PHjQvOh7tbObp-bYZmGDD8unI-fLS2U64rgduVFSZ7k';

var supabase = null;
var _supabaseInitPromise = null;

async function initSupabase() {
  if (supabase) return;
  if (_supabaseInitPromise) return _supabaseInitPromise;
  _supabaseInitPromise = (async function() {
    try {
      var mod = await import('https://esm.sh/@supabase/supabase-js@2');
      supabase = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.error('Supabase init failed:', e);
      $('loginError').textContent = 'Supabase SDK failed to load: ' + e.message;
      $('loginError').classList.remove('hidden');
    }
  })();
  return _supabaseInitPromise;
}

// ─── Helpers ────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function escHtml(s) {
  if (!s) return '';
  return s.toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function csvEsc(v) {
  var s = (v || '').toString();
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1)
    return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function showToast(m, t, d) {
  var e = $('toast');
  e.className = 'toast px-5 py-3 rounded-xl shadow-2xl text-sm font-medium text-white flex items-center gap-2 ' + (t === 'success' ? 'bg-green-600' : t === 'warning' ? 'bg-amber-500' : 'bg-red-600');
  e.innerHTML = '<i class="fas ' + (t === 'success' ? 'fa-check-circle' : t === 'warning' ? 'fa-exclamation-circle' : 'fa-exclamation-circle') + '"></i> ' + m;
  e.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(function () { e.classList.add('hidden'); }, d || 3500);
}
function showLoading() { $('loadingOverlay').style.display = 'flex'; }
function hideLoading() { $('loadingOverlay').style.display = 'none'; }
async function downloadFile(c, f, m) {
  if (window.showSaveFilePicker) {
    try {
      var handle = await window.showSaveFilePicker({
        suggestedName: f,
        types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'] } }]
      });
      var writable = await handle.createWritable();
      await writable.write(c);
      await writable.close();
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  var b = new Blob([c], { type: m + ';charset=utf-8' }), u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u; a.download = f; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u);
}

// ─── State ─────────────────────────────────────────────
var suppliers = [], currentPage = 1, pageSize = 10;
var sortColumn = 'last_transaction_date', sortAsc = false;
var deleteTargetId = null;
var currentUser = null;
var CATEGORIES = [];
var CATEGORY_COLORS = {};
var CATEGORY_TEXT_COLORS = {};
var CATEGORY_PALETTE = [
  {bg:'#dbeafe',text:'#1e40af'},{bg:'#fce7f3',text:'#9d174d'},{bg:'#e0e7ff',text:'#3730a3'},{bg:'#d1fae5',text:'#065f46'},
  {bg:'#fef3c7',text:'#92400e'},{bg:'#f3e8ff',text:'#5b21b6'},{bg:'#ffedd5',text:'#9a3412'},{bg:'#f0fdf4',text:'#166534'},
  {bg:'#fef2f2',text:'#991b1b'},{bg:'#fdf2f8',text:'#9d174d'},{bg:'#ecfeff',text:'#155e75'},{bg:'#f5f3ff',text:'#5b21b6'}
];
var paletteIdx = 0;

// ─── Field Mapper (camelCase ↔ snake_case) ───────────────
function toSupabase(s) {
  return {
    company_name:     s.companyName   || '',
    contact_person:   s.contactPerson || '',
    contact_person_2: s.contactPerson2 || '',
    phone:            s.phone         || '',
    phone_2:          s.phone2        || '',
    email:            s.email         || '',
    email_2:          s.email2        || '',
    website:          s.website       || '',
    address:          s.address       || '',
    location:         s.location      || '',
    categories:       s.categories    || [],
    products:         (s.products || []).map(function(p) {
      return typeof p === 'string' ? {name:p, image:'', category:''} : p;
    }),
    last_transaction_date: s.lastTransactionDate || null,
    notes:            s.notes         || ''
  };
}
function fromSupabase(r) {
  return {
    id:              r.id,
    companyName:     r.company_name,
    contactPerson:   r.contact_person,
    contactPerson2:  r.contact_person_2 || '',
    phone:           r.phone,
    phone2:          r.phone_2 || '',
    email:           r.email         || '',
    email2:          r.email_2       || '',
    website:         r.website       || '',
    address:         r.address       || '',
    location:        r.location      || '',
    categories:      Array.isArray(r.categories) ? r.categories : [],
    products:        Array.isArray(r.products)   ? r.products   : [],
    lastTransactionDate: r.last_transaction_date || null,
    notes:           r.notes         || '',
    created_at:      r.created_at,
    updated_at:      r.updated_at,
    created_by:      r.created_by,
    updated_by:      r.updated_by,
    creatorUsername: (r.creator && r.creator.username) ? r.creator.username : '',
    updaterUsername: (r.updater && r.updater.username) ? r.updater.username : ''
  };
}

// ─── Auth ───────────────────────────────────────────────
async function handleLogin() {
  if (!supabase) {
    $('loginError').textContent = 'Supabase is still loading. Please wait...';
    $('loginError').classList.remove('hidden');
    return;
  }
  var loginInput = $('loginUsername').value.trim().toLowerCase();
  var password   = $('loginPassword').value.trim();
  $('loginError').classList.add('hidden');
  if (!loginInput || !password) {
    $('loginError').textContent = 'Please enter username/email and password.';
    $('loginError').classList.remove('hidden');
    return;
  }
  $('loginBtn').disabled = true;
  $('loginBtn').innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Signing in...';

  var email = loginInput;
  if (loginInput.indexOf('@') === -1) {
    var { data: emailData, error: emailError } = await supabase.rpc('get_login_email', { p_username: loginInput });
    if (emailError || !emailData) {
      $('loginBtn').disabled = false;
      $('loginBtn').innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Sign In';
      $('loginError').textContent = 'Invalid username or password.';
      $('loginError').classList.remove('hidden');
      return;
    }
    email = emailData;
  }

  await supabase.auth.signOut();

  const { data, error } = await supabase.auth.signInWithPassword({ email: email, password });

  $('loginBtn').disabled = false;
  $('loginBtn').innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Sign In';

  if (error) {
    $('loginError').textContent = error.message || 'Login failed. Check your credentials.';
    $('loginError').classList.remove('hidden');
    return;
  }

  if (data.user) {
    var ok = await loadUserProfile(data.user.id);
    if (ok) {
      await onLoginSuccess();
    } else {
      $('loginError').textContent = $('loginError').textContent || 'Failed to load user profile. Please contact admin.';
      $('loginError').classList.remove('hidden');
    }
  }
}

async function handleLogout() {
  await supabase.auth.signOut();
  currentUser = null;
  suppliers = [];
  $('appContent').classList.remove('active');
  $('loginPage').classList.remove('hidden');
  $('loginPage').classList.add('active');
  $('loginUsername').value = '';
  $('loginPassword').value = '';
  $('loginError').classList.add('hidden');
}

async function checkSession() {
  if (!supabase) {
    $('loginPage').classList.remove('hidden');
    $('loginPage').classList.add('active');
    $('loginError').textContent = 'Cannot connect to Supabase. Check your internet connection or Supabase project status.';
    $('loginError').classList.remove('hidden');
    return false;
  }
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      $('loginPage').classList.remove('hidden');
      $('loginPage').classList.add('active');
      $('loginError').textContent = 'Session error: ' + (error.message || 'Unknown error');
      $('loginError').classList.remove('hidden');
      return false;
    }
    if (!session?.user) {
      $('loginPage').classList.remove('hidden');
      $('loginPage').classList.add('active');
      return false;
    }
    await loadUserProfile(session.user.id);
    if (!currentUser) return false;
    await onLoginSuccess();
    return true;
  } catch (e) {
    $('loginPage').classList.remove('hidden');
    $('loginPage').classList.add('active');
    $('loginError').textContent = 'Connection error: ' + e.message;
    $('loginError').classList.remove('hidden');
    return false;
  }
}

async function loadUserProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, role')
    .eq('id', userId)
    .single();

  if (error || !data) {
    var email = (await supabase.auth.getUser()).data.user?.email || '';
    var username = email ? email.split('@')[0] : 'user_' + userId.substring(0, 8);

    var { data: rpcData, error: rpcError } = await supabase.rpc('ensure_user_profile', {
      p_user_id: userId,
      p_username: username,
      p_role: 'Viewer'
    });
    if (rpcError || !rpcData?.id) {
      console.error('Error creating user profile:', rpcError);
      await supabase.auth.signOut();
      $('loginPage').classList.remove('hidden');
      $('loginPage').classList.add('active');
      var errMsg = rpcError ? (rpcError.message || JSON.stringify(rpcError)) : 'Profile data missing';
      $('loginError').textContent = 'Failed to load user profile: ' + errMsg;
      $('loginError').classList.remove('hidden');
      return false;
    }
    currentUser = { id: rpcData.id, username: rpcData.username, role: rpcData.role };
    return true;
  }

  currentUser = { id: data.id, username: data.username, role: data.role };
  return true;
}

async function onLoginSuccess() {
  $('loginPage').classList.add('hidden');
  $('loginPage').classList.remove('active');
  $('appContent').classList.add('active');
  applyPermissions();
  updateNavbar();
  showLoading();
  await Promise.all([loadCategories(), loadSuppliers()]);
  populateCategoryFilter();
  populateYearFilter();
  hideLoading();
  render();
  showToast('Welcome, ' + currentUser.username + '!', 'success');
}

function updateNavbar() {
  if (!currentUser) return;
  $('navUsername').textContent = currentUser.username;
  $('navUsername').classList.remove('hidden');
  var rc = { 'Admin': 'bg-purple-100 text-purple-700', 'Editor': 'bg-blue-100 text-blue-700', 'Viewer': 'bg-gray-100 text-gray-700' };
  $('navRole').textContent = currentUser.role;
  $('navRole').className = 'text-xs px-2 py-0.5 rounded-full ' + (rc[currentUser.role] || 'bg-gray-100 text-gray-700');
  $('navRole').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
}

function applyPermissions() {
  var role = currentUser ? currentUser.role : 'Viewer';
  var canEdit  = (role === 'Admin' || role === 'Editor');
  var canDelete = (role === 'Admin');
  var isAdmin   = (role === 'Admin');
  window.__canEdit   = canEdit;
  window.__canDelete = canDelete;

  var show = function(id, visible) {
    var el = $(id); if (!el) return;
    if (visible) el.classList.remove('hidden'); else el.classList.add('hidden');
  };
  show('addSupplierBtn', canEdit);
  show('importBtn',      canEdit);
  show('templateBtn',    canEdit);
  show('manageUsersBtn',      isAdmin);
  show('manageCategoriesBtn', isAdmin);
  show('addSupplierDivider',  canEdit);
}

// ─── Load Data from Supabase ────────────────────────────
async function loadSuppliers() {
  var { data, error } = await supabase
    .from('suppliers')
    .select('*, creator:users!created_by(username), updater:users!updated_by(username)')
    .order('company_name', { ascending: true });

  if (error) {
    var { data: fallbackData, error: fallbackError } = await supabase
      .from('suppliers')
      .select('*')
      .order('company_name', { ascending: true });
    if (fallbackError) {
      showToast('Failed to load suppliers: ' + fallbackError.message, 'error');
      return;
    }
    data = fallbackData;
  }

  suppliers = (data || []).map(fromSupabase);
}

async function loadCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) { showToast('Failed to load categories: ' + error.message, 'error'); return; }
  CATEGORIES = [];
  CATEGORY_COLORS = {};
  CATEGORY_TEXT_COLORS = {};
  (data || []).forEach(function(c) {
    CATEGORIES.push(c.name);
    CATEGORY_COLORS[c.name]      = c.bg_color;
    CATEGORY_TEXT_COLORS[c.name] = c.text_color;
  });
  populateCategoryFilter();
  $('statCategories').textContent = CATEGORIES.length;
}

function populateCategoryFilter() {
  var sel = $('filterCategory');
  var prev = sel.value;
  sel.innerHTML = '<option value="">All Categories</option>';
  CATEGORIES.forEach(function(c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    if (c === prev) o.selected = true;
    sel.appendChild(o);
  });
}

function populateYearFilter() {
  var sel = $('filterYear');
  var prev = sel.value;
  sel.innerHTML = '<option value="">All Years</option>';
  var years = {};
  suppliers.forEach(function(s) {
    if (s.lastTransactionDate) {
      var yr = new Date(s.lastTransactionDate).getFullYear();
      years[yr] = true;
    }
  });
  Object.keys(years).sort(function(a, b) { return b - a; }).forEach(function(yr) {
    var o = document.createElement('option');
    o.value = yr; o.textContent = yr;
    if (yr.toString() === prev) o.selected = true;
    sel.appendChild(o);
  });
}

// ─── Render Table ───────────────────────────────────────
function getFilteredSorted() {
  var q   = ($('searchInput').value || '').toLowerCase();
  var yr  = $('filterYear').value;
  var cat = $('filterCategory').value;
  var dateFrom = $('filterDateFrom').value;
  var dateTo   = $('filterDateTo').value;

   var list = suppliers.filter(function(s) {
    var matchQ = !q;
    if (q) {
      var productStr = (s.products||[]).map(function(p){
        return (typeof p==='string' ? p : p.name||'') + ' ' + (p.category||'');
      }).join(' ').toLowerCase();
      matchQ = s.companyName.toLowerCase().includes(q) ||
               (s.contactPerson||'').toLowerCase().includes(q) ||
               (s.contactPerson2||'').toLowerCase().includes(q) ||
               (s.phone||'').toLowerCase().includes(q) ||
               (s.email||'').toLowerCase().includes(q) ||
               productStr.includes(q);
    }
    var matchYr = !yr || (s.lastTransactionDate && new Date(s.lastTransactionDate).getFullYear().toString() === yr);
    var matchCt = !cat || (s.categories||[]).includes(cat);
    return matchQ && matchYr && matchCt;
  });

  if (dateFrom || dateTo) {
    list = list.filter(function(s) {
      if (!s.lastTransactionDate) return false;
      if (dateFrom && s.lastTransactionDate < dateFrom) return false;
      if (dateTo   && s.lastTransactionDate > dateTo)   return false;
      return true;
    });
  }

  if (sortColumn) {
    var fieldMap = { 'last_transaction_date': 'lastTransactionDate', 'company_name': 'companyName', 'contact_person': 'contactPerson', 'phone': 'phone' };
    var fld = fieldMap[sortColumn] || sortColumn;
    list.sort(function(a, b) {
      var av = (a[fld]||'').toString().toLowerCase();
      var bv = (b[fld]||'').toString().toLowerCase();
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ?  1 : -1;
      return 0;
    });
  }
  return list;
}

function render() {
  var list = getFilteredSorted();

  // Update sort icon
  document.querySelectorAll('.sort-icon').forEach(function(el){ el.classList.remove('active');
    el.className = el.className.replace('fa-sort-up','fa-sort').replace('fa-sort-down','fa-sort'); });
  if (sortColumn) {
    var icon = $('sort-' + sortColumn);
    if (icon) { icon.classList.add('active'); icon.className = icon.className.replace('fa-sort', sortAsc ? 'fa-sort-up' : 'fa-sort-down'); }
  }

  var total = list.length;
  var pages = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > pages) currentPage = pages;
  var start = (currentPage - 1) * pageSize;
  var page  = list.slice(start, start + pageSize);

  $('statTotal').textContent    = suppliers.length;
  var thisYear = new Date().getFullYear();
  $('statThisYear').textContent = suppliers.filter(function(s){ return s.lastTransactionDate && new Date(s.lastTransactionDate).getFullYear() === thisYear; }).length;
  $('statCategories').textContent = CATEGORIES.length;
  $('statProducts').textContent   = suppliers.reduce(function(sum, s) { return sum + (s.products || []).length; }, 0);

  var tbody = $('tableBody');
  if (!page.length) {
    tbody.innerHTML = '';
    $('emptyState').classList.remove('hidden');
    $('paginationBar').style.display = 'none';
    return;
  }
  $('emptyState').classList.add('hidden');
  $('paginationBar').style.display = '';

  tbody.innerHTML = page.map(function(s) {
    var cats = (s.categories||[]).map(function(c){
      var bg = CATEGORY_COLORS[c]||'#f3e8ff', tx = CATEGORY_TEXT_COLORS[c]||'#5b21b6';
      return '<span class="category-badge" style="background:'+bg+';color:'+tx+'">'+escHtml(c)+'</span>';
    }).join('');

    var prods = (s.products||[]).slice(0,3).map(function(p){
      return '<span class="product-tag">'+escHtml(typeof p==='string'?p:p.name)+'</span>';
    }).join('');
    if ((s.products||[]).length > 3) prods += '<span class="product-tag">+'+(s.products.length-3)+' more</span>';

    var txnDate = s.lastTransactionDate ? new Date(s.lastTransactionDate).toLocaleDateString('id-ID', {day:'2-digit', month:'short', year:'2-digit'}) : '—';
    var txnCls = s.lastTransactionDate ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500';

    var actions = '<button onclick="openDetailModal('+s.id+')" title="View" class="text-indigo-600 hover:text-indigo-800 mx-1"><i class="fas fa-eye"></i></button>';
    if (window.__canEdit)   actions += '<button onclick="openEditModal('+s.id+')" title="Edit" class="text-yellow-500 hover:text-yellow-700 mx-1"><i class="fas fa-edit"></i></button>';
    if (window.__canDelete) actions += '<button onclick="openDeleteModal('+s.id+')" title="Delete" class="text-red-500 hover:text-red-700 mx-1"><i class="fas fa-trash"></i></button>';

    return '<tr class="table-row-hover border-b border-gray-100">' +
      '<td class="px-4 py-3 font-medium" data-label="Company">'+escHtml(s.companyName)+'</td>' +
      '<td class="px-4 py-3 text-gray-600" data-label="Contact">'+escHtml(s.contactPerson)+(s.contactPerson2?'<br>'+escHtml(s.contactPerson2):'')+'</td>' +
      '<td class="px-4 py-3 text-gray-600 hidden md:table-cell" data-label="Phone">'+escHtml(s.phone)+(s.phone2?'<br>'+escHtml(s.phone2):'')+'</td>' +
      '<td class="px-4 py-3" data-label="Categories">'+cats+'</td>' +
      '<td class="px-4 py-3" data-label="Products">'+prods+'</td>' +
      '<td class="px-4 py-3 text-center md:text-center" data-label="Status"><span class="text-xs font-medium px-2 py-1 rounded-full '+txnCls+'">'+txnDate+'</span></td>' +
      '<td class="px-4 py-3 text-center md:text-center" data-label="Actions">'+actions+'</td>' +
      '</tr>';
  }).join('');

  renderPagination(total, pages);
}

function renderPagination(total, pages) {
  $('paginationInfo').textContent = 'Showing ' + Math.min(total, (currentPage-1)*pageSize+1) + '–' + Math.min(total, currentPage*pageSize) + ' of ' + total;
  var btns = '';
  btns += '<button class="pagination-btn rounded-l-lg" onclick="goPage('+(currentPage-1)+')" '+(currentPage===1?'disabled':'')+'>‹</button>';
  for (var i = 1; i <= pages; i++) {
    if (pages > 7 && Math.abs(i - currentPage) > 2 && i !== 1 && i !== pages) {
      if (i === currentPage - 3 || i === currentPage + 3) btns += '<button class="pagination-btn" disabled>…</button>';
      continue;
    }
    btns += '<button class="pagination-btn'+(i===currentPage?' active':'')+'" onclick="goPage('+i+')">'+i+'</button>';
  }
  btns += '<button class="pagination-btn rounded-r-lg" onclick="goPage('+(currentPage+1)+')" '+(currentPage===pages?'disabled':'')+'>›</button>';
  $('paginationButtons').innerHTML = btns;
}

function goPage(p) {
  var pages = Math.max(1, Math.ceil(getFilteredSorted().length / pageSize));
  if (p < 1 || p > pages) return;
  currentPage = p;
  render();
}

var _searchTimer = null;
function onSearch() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function() { currentPage = 1; render(); }, 300);
}

function sortBy(col) {
  document.querySelectorAll('.sort-icon').forEach(function(el){ el.classList.remove('active'); });
  if (sortColumn === col) { sortAsc = !sortAsc; } else { sortColumn = col; sortAsc = true; }
  var icon = $('sort-' + col);
  if (icon) { icon.classList.add('active'); icon.className = icon.className.replace('fa-sort', sortAsc ? 'fa-sort-up' : 'fa-sort-down'); }
  render();
}

// ─── Add / Edit Supplier ────────────────────────────────
function openAddModal() {
  $('editId').value = '';
  $('modalTitle').textContent = 'Add Supplier';
  $('fCompanyName').value = '';
  $('fContactPerson').value = '';
  $('fContactPerson2').value = '';
  $('fPhone').value = '';
  $('fPhone2').value = '';
  $('fEmail').value = '';
  $('fEmail2').value = '';
  $('fWebsite').value = '';
  $('fAddress').value = '';
  $('fLocation').value = '';
  $('fTransactionDate').value = '';
  $('fTransactionDate').setAttribute('max', new Date().toISOString().split('T')[0]);
  $('fNotes').value = '';
  $('productsList').innerHTML = '';
  $('addEditModal').classList.remove('hidden');
  $('addEditModal').classList.add('flex');
}

function openEditModal(id) {
  var s = suppliers.find(function(x){ return x.id === id; });
  if (!s) return;
  $('editId').value = s.id;
  $('modalTitle').textContent = 'Edit Supplier';
  $('fCompanyName').value  = s.companyName  || '';
  $('fContactPerson').value = s.contactPerson || '';
  $('fContactPerson2').value = s.contactPerson2 || '';
  $('fPhone').value    = s.phone    || '';
  $('fPhone2').value   = s.phone2   || '';
  $('fEmail').value    = s.email    || '';
  $('fEmail2').value   = s.email2   || '';
  $('fWebsite').value  = s.website  || '';
  $('fAddress').value  = s.address  || '';
  $('fLocation').value = s.location || '';
  $('fTransactionDate').value = s.lastTransactionDate || '';
  $('fTransactionDate').setAttribute('max', new Date().toISOString().split('T')[0]);
  $('fNotes').value    = s.notes    || '';
  $('productsList').innerHTML = '';
  (s.products||[]).forEach(function(p){ addProductField(p); });
  $('addEditModal').classList.remove('hidden');
  $('addEditModal').classList.add('flex');
}

function closeModal() {
  $('addEditModal').classList.add('hidden');
  $('addEditModal').classList.remove('flex');
}

async function saveSupplier() {
  var companyName   = $('fCompanyName').value.trim();
  var contactPerson = $('fContactPerson').value.trim();
  var phone         = $('fPhone').value.trim();
  if (!companyName || !contactPerson || !phone) {
    showToast('Company Name, Contact Person 1, and Phone 1 are required.', 'error');
    return;
  }

  var editId = $('editId').value;
  var dup = suppliers.find(function(s) {
    return s.companyName.toLowerCase() === companyName.toLowerCase() && String(s.id) !== String(editId);
  });
  if (dup) { showToast('Supplier dengan nama "' + companyName + '" sudah ada.', 'error'); return; }

  var email1 = $('fEmail').value.trim();
  var email2 = $('fEmail2').value.trim();
  var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (email1 && !emailRe.test(email1)) {
    showToast('Email 1 format tidak valid.', 'error');
    return;
  }
  if (email2 && !emailRe.test(email2)) {
    showToast('Email 2 format tidak valid.', 'error');
    return;
  }

  var txnDate = $('fTransactionDate').value || null;

  // Collect products from table rows
  var productRows = $('productsList').querySelectorAll('tr');
  var products = [];
  productRows.forEach(function(tr) {
    var inputs  = tr.querySelectorAll('input[type="text"]');
    var selects = tr.querySelectorAll('select');
    var name    = inputs[0] ? inputs[0].value.trim() : '';
    var cat     = selects[0] ? selects[0].value : '';
    var img     = inputs[1] ? inputs[1].value.trim() : '';
    if (name) products.push({ name: name, category: cat, image: img });
  });

  var catSet = {};
  products.forEach(function(p){ if(p.category) catSet[p.category] = true; });
  var categories = Object.keys(catSet);

  var payload = {
    company_name:     companyName,
    contact_person:   contactPerson,
    contact_person_2: $('fContactPerson2').value.trim(),
    phone:            phone,
    phone_2:          $('fPhone2').value.trim(),
    email:            email1,
    email_2:          email2,
    website:          $('fWebsite').value.trim(),
    address:          $('fAddress').value.trim(),
    location:         $('fLocation').value.trim(),
    categories:       categories,
    products:         products,
    last_transaction_date: txnDate,
    notes:            $('fNotes').value.trim()
  };

  showLoading();
  var error;

  if (editId) {
    var res = await supabase
      .from('suppliers')
      .update(payload)
      .eq('id', parseInt(editId))
      .select('*, creator:users!created_by(username), updater:users!updated_by(username)')
      .single();
    error = res.error;
    if (error) {
      var res2 = await supabase
        .from('suppliers')
        .update(payload)
        .eq('id', parseInt(editId))
        .select('*')
        .single();
      error = res2.error;
      if (!error) res = res2;
    }
    if (!error) {
      var idx = suppliers.findIndex(function(s){ return s.id === parseInt(editId); });
      if (idx !== -1) suppliers[idx] = fromSupabase(res.data);
    }
  } else {
    var res = await supabase
      .from('suppliers')
      .insert(payload)
      .select('*, creator:users!created_by(username), updater:users!updated_by(username)')
      .single();
    error = res.error;
    if (error) {
      await loadSuppliers();
      hideLoading();
      closeModal();
      render();
      showToast('Supplier added.', 'success');
      return;
    }
    if (!error) suppliers.push(fromSupabase(res.data));
  }

  hideLoading();
  if (error) {
    showToast('Error saving supplier: ' + error.message, 'error');
    return;
  }
  closeModal();
  render();
  showToast(editId ? 'Supplier updated.' : 'Supplier added.', 'success');
}

// ─── Delete Supplier ────────────────────────────────────
function openDeleteModal(id) {
  deleteTargetId = id;
  $('deleteModal').classList.remove('hidden');
  $('deleteModal').classList.add('flex');
}
function closeDeleteModal() {
  deleteTargetId = null;
  $('deleteModal').classList.add('hidden');
  $('deleteModal').classList.remove('flex');
}
async function confirmDelete() {
  if (!deleteTargetId) return;
  showLoading();
  var { error } = await supabase
    .from('suppliers')
    .delete()
    .eq('id', deleteTargetId);
  hideLoading();
  if (error) {
    showToast('Error deleting supplier: ' + error.message, 'error');
    closeDeleteModal();
    return;
  }
  suppliers = suppliers.filter(function(s){ return s.id !== deleteTargetId; });
  closeDeleteModal();
  render();
  showToast('Supplier deleted.', 'success');
}

// ─── Detail Modal ───────────────────────────────────────
function openDetailModal(id) {
  var s = suppliers.find(function(x){ return x.id === id; });
  if (!s) return;
  var cats = (s.categories||[]).map(function(c){
    var bg = CATEGORY_COLORS[c]||'#f3e8ff', tx = CATEGORY_TEXT_COLORS[c]||'#5b21b6';
    return '<span class="category-badge" style="background:'+bg+';color:'+tx+'">'+escHtml(c)+'</span>';
  }).join('');

  var prodHTML = '';
  (s.products||[]).forEach(function(p){
    var name = typeof p==='string'?p:p.name;
    var img  = typeof p==='object'?p.image:'';
    var cat  = typeof p==='object'?p.category:'';
    if (img) {
      prodHTML += '<div class="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">' +
        '<div class="w-12 h-12 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center flex-shrink-0 cursor-pointer" onclick="showImageLightbox(\''+escHtml(img)+'\',\''+escHtml(name)+'\')">'+
        '<img src="'+escHtml(img)+'" alt="'+escHtml(name)+'" style="width:100%;height:100%;object-fit:cover" onerror="imgError(this)"></div>' +
        '<div><div class="text-sm font-medium">'+escHtml(name)+'</div>' +
        (cat?'<div class="text-xs text-gray-400">'+escHtml(cat)+'</div>':'') +
        '</div></div>';
    } else {
      prodHTML += '<div class="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">' +
        '<div class="w-12 h-12 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-300"><i class="fas fa-image"></i></div>' +
        '<div><div class="text-sm font-medium">'+escHtml(name)+'</div>' +
        (cat?'<div class="text-xs text-gray-400">'+escHtml(cat)+'</div>':'') +
        '</div></div>';
    }
  });

  var mapHTML = '';
  if (s.location) {
    var loc = s.location;
    var q = loc;
    // extract query from common Google Maps URL formats
    var m = loc.match(/[?&]q=([^&]+)/);
    if (m) q = decodeURIComponent(m[1]);
    m = loc.match(/\/place\/([^\/@?]+)/);
    if (m) q = decodeURIComponent(m[1].replace(/\+/g,' '));
    var embedSrc = 'https://maps.google.com/maps?q=' + encodeURIComponent(q) + '&output=embed&z=12';
    mapHTML = '<div class="mt-3"><div class="map-container" style="position:relative;width:100%;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">' +
      '<iframe src="'+escHtml(embedSrc)+'" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" allowfullscreen loading="lazy"></iframe></div>' +
      '<a href="'+escHtml(loc.match(/^https?:\/\//)?loc:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q))+'" target="_blank" rel="noopener" class="text-blue-600 hover:underline text-xs mt-1 inline-block"><i class="fas fa-external-link-alt mr-1"></i>Open in Google Maps</a></div>';
  }

  var auditHTML = '';
  if (s.created_at) {
    var createdTime = new Date(s.created_at).toLocaleString();
    var creator = s.creatorUsername || 'System';
    auditHTML += '<div class="text-xs text-gray-400 mt-4 border-t border-gray-100 pt-3">Created by <span class="font-medium text-gray-600">' + escHtml(creator) + '</span> on ' + createdTime;
    if (s.updated_at && s.updated_at !== s.created_at) {
      var updatedTime = new Date(s.updated_at).toLocaleString();
      var updater = s.updaterUsername || 'System';
      auditHTML += '<br>Last updated by <span class="font-medium text-gray-600">' + escHtml(updater) + '</span> on ' + updatedTime;
    }
    auditHTML += '</div>';
  }

  var h = '<div class="p-6 border-b border-gray-200 flex items-center justify-between">' +
    '<h2 class="text-lg font-bold">'+escHtml(s.companyName)+'</h2>' +
    '<button onclick="closeDetailModal()" class="text-gray-400 hover:text-gray-600 text-xl"><i class="fas fa-times"></i></button>' +
    '</div><div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">' +
    '<div class="space-y-3">' +
    '<div><div class="text-xs text-gray-400 uppercase mb-1">Contact Person 1</div><div class="font-medium">'+escHtml(s.contactPerson)+'</div><div class="text-sm text-gray-500">'+escHtml(s.phone)+'</div>'+(s.email?'<a href="mailto:'+escHtml(s.email)+'" class="text-indigo-600 hover:underline text-sm">'+escHtml(s.email)+'</a>':'')+'</div>' +
    (s.contactPerson2?'<div><div class="text-xs text-gray-400 uppercase mb-1">Contact Person 2</div><div class="font-medium">'+escHtml(s.contactPerson2)+'</div><div class="text-sm text-gray-500">'+escHtml(s.phone2||'')+'</div>'+(s.email2?'<a href="mailto:'+escHtml(s.email2)+'" class="text-indigo-600 hover:underline text-sm">'+escHtml(s.email2)+'</a>':'')+'</div>':'') +
    (s.website?'<div><div class="text-xs text-gray-400 uppercase mb-1">Website</div><a href="'+escHtml(s.website)+'" target="_blank" class="text-indigo-600 hover:underline">'+escHtml(s.website)+'</a></div>':'') +
    (s.address?'<div><div class="text-xs text-gray-400 uppercase mb-1">Address</div><div>'+escHtml(s.address)+'</div></div>':'') +
    '<div><div class="text-xs text-gray-400 uppercase mb-1">Last Transaction</div><div class="font-medium">'+(s.lastTransactionDate ? new Date(s.lastTransactionDate).toLocaleDateString('id-ID') : '—')+'</div></div>' +
    '<div><div class="text-xs text-gray-400 uppercase mb-1">Categories</div>'+cats+'</div>' +
    (s.notes?'<div><div class="text-xs text-gray-400 uppercase mb-1">Notes</div><div class="text-sm text-gray-600">'+escHtml(s.notes)+'</div></div>':'') +
    auditHTML +
    mapHTML +
    '</div>' +
    '<div><div class="text-xs text-gray-400 uppercase mb-2">Products ('+((s.products||[]).length)+')</div>' +
    (prodHTML || '<div class="text-sm text-gray-400">No products listed.</div>') +
    '</div></div>' +
    '<div class="p-6 border-t border-gray-200 flex justify-end gap-3">';
  if (window.__canEdit) h += '<button onclick="closeDetailModal();openEditModal('+s.id+')" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm"><i class="fas fa-edit mr-1"></i>Edit</button>';
  if (currentUser && currentUser.role === 'Admin') h += '<button onclick="openAuditLogModal('+s.id+')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition"><i class="fas fa-history mr-1"></i>Audit Log</button>';
  h += '</div>';
  $('detailContent').innerHTML = h;
  $('detailModal').classList.remove('hidden');
  $('detailModal').classList.add('flex');
}

function closeDetailModal() {
  $('detailModal').classList.add('hidden');
  $('detailModal').classList.remove('flex');
}

// ─── Image Lightbox ─────────────────────────────────────
function showImageLightbox(src, name) {
  $('lightboxImage').src = src;
  $('lightboxCaption').textContent = name || '';
  $('imageModal').classList.remove('hidden');
  $('imageModal').classList.add('flex');
}
function closeImageModal(e) {
  if (e && e.target !== e.currentTarget) return;
  $('imageModal').classList.add('hidden');
  $('imageModal').classList.remove('flex');
  $('lightboxImage').src = '';
}
function imgError(el) {
  var p = document.createElement('i');
  p.className = 'fas fa-image';
  p.style.cssText = 'font-size:2rem;color:#94a3b8';
  el.parentNode.replaceChild(p, el);
}

// ─── Product Fields in Modal ────────────────────────────
function addProductField(v) {
  var tr  = document.createElement('tr');
  var nm  = (typeof v==='object'&&v!==null) ? (v.name||'')  : (v||'');
  var im  = (typeof v==='object'&&v!==null) ? (v.image||'') : '';
  var cat = (typeof v==='object'&&v!==null) ? (v.category||'') : '';

  var prev = im
    ? '<img src="'+escHtml(im)+'" style="width:100%;height:100%;object-fit:cover" onerror="imgError(this)">'
    : '<i class="fas fa-image"></i>';

  var catOpts = '<option value="">Select category</option>';
  CATEGORIES.forEach(function(c) {
    catOpts += '<option value="'+escHtml(c)+'"'+(cat===c?' selected':'')+'>'+escHtml(c)+'</option>';
  });

  tr.innerHTML =
    '<td class="px-2 py-2"><input type="text" class="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-400 outline-none" placeholder="Product name" value="'+escHtml(nm)+'"></td>' +
    '<td class="px-2 py-2"><select class="product-cat-select w-full border border-gray-300 rounded px-1 py-1 text-xs focus:ring-2 focus:ring-indigo-400 outline-none">'+catOpts+'</select></td>' +
    '<td class="px-2 py-2"><div class="flex items-center gap-1"><input type="text" class="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-400 outline-none" placeholder="Image URL" value="'+escHtml(im)+'" oninput="updateProductPreview(this)"><input type="file" accept="image/*" style="display:none" class="product-file-input" onchange="handleProductImageUpload(this)"><button type="button" onclick="this.previousElementSibling.click()" class="text-xs text-indigo-600 hover:text-indigo-800" title="Upload"><i class="fas fa-upload"></i></button></div></td>' +
    '<td class="px-2 py-2 text-center"><div class="product-img-preview" style="width:40px;height:40px;border-radius:4px;overflow:hidden;border:1px solid #e2e8f0;margin:0 auto;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:1rem;color:#94a3b8">'+prev+'</div></td>' +
    '<td class="px-2 py-2 text-center"><button type="button" onclick="this.closest(\'tr\').remove()" class="text-gray-400 hover:text-red-500 transition"><i class="fas fa-times-circle"></i></button></td>';
  $('productsList').appendChild(tr);
}

async function handleProductImageUpload(input) {
  var file = input.files[0]; if (!file) return;
  var row = input.closest('tr');
  var textInputs = row.querySelectorAll('input[type="text"]');
  var preview = row.querySelector('.product-img-preview');
  
  var originalPreview = preview ? preview.innerHTML : '<i class="fas fa-image"></i>';
  if (preview) {
    preview.innerHTML = '<i class="fas fa-spinner fa-spin text-indigo-600"></i>';
  }

  var ext = file.name.split('.').pop();
  var cleanName = 'prod_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7) + '.' + ext;

  const { data, error } = await supabase.storage
    .from('product-images')
    .upload(cleanName, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (error) {
    if (preview) preview.innerHTML = originalPreview;
    showToast('Image upload failed: ' + error.message, 'error');
    input.value = '';
    return;
  }

  const { data: urlData } = supabase.storage
    .from('product-images')
    .getPublicUrl(cleanName);

  var publicUrl = urlData.publicUrl;
  if (textInputs.length >= 2) textInputs[1].value = publicUrl;
  if (preview) {
    preview.innerHTML = '<img src="'+escHtml(publicUrl)+'" style="width:100%;height:100%;object-fit:cover">';
  }
  showToast('Image uploaded successfully.', 'success');
  input.value = '';
}

function updateProductPreview(input) {
  var row = input.closest('tr');
  var preview = row.querySelector('.product-img-preview');
  var url = input.value.trim();
  if (url) preview.innerHTML = '<img src="'+escHtml(url)+'" style="width:100%;height:100%;object-fit:cover" onerror="imgError(this)">';
  else preview.innerHTML = '<i class="fas fa-image"></i>';
}

// ─── Import / Export ────────────────────────────────────
function handleImport(input) {
  var file = input.files[0]; if (!file) return;
  if (!window.__canEdit) { showToast('You do not have permission to import.', 'error'); input.value=''; return; }
  var ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') {
    var reader = new FileReader();
    reader.onload = function(e) { parseCSV(e.target.result); input.value=''; };
    reader.readAsText(file);
  } else if (ext==='xls'||ext==='xlsx') {
    var reader = new FileReader();
    reader.onload = function(e) { parseXLSX(new Uint8Array(e.target.result)); input.value=''; };
    reader.readAsArrayBuffer(file);
  } else {
    showToast('Please select a CSV or Excel file.', 'error'); input.value='';
  }
}

function parseCSV(text) {
  var lines = text.split('\n');
  if (lines.length < 2) { showToast('CSV file is empty or has no data rows.', 'error'); return; }
  var headers = parseCSVRow(lines[0]);
  var rows = [];
  for (var i = 1; i < lines.length; i++) { var line=lines[i].trim(); if(line) rows.push(parseCSVRow(line)); }
  processImportData(headers, rows);
}

function parseCSVRow(row) {
  var result=[], current='', inQuotes=false;
  for (var i=0; i<row.length; i++) {
    var c=row[i];
    if (inQuotes) { if(c==='"'){if(i+1<row.length&&row[i+1]==='"'){current+='"';i++;}else{inQuotes=false;}}else{current+=c;} }
    else { if(c==='"'){inQuotes=true;}else if(c===','){result.push(current.trim());current='';}else{current+=c;} }
  }
  result.push(current.trim()); return result;
}

function parseXLSX(data) {
  var wb=XLSX.read(data,{type:'array'}); var sheet=wb.Sheets[wb.SheetNames[0]];
  var json=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
  if(json.length<2){showToast('Excel file is empty.','error');return;}
  processImportData(json[0], json.slice(1).filter(function(r){return r.join('').trim();}));
}

async function processImportData(headers, rows) {
  var hLower = headers.map(function(h){return h.toString().toLowerCase().trim();});
  var colKeys = {
    companyName:    ['company name','company','perusahaan','nama perusahaan','supplier'],
    contactPerson:  ['contact person','contact','pic','kontak','nama kontak','contact person 1'],
    contactPerson2: ['contact person 2','contact 2','pic 2','kontak 2'],
    phone:          ['phone','telephone','telp','telepon','no telp','hp','no hp','phone 1'],
    phone2:         ['phone 2','telp 2','hp 2','no hp 2'],
    email:          ['email','e-mail','email 1'],
    email2:         ['email 2','e-mail 2'],
    website:        ['website','web','site'],
    address:        ['address','alamat'],
    location:       ['location','maps','google maps','lokasi','map'],
    categories:     ['categories','category','kategori','cat'],
    products:       ['products','product','produk','barang'],
    lastTransactionDate: ['last transaction','last transaction date','transaction date','tanggal transaksi','tgl transaksi'],
    notes:          ['notes','note','keterangan','remark']
  };
  var map={};
  for (var key in colKeys) {
    for (var i=0; i<hLower.length; i++) {
      for (var j=0; j<colKeys[key].length; j++) {
        if (hLower[i].indexOf(colKeys[key][j]) !== -1) { map[key]=i; break; }
      }
      if (map[key]!==undefined) break;
    }
  }
  if (map.companyName===undefined) { showToast('Could not find "Company Name" column.','error'); return; }

  var batch=[], skipped=0;
  rows.forEach(function(row) {
    if(typeof row==='string') row=[row];
    var cn=(row[map.companyName]||'').toString().trim(); if(!cn){skipped++;return;}
    var cp=(map.contactPerson!==undefined?row[map.contactPerson]:'').toString().trim()||cn;
    var cp2=(map.contactPerson2!==undefined?row[map.contactPerson2]:'').toString().trim();
    var ph=(map.phone!==undefined?row[map.phone]:'').toString().trim()||'-';
    var ph2=(map.phone2!==undefined?row[map.phone2]:'').toString().trim();
    var em=(map.email!==undefined?row[map.email]:'').toString().trim();
    var em2=(map.email2!==undefined?row[map.email2]:'').toString().trim();
    var categories=[];
    if(map.categories!==undefined){var raw=(row[map.categories]||'').toString().trim();if(raw)categories=raw.split(/[,;\/]/).map(function(s){return s.trim();}).filter(Boolean);}
    if(!categories.length) categories=['General Part'];
    var defCat=categories[0];
    var products=[];
    if(map.products!==undefined){var pRaw=(row[map.products]||'').toString().trim();if(pRaw)pRaw.split(/[,;]/).forEach(function(n){n=n.trim();if(n)products.push({name:n,image:'',category:defCat});});}
    var txnDate = (map.lastTransactionDate!==undefined?row[map.lastTransactionDate]:'').toString().trim() || null;
    batch.push({
      company_name:     cn, contact_person: cp, contact_person_2: cp2,
      phone:            ph, phone_2: ph2,
      email:            em, email_2: em2,
      website:          (map.website!==undefined?row[map.website]:'').toString().trim(),
      address:          (map.address!==undefined?row[map.address]:'').toString().trim(),
      location:         (map.location!==undefined?row[map.location]:'').toString().trim(),
      categories:       categories, products: products,
      last_transaction_date: txnDate,
      notes:            (map.notes!==undefined?row[map.notes]:'').toString().trim()
    });
  });

  if (!batch.length) { showToast('No valid rows found.', 'warning'); return; }
  showLoading();
  var { data, error } = await supabase.from('suppliers').insert(batch).select('*, creator:users!created_by(username), updater:users!updated_by(username)');
  hideLoading();
  if (error) {
    await loadSuppliers();
    render();
    showToast('Imported ' + batch.length + ' supplier'+(batch.length>1?'s':'')+(skipped>0?', '+skipped+' skipped':'')+'.','success');
    return;
  }
  (data||[]).forEach(function(r){ suppliers.push(fromSupabase(r)); });
  render();
  showToast('Imported ' + batch.length + ' supplier'+(batch.length>1?'s':'')+(skipped>0?', '+skipped+' skipped':'')+'.','success');
}

async function exportCSV() {
  var hdrs=['Company Name','Contact Person 1','Contact Person 2','Phone 1','Phone 2','Email 1','Email 2','Website','Address','Location','Categories','Products','Last Transaction Date','Notes'];
  var rows = suppliers.map(function(s){
    var prodStr=(s.products||[]).map(function(p){return typeof p==='string'?p:p.name;}).join(', ');
    var txnDate = s.lastTransactionDate || '';
    return [csvEsc(s.companyName),csvEsc(s.contactPerson),csvEsc(s.contactPerson2||''),
            csvEsc(s.phone),csvEsc(s.phone2||''),csvEsc(s.email||''),csvEsc(s.email2||''),
            csvEsc(s.website||''),csvEsc(s.address||''),csvEsc(s.location||''),
            csvEsc((s.categories||[]).join(', ')),csvEsc(prodStr),csvEsc(txnDate),csvEsc(s.notes||'')];
  });
  var csv=hdrs.join(',')+'\n'+rows.map(function(r){return r.join(',');}).join('\n');
  await downloadFile(csv,'suppliers.csv','text/csv');
  showToast('CSV exported!','success');
}

async function downloadTemplate() {
  var hdrs=['Company Name','Contact Person 1','Contact Person 2','Phone 1','Phone 2','Email 1','Email 2','Website','Address','Location','Categories','Products','Last Transaction Date','Notes'];
  var rows=[
    ['PT Maju Jaya','Budi Santoso','','021-5550123','','budi@maju.co.id','','https://maju.co.id','Jl. Gatot Subroto No.10','https://maps.google.com/?q=Jakarta','Raw Materials;Packaging','Steel Sheets;Aluminum Bars','2026-01-15','Long-term partner since 2020'],
    ['CV Teknik Prima','Siti Rahma','Andi','022-7890456','0812345678','siti@prima.com','andi@prima.com','','Jl. Asia Afrika No.45','','Electronics','PCB Assemblies;Microcontrollers','2026-03-20','ISO certified'],
    ['UD Berkah Abadi','Ahmad Fauzi','','0341-123456','','ahmad@abadi.com','','','Jl. Ijen No.7','','Stationery;General Part','Paper;Pens;Markers','','Minimum order 100 pcs']
  ];
  var csv=hdrs.map(csvEsc).join(',')+'\n';
  rows.forEach(function(row){
    csv+=row.map(csvEsc).join(',')+'\n';
  });
  await downloadFile(csv,'template-import.csv','text/csv');
  showToast('Template downloaded!','success');
}

// ─── Theme ──────────────────────────────────────────────
function initTheme() {
  var saved = localStorage.getItem('theme');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  var icon = $('themeToggleIcon');
  if (icon) icon.className = 'fas ' + (theme === 'dark' ? 'fa-sun' : 'fa-moon');
}

function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ─── Manage Users ───────────────────────────────────────
async function openManageUsers() {
  $('userModal').classList.remove('hidden');
  $('userModal').classList.add('flex');
  $('userTableBody').innerHTML = '<tr><td colspan="4" class="px-3 py-4 text-center text-gray-400 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>Loading...</td></tr>';

  // Gunakan RPC get_users_with_email() agar email dari auth.users ikut tampil
  const { data, error } = await supabase.rpc('get_users_with_email');

  if (error) {
    $('userTableBody').innerHTML = '<tr><td colspan="4" class="px-3 py-4 text-center text-red-400 text-sm">Error loading users: '+escHtml(error.message)+'</td></tr>';
    return;
  }

  var rc = {'Admin':'bg-purple-100 text-purple-700','Editor':'bg-blue-100 text-blue-700','Viewer':'bg-gray-100 text-gray-700'};
  var isAdmin = currentUser && currentUser.role === 'Admin';

  $('userTableBody').innerHTML = (data||[]).map(function(u) {
    var isSelf = currentUser && u.id === currentUser.id;
    var roleSelect = '';
    if (isAdmin && !isSelf) {
      roleSelect =
        '<div class="flex items-center gap-1">' +
        '<select id="rolesel-'+u.id+'" class="border border-gray-200 rounded px-1 py-0.5 text-xs focus:ring-2 focus:ring-indigo-400 outline-none">' +
        '<option value="Admin"'+(u.role==='Admin'?' selected':'')+'>Admin</option>' +
        '<option value="Editor"'+(u.role==='Editor'?' selected':'')+'>Editor</option>' +
        '<option value="Viewer"'+(u.role==='Viewer'?' selected':'')+'>Viewer</option>' +
        '</select>' +
        '<button onclick="saveUserRole(\''+u.id+'\')" class="text-xs text-indigo-600 hover:text-indigo-800 px-2 py-0.5 rounded border border-indigo-200 hover:bg-indigo-50 transition" title="Save role"><i class="fas fa-save"></i></button>' +
        '</div>';
    } else {
      roleSelect = '<span class="text-xs px-2 py-0.5 rounded-full '+(rc[u.role]||'bg-gray-100 text-gray-700')+'">' + u.role + (isSelf?' <span class="opacity-60">(you)</span>':'') + '</span>';
    }

    return '<tr class="border-b border-gray-100 table-row-hover" id="userrow-'+u.id+'">' +
      '<td class="px-3 py-2 text-sm font-medium">' + escHtml(u.username) + '</td>' +
      '<td class="px-3 py-2 text-sm text-gray-500">' + escHtml(u.email || '—') + '</td>' +
      '<td class="px-3 py-2" id="userrole-'+u.id+'">' + roleSelect + '</td>' +
      '<td class="px-3 py-2 text-center">' +
        (isAdmin && !isSelf ? '<button onclick="deleteUser(\''+u.id+'\')" class="text-xs text-red-500 hover:text-red-700 px-2 py-0.5 rounded border border-red-200 hover:bg-red-50 transition" title="Delete user"><i class="fas fa-trash"></i></button>' : '') +
      '</td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="4" class="px-3 py-4 text-center text-gray-400 text-sm">No users found.</td></tr>';
}

async function saveUserRole(userId) {
  var sel = $('rolesel-' + userId);
  if (!sel) return;
  var newRole = sel.value;
  sel.disabled = true;

  const { data, error } = await supabase.rpc('update_user_role', {
    target_user_id: userId,
    new_role: newRole
  });

  sel.disabled = false;

  if (error || (data && data.success === false)) {
    var msg = error ? error.message : (data && data.error) || 'Unknown error';
    showToast('Failed to update role: ' + msg, 'error');
    return;
  }

  showToast('Role updated to ' + newRole + '.', 'success');
  // Refresh user list
  await openManageUsers();
}

async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;
  showLoading();
  try {
    var { data, error } = await supabase.rpc('admin_delete_user', { target_user_id: userId });
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    showToast('User deleted.', 'success');
    await openManageUsers();
  } catch (e) {
    showToast('Error: ' + (e.message || 'Unknown error'), 'error');
  } finally {
    hideLoading();
  }
}

async function addUser() {
  var username = $('fNewUserUsername').value.trim();
  var email    = $('fNewUserEmail').value.trim();
  var password = $('fNewUserPassword').value.trim();
  var role     = $('fNewUserRole').value;
  if (!username || !email || !password) { showToast('Please fill all fields.', 'error'); return; }
  if (password.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
  $('fNewUserUsername').value = ''; $('fNewUserEmail').value = ''; $('fNewUserPassword').value = '';
  showLoading();

  try {
    var { data: dupData, error: dupError } = await supabase.rpc('check_user_duplicate', {
      p_email: email,
      p_username: username
    });
    if (dupError) {
      showToast('Error: ' + dupError.message, 'error');
      return;
    }
    if (dupData?.email_exists) {
      showToast('Email already registered.', 'error');
      return;
    }
    if (dupData?.username_exists) {
      showToast('Username already taken.', 'error');
      return;
    }

    // Panggil RPC admin_create_user — GoTrue Admin API via pg_net (no rate limit)
    var { data: rpcData, error: rpcError } = await supabase.rpc('admin_create_user', {
      user_email: email,
      user_password: password,
      user_username: username,
      user_role: role
    });

    if (rpcError) {
      showToast('Error: ' + rpcError.message, 'error');
      return;
    }

    if (!rpcData || rpcData.success === false) {
      showToast('Error: ' + ((rpcData && rpcData.error) || 'Unknown error'), 'error');
      return;
    }

    showToast('User ' + rpcData.username + ' (' + rpcData.role + ') created successfully.', 'success');
    await openManageUsers();
  } catch (e) {
    showToast('Error: ' + (e.message || 'Unknown error'), 'error');
  } finally {
    hideLoading();
  }
}

function closeUserModal() {
  $('userModal').classList.add('hidden');
  $('userModal').classList.remove('flex');
}

// ─── Manage Categories ──────────────────────────────────
var ALL_CATEGORIES = [];

async function openManageCategories() {
  $('categoryModal').classList.remove('hidden');
  $('categoryModal').classList.add('flex');
  var { data, error } = await supabase.from('categories').select('*').order('name');
  if (error) { showToast('Error loading categories: ' + error.message, 'error'); }
  ALL_CATEGORIES = data || [];
  renderCategories();
}

function closeCategoryModal() {
  $('categoryModal').classList.add('hidden');
  $('categoryModal').classList.remove('flex');
  $('fCategoryName').value = '';
}

function renderCategories() {
  var html = ALL_CATEGORIES.map(function(c) {
    var bg = c.bg_color||'#f3e8ff', tx = c.text_color||'#5b21b6';
    var activeIcon = c.is_active
      ? '<i class="fas fa-toggle-on text-green-500 text-lg"></i>'
      : '<i class="fas fa-toggle-off text-gray-400 text-lg"></i>';
    return '<tr class="border-b border-gray-100">' +
      '<td class="px-3 py-2 text-sm font-medium">'+escHtml(c.name)+'</td>' +
      '<td class="px-3 py-2"><span class="category-badge" style="background:'+bg+';color:'+tx+'">'+escHtml(c.name)+'</span></td>' +
      '<td class="px-3 py-2 text-center whitespace-nowrap">' +
        '<button onclick="toggleCategoryActive('+c.id+')" class="text-sm mx-1" title="Toggle active">'+activeIcon+'</button>' +
        '<button onclick="deleteCategory('+c.id+')" class="text-xs text-red-600 hover:text-red-800 mx-1"><i class="fas fa-trash"></i></button>' +
      '</td></tr>';
  }).join('');
  $('categoryTableBody').innerHTML = html || '<tr><td colspan="4" class="px-3 py-4 text-center text-gray-400 text-sm">No categories.</td></tr>';
}

async function toggleCategoryActive(id) {
  var cat = ALL_CATEGORIES.find(function(c){ return c.id === id; });
  if (!cat) return;
  var newVal = !cat.is_active;
  var { error } = await supabase.from('categories').update({ is_active: newVal }).eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  cat.is_active = newVal;
  renderCategories();
  // reload active categories for dashboard
  await loadCategories();
  render();
  showToast('Category ' + (newVal ? 'activated' : 'deactivated') + '.', 'success');
}

async function addCategory() {
  var name = $('fCategoryName').value.trim();
  if (!name) { showToast('Please enter a category name.', 'error'); return; }
  if (ALL_CATEGORIES.some(function(c){ return c.name.toLowerCase()===name.toLowerCase(); })) {
    showToast('Category already exists.', 'error'); return;
  }
  var p = CATEGORY_PALETTE[paletteIdx % CATEGORY_PALETTE.length];
  paletteIdx++;
  showLoading();
  var { data, error } = await supabase
    .from('categories')
    .insert({ name: name, bg_color: p.bg, text_color: p.text, is_active: true })
    .select()
    .single();
  hideLoading();
  if (error) { showToast('Error adding category: ' + error.message, 'error'); return; }
  ALL_CATEGORIES.push(data);
  // reload active categories for dashboard
  await loadCategories();
  populateCategoryFilter();
  render();
  renderCategories();
  $('fCategoryName').value = '';
  showToast('Category added.', 'success');
}

async function deleteCategory(id) {
  var cat = ALL_CATEGORIES.find(function(c){ return c.id === id; });
  if (!cat) return;
  showLoading();
  var { error } = await supabase.from('categories').delete().eq('id', id);
  hideLoading();
  if (error) { showToast('Error deleting category: ' + error.message, 'error'); return; }
  ALL_CATEGORIES = ALL_CATEGORIES.filter(function(c){ return c.id !== id; });
  renderCategories();
  // reload active categories for dashboard
  await loadCategories();
  populateCategoryFilter();
  render();
  showToast('Category deleted.', 'success');
}

// ─── Realtime Subscriptions ─────────────────────────────
var _realtimeChannel = null;

function setupRealtime() {
  // Batalkan channel sebelumnya jika ada
  if (_realtimeChannel) {
    supabase.removeChannel(_realtimeChannel);
  }

  _realtimeChannel = supabase
    .channel('db-changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'suppliers' },
      function(payload) {
        var existing = suppliers.find(function(s){ return s.id === payload.new.id; });
        if (!existing) {
          suppliers.push(fromSupabase(payload.new));
          render();
          showToast('New supplier added by another user.', 'warning');
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'suppliers' },
      function(payload) {
        var idx = suppliers.findIndex(function(s){ return s.id === payload.new.id; });
        if (idx !== -1) {
          suppliers[idx] = fromSupabase(payload.new);
          render();
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'suppliers' },
      function(payload) {
        var prev = suppliers.length;
        suppliers = suppliers.filter(function(s){ return s.id !== payload.old.id; });
        if (suppliers.length !== prev) {
          render();
          showToast('A supplier was deleted by another user.', 'warning');
        }
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'categories' },
      async function() {
        // Reload categories ketika ada perubahan
        await loadCategories();
        render();
      }
    )
    .subscribe();
}

function teardownRealtime() {
  if (_realtimeChannel) {
    supabase.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
}

// ─── Summary Charts ────────────────────────────────────
var _summaryCharts = {};

function openSummaryModal() {
  $('summaryModal').classList.remove('hidden');
  $('summaryModal').classList.add('flex');
  renderSummaryCharts();
}

function closeSummaryModal() {
  $('summaryModal').classList.add('hidden');
  $('summaryModal').classList.remove('flex');
  Object.values(_summaryCharts).forEach(function(c) { c.destroy(); });
  _summaryCharts = {};
}

function parseCityFromMaps(location) {
  if (!location) return null;
  var url = location;

  // 1. Cari parameter q=... (Google Maps search query)
  var qMatch = url.match(/[?&]q=([^&]+)/i);
  if (qMatch) {
    var q = decodeURIComponent(qMatch[1].replace(/\+/g, ' '));
    var city = parseCity(q);
    if (city && city !== 'Lainnya') return city;
  }

  // 2. Cari path /place/... (Google Maps place URL)
  var placeMatch = url.match(/\/place\/([^/@?]+)/i);
  if (placeMatch) {
    var place = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
    // Place path biasanya format: "Nama Tempat, Kecamatan, Kota, Provinsi"
    var parts = place.split(',').map(function(s) { return s.trim(); }).filter(Boolean);

    // Cari "Kota X" / "Kabupaten X" dalam path
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var pl = p.toLowerCase();
      var mKota = pl.match(/^(kota)\s+(.+)/i);
      if (mKota) return 'Kota ' + toTitleCase(mKota[2]);
      var mKab  = pl.match(/^(kabupaten|kab\.?)\s+(.+)/i);
      if (mKab)  return 'Kab. ' + toTitleCase(mKab[2]);
    }

    // Ambil bagian terakhir yang bukan numerik/kode pos
    for (var j = parts.length - 1; j >= 0; j--) {
      var pj = parts[j];
      if (pj.length > 2 && !/^\d/.test(pj) && !/^\d{5}$/.test(pj)) {
        // Cek apakah bagian ini terlihat seperti nama provinsi (umumnya 1 kata pendek untuk provinsi besar)
        var commonProvinces = ['jawa barat', 'jawa timur', 'jawa tengah', 'dki jakarta', 'banten',
                               'sumatera utara', 'sumatera barat', 'sumatera selatan', 'riau',
                               'kalimantan timur', 'kalimantan barat', 'kalimantan selatan',
                               'sulawesi selatan', 'sulawesi utara', 'bali', 'papua', 'yogyakarta',
                               'aceh', 'lampung', 'bengkulu', 'jambi', 'maluku', 'ntb', 'ntt',
                               'gorontalo', 'maluku utara', 'kepulauan riau', 'bangka belitung',
                               'sulawesi tengah', 'sulawesi tenggara', 'sulawesi barat',
                               'kalimantan utara', 'kalimantan tengah', 'papua barat',
                               'di yogyakarta', 'daerah istimewa', 'daerah khusus'];
        var isProv = false;
        for (var k = 0; k < commonProvinces.length; k++) {
          if (pj.toLowerCase().indexOf(commonProvinces[k]) !== -1) { isProv = true; break; }
        }
        if (!isProv) return toTitleCase(pj);
      }
    }

    return toTitleCase(parts[0]);
  }

  return null;
}

function parseCity(address) {
  if (!address) return 'Lainnya';

  // Normalisasi: hapus kode pos (5 digit angka di akhir)
  var cleaned = address.replace(/\b\d{5}\b/g, '').trim();

  var parts = cleaned.split(',').map(function(s) { return s.trim(); }).filter(Boolean);

  var skipPrefixes = ['jl.', 'jl ', 'jalan ', 'jln.', 'jln ', 'no.', 'no ', 'blok ', 'blk.', 'rt ', 'rw ',
                      'ds.', 'ds ', 'dusun ', 'kp.', 'kp ', 'kampung ', 'gg.', 'gg ', 'gang '];

  // 1. Cari "Kota ..." / "Kabupaten ..." / "Kab. ..." eksplisit
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var pl = p.toLowerCase();
    var mKota = pl.match(/^(kota)\s+(.+)/i);
    if (mKota) return 'Kota ' + toTitleCase(mKota[2]);
    var mKab  = pl.match(/^(kabupaten|kab\.?)\s+(.+)/i);
    if (mKab)  return 'Kab. ' + toTitleCase(mKab[2]);
  }

  // 2. Cari bagian yg mengandung kata "Kecamatan" — ambil nama kecamatannya sebagai fallback
  var kecName = null;
  for (var j = 0; j < parts.length; j++) {
    var pl2 = parts[j].toLowerCase();
    var mKec = pl2.match(/^kec(?:amatan)?[.\s]+(.+)/i);
    if (mKec) { kecName = toTitleCase(mKec[1]); continue; }
    if (pl2.indexOf('kecamatan') === 0 || pl2.indexOf('kec.') === 0) continue;
  }

  // 3. Ambil bagian terakhir yang bukan awalan jalan / terlalu pendek / numerik / administratif
  var adminWords = ['kecamatan', 'kec.', 'kec ', 'kelurahan', 'kel.', 'kel ', 'desa', 'provinsi',
                    'prov.', 'prov ', 'indonesia', 'rt ', 'rw ', 'kodepos', 'kode pos'];
  for (var k = parts.length - 1; k >= 0; k--) {
    var pk = parts[k];
    var pkl = pk.toLowerCase();

    // Skip jika diawali prefix jalan
    var pref = false;
    for (var x = 0; x < skipPrefixes.length; x++) {
      if (pkl.indexOf(skipPrefixes[x]) === 0) { pref = true; break; }
    }
    if (pref) continue;

    // Skip jika bagian administratif
    var adm = false;
    for (var y = 0; y < adminWords.length; y++) {
      if (pkl.indexOf(adminWords[y]) === 0) { adm = true; break; }
    }
    if (adm) continue;

    // Skip jika pendek banget atau dimulai angka (biasanya nomor rumah/RT/RW)
    if (pk.length <= 2 || /^\d/.test(pk)) continue;

    return toTitleCase(pk);
  }

  return kecName || 'Lainnya';
}

function toTitleCase(str) {
  return str.replace(/\w\S*/g, function(txt) {
    return txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase();
  });
}

function renderSummaryCharts() {
  // Destroy existing charts
  Object.values(_summaryCharts).forEach(function(c) { c.destroy(); });
  _summaryCharts = {};

  var palette = [
    '#4f46e5','#0891b2','#059669','#d97706','#dc2626','#7c3aed','#db2777','#2563eb',
    '#65a30d','#ea580c','#9333ea','#0284c7','#16a34a','#ca8a04','#e11d48'
  ];

  // ── 1. Chart by Category ──
  var catCount = {};
  suppliers.forEach(function(s) {
    (s.categories || []).forEach(function(c) {
      catCount[c] = (catCount[c] || 0) + 1;
    });
  });
  var catEntries = Object.entries(catCount).sort(function(a, b) { return b[1] - a[1]; });
  var catLabels = catEntries.map(function(e) { return e[0]; });
  var catData   = catEntries.map(function(e) { return e[1]; });
  var catColors = catEntries.map(function(_, i) { return palette[i % palette.length]; });

  _summaryCharts.category = new Chart($('chartCategory'), {
    type: 'doughnut',
    data: {
      labels: catLabels,
      datasets: [{ data: catData, backgroundColor: catColors, borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 11 }, color: '#4b5563' } }
      }
    }
  });

  // ── 2. Chart by Last Transaction Month-Year ──
  var monthNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  var monthYearData = [];
  suppliers.forEach(function(s) {
    if (!s.lastTransactionDate) return;
    var d = new Date(s.lastTransactionDate);
    var label = monthNames[d.getMonth()] + ' ' + d.getFullYear();
    var sortKey = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    var existing = monthYearData.find(function(x) { return x.label === label; });
    if (existing) { existing.count++; }
    else { monthYearData.push({ label: label, sortKey: sortKey, count: 1 }); }
  });
  monthYearData.sort(function(a, b) { return a.sortKey.localeCompare(b.sortKey); });
  var myLabels = monthYearData.map(function(e) { return e.label; });
  var myData   = monthYearData.map(function(e) { return e.count; });

  var now = new Date();
  var twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), 1);
  var oneYearAgo  = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  var myColors = monthYearData.map(function(e) {
    var parts = e.sortKey.split('-');
    var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
    if (d < twoYearsAgo) return '#ef4444';      // merah: > 2 tahun
    if (d < oneYearAgo)  return '#f59e0b';      // kuning: 1 - 2 tahun
    return '#10b981';                           // hijau: < 1 tahun
  });

  _summaryCharts.monthYear = new Chart($('chartStatus'), {
    type: 'bar',
    data: {
      labels: myLabels,
      datasets: [{
        data: myData,
        backgroundColor: myColors,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 }, color: '#6b7280' }, grid: { color: '#f3f4f6' } },
        x: { ticks: { font: { size: 10 }, color: '#6b7280', maxRotation: 45 }, grid: { display: false } }
      }
    }
  });

  // ── 3. Chart by Location (Top 10 cities) ──
  var locCount = {};
  suppliers.forEach(function(s) {
    var city = parseCityFromMaps(s.location) || parseCity(s.address);
    if (!city) return;
    locCount[city] = (locCount[city] || 0) + 1;
  });
  var locEntries = Object.entries(locCount).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 10);
  var locLabels  = locEntries.map(function(e) { return e[0]; });
  var locData    = locEntries.map(function(e) { return e[1]; });

  _summaryCharts.location = new Chart($('chartLocation'), {
    type: 'bar',
    data: {
      labels: locLabels,
      datasets: [{
        data: locData,
        backgroundColor: locEntries.map(function(_, i) { return palette[i % palette.length]; }),
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { ticks: { stepSize: 1, font: { size: 10 }, color: '#6b7280' }, grid: { color: '#f3f4f6' } },
        y: { ticks: { font: { size: 11 }, color: '#4b5563' }, grid: { display: false } }
      }
    }
  });

  // ── 4. Chart by Products (Top 10) ──
  var prodCount = {};
  suppliers.forEach(function(s) {
    (s.products || []).forEach(function(p) {
      var name = typeof p === 'string' ? p : p.name;
      if (name) prodCount[name] = (prodCount[name] || 0) + 1;
    });
  });
  var prodEntries = Object.entries(prodCount).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 10);
  var prodLabels  = prodEntries.map(function(e) { return e[0]; });
  var prodData    = prodEntries.map(function(e) { return e[1]; });

  _summaryCharts.products = new Chart($('chartProducts'), {
    type: 'bar',
    data: {
      labels: prodLabels,
      datasets: [{
        data: prodData,
        backgroundColor: prodEntries.map(function(_, i) { return palette[i % palette.length]; }),
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { ticks: { stepSize: 1, font: { size: 10 }, color: '#6b7280' }, grid: { color: '#f3f4f6' } },
        y: { ticks: { font: { size: 11 }, color: '#4b5563' }, grid: { display: false } }
      }
    }
  });
}

// ─── Audit Log ─────────────────────────────────────────────
async function openAuditLogModal(supplierId) {
  closeDetailModal();
  $('auditModal').classList.remove('hidden');
  $('auditModal').classList.add('flex');
  $('auditTableBody').innerHTML = '<tr><td colspan="4" class="px-3 py-4 text-center text-gray-400 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>Loading...</td></tr>';

  var { data, error } = await supabase.rpc('get_supplier_logs', { p_supplier_id: supplierId });
  if (error) {
    $('auditTableBody').innerHTML = '<tr><td colspan="4" class="px-3 py-4 text-center text-red-400 text-sm">Error: ' + escHtml(error.message) + '</td></tr>';
    return;
  }

  var actionIcon = { 'INSERT': '&#x2795;', 'UPDATE': '&#x270F;&#xFE0F;', 'DELETE': '&#x1F5D1;&#xFE0F;' };
  var actionColor = { 'INSERT': 'text-green-600', 'UPDATE': 'text-amber-600', 'DELETE': 'text-red-600' };

  $('auditTableBody').innerHTML = (data || []).map(function(log) {
    var changesHtml = '';
    if (log.action === 'UPDATE' && log.old_data && log.new_data) {
      var diff = getJsonDiff(log.old_data, log.new_data);
      changesHtml = '<button onclick="var el=this.nextElementSibling;el.classList.toggle(\'hidden\')" class="text-xs text-indigo-600 hover:underline">' + diff.length + ' change(s)</button>' +
        '<pre class="hidden mt-1 text-xs bg-gray-50 p-2 rounded max-h-32 overflow-auto whitespace-pre-wrap">' + escHtml(JSON.stringify(diff, null, 2)) + '</pre>';
    } else if (log.action === 'INSERT') {
      changesHtml = '<span class="text-xs text-gray-400">Record created</span>';
    } else {
      changesHtml = '<span class="text-xs text-gray-400">Record deleted</span>';
    }
    return '<tr class="border-b border-gray-100 table-row-hover">' +
      '<td class="px-3 py-2 text-xs text-gray-500">' + new Date(log.changed_at).toLocaleString('id-ID') + '</td>' +
      '<td class="px-3 py-2"><span class="' + (actionColor[log.action] || '') + ' font-medium text-sm">' + (actionIcon[log.action] || '') + ' ' + log.action + '</span></td>' +
      '<td class="px-3 py-2 text-sm">' + escHtml(log.username || 'System') + '</td>' +
      '<td class="px-3 py-2">' + changesHtml + '</td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="4" class="px-3 py-4 text-center text-gray-400 text-sm">No audit records found.</td></tr>';
}

function getJsonDiff(oldData, newData) {
  var changes = [];
  var keys = Object.keys(Object.assign({}, oldData, newData));
  keys.forEach(function(k) {
    if (k === 'updated_at' || k === 'updated_by') return;
    var ov = JSON.stringify(oldData[k]), nv = JSON.stringify(newData[k]);
    if (ov !== nv) changes.push({ field: k, old: oldData[k], new: newData[k] });
  });
  return changes;
}

function closeAuditModal() {
  $('auditModal').classList.add('hidden');
  $('auditModal').classList.remove('flex');
}

// ─── Init ───────────────────────────────────────────────
async function init() {
  initTheme();
  hideLoading();
  await initSupabase();
  if (!supabase) return;
  try {
    var isLoggedIn = await checkSession();
    if (!isLoggedIn) hideLoading();
  } catch (e) {
    hideLoading();
    $('loginPage').classList.remove('hidden');
    $('loginPage').classList.add('active');
    $('loginError').textContent = 'Initialization error: ' + e.message;
    $('loginError').classList.remove('hidden');
  }
}

// Tambahkan realtime setup setelah onLoginSuccess
var _origOnLoginSuccess = onLoginSuccess;
onLoginSuccess = async function() {
  await _origOnLoginSuccess();
  setupRealtime();
};

// Teardown realtime saat logout
var _origHandleLogout = handleLogout;
handleLogout = async function() {
  teardownRealtime();
  await _origHandleLogout();
};

init();
