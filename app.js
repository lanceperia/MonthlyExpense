// Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSyAie1-uoDBkjhL-uJn1ZSQPBpNGBz5rUQc",
    authDomain: "tradingjournal-42927.firebaseapp.com",
    projectId: "tradingjournal-42927",
    storageBucket: "tradingjournal-42927.firebasestorage.app",
    messagingSenderId: "825476972330",
    appId: "1:825476972330:web:b2fd27f195c95ba940a853",
    measurementId: "G-2M17JDFQHJ"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let purchases = [];
let categories = [];
let banks = [];
let settings = { defaultBudget: 0, monthOverrides: {} };
let recurringTemplates = [];
let recurringLog = [];
let bankMonthlyData = {};
let pieChart = null;
let sortColumn = 'total';
let sortDirection = 'desc';

const DEFAULT_CATEGORIES = ['Medicine', 'Online Shop', 'Food Delivery', 'Gas', 'Toll', 'Dine In', 'Haircut', 'Grocery', 'Insurance', 'Entertainment', 'PMS', 'Payment', 'Others'];
const DEFAULT_BANKS = [
    { name: 'BPI', soaDate: 15 },
    { name: 'BDO', soaDate: 9 },
    { name: 'RCBC', soaDate: 9 },
    { name: 'UB', soaDate: 9 },
    { name: 'Cash', soaDate: 0 }
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Auth
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        loadData();
    } else {
        currentUser = null;
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('app').classList.add('hidden');
    }
});

function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider);
}

function signOut() {
    auth.signOut();
}

// Firestore helpers
function userDoc(collection) {
    return db.collection('users').doc(currentUser.uid).collection(collection);
}

async function loadData() {
    await Promise.all([loadCategories(), loadBanks(), loadSettings(), loadPurchases(), loadRecurring(), loadRecurringLog(), loadBankMonthly()]);
    updateRecurringTabVisibility();
    if (settings.recurringEnabled) {
        await generateRecurringPurchases();
    }
    // Check if all banks are paid for current month — if so, advance to next month
    autoAdvanceIfAllPaid();
    renderMonthly();
}

function autoAdvanceIfAllPaid() {
    const billableBanks = banks.filter(b => b.soaDate && b.soaDate > 0);
    if (billableBanks.length === 0) return;

    const allPaid = billableBanks.every(bank => {
        const key = getBankMonthlyKey(bank.name, currentMonth, currentYear);
        const data = bankMonthlyData[key] || {};
        return data.paid === true;
    });

    if (allPaid) {
        currentMonth += 1;
        if (currentMonth > 11) {
            currentMonth = 0;
            currentYear += 1;
        }
    }
}

async function loadCategories() {
    const snap = await userDoc('categories').orderBy('name').get();
    if (snap.empty) {
        for (const cat of DEFAULT_CATEGORIES) {
            await userDoc('categories').add({ name: cat });
        }
        categories = [...DEFAULT_CATEGORIES];
    } else {
        categories = snap.docs.map(d => d.data().name);
    }
    categories.sort((a, b) => {
        if (a === 'Others') return 1;
        if (b === 'Others') return -1;
        return a.localeCompare(b);
    });
}

async function loadBanks() {
    const snap = await userDoc('banks').orderBy('name').get();
    if (snap.empty) {
        for (const bank of DEFAULT_BANKS) {
            await userDoc('banks').add(bank);
        }
        banks = [...DEFAULT_BANKS];
    } else {
        banks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
}

async function loadSettings() {
    const doc = await db.collection('users').doc(currentUser.uid).get();
    if (doc.exists && doc.data().settings) {
        settings = doc.data().settings;
    }
}

async function loadPurchases() {
    const snap = await userDoc('purchases').get();
    purchases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadRecurring() {
    const snap = await userDoc('recurring').get();
    recurringTemplates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadRecurringLog() {
    const snap = await userDoc('recurringLog').get();
    recurringLog = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadBankMonthly() {
    const snap = await userDoc('bankMonthly').get();
    bankMonthlyData = {};
    snap.docs.forEach(d => { bankMonthlyData[d.id] = d.data(); });
}

function getBankMonthlyKey(bankName, month, year) {
    return `${bankName}-${year}-${String(month).padStart(2, '0')}`;
}

async function saveBankMonthlyField(bankName, month, year, field, value) {
    const key = getBankMonthlyKey(bankName, month, year);
    if (!bankMonthlyData[key]) bankMonthlyData[key] = {};
    bankMonthlyData[key][field] = value;
    await userDoc('bankMonthly').doc(key).set(bankMonthlyData[key], { merge: true });
}

let bsSortColumn = 'bank';
let bsSortDirection = 'asc';

function sortBankSummary(column) {
    if (bsSortColumn === column) {
        bsSortDirection = bsSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        bsSortColumn = column;
        bsSortDirection = column === 'total' || column === 'soa' ? 'desc' : 'asc';
    }
    updateBsSortIcons();
    renderMonthly();
}

function updateBsSortIcons() {
    ['bank', 'total', 'soa', 'paid'].forEach(col => {
        const el = document.getElementById(`sort-icon-bs-${col}`);
        if (col === bsSortColumn) {
            el.textContent = bsSortDirection === 'asc' ? '▲' : '▼';
        } else {
            el.textContent = '';
        }
    });
}

function renderBankSummary(monthPurchases) {
    const container = document.getElementById('bank-summary-container');
    const tbody = document.getElementById('bank-summary-body');
    const billableBanks = banks.filter(b => b.soaDate && b.soaDate > 0);

    if (billableBanks.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    const bankTotals = {};
    monthPurchases.forEach(p => {
        if (p.category === 'Payment') return;
        bankTotals[p.bank] = (bankTotals[p.bank] || 0) + parseFloat(p.amount);
    });

    const editIcon = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>`;

    const sortedBanks = [...billableBanks].sort((a, b) => {
        const keyA = getBankMonthlyKey(a.name, currentMonth, currentYear);
        const keyB = getBankMonthlyKey(b.name, currentMonth, currentYear);
        const dataA = bankMonthlyData[keyA] || {};
        const dataB = bankMonthlyData[keyB] || {};
        const totalA = bankTotals[a.name] || 0;
        const totalB = bankTotals[b.name] || 0;
        let cmp = 0;
        if (bsSortColumn === 'bank') cmp = a.name.localeCompare(b.name);
        else if (bsSortColumn === 'total') cmp = totalA - totalB;
        else if (bsSortColumn === 'soa') cmp = (dataA.soaAmount || 0) - (dataB.soaAmount || 0);
        else if (bsSortColumn === 'paid') cmp = (dataA.paid ? 1 : 0) - (dataB.paid ? 1 : 0);
        return bsSortDirection === 'asc' ? cmp : -cmp;
    });

    // Calculate totals for footer
    let grandTotal = 0;
    let grandSoa = 0;
    let allHaveSoa = true;

    sortedBanks.forEach(bank => {
        const key = getBankMonthlyKey(bank.name, currentMonth, currentYear);
        const data = bankMonthlyData[key] || {};
        grandTotal += (bankTotals[bank.name] || 0);
        if (data.soaAmount != null) {
            grandSoa += data.soaAmount;
        } else {
            allHaveSoa = false;
        }
    });

    let rowsHtml = sortedBanks.map(bank => {
        const key = getBankMonthlyKey(bank.name, currentMonth, currentYear);
        const data = bankMonthlyData[key] || {};
        const total = bankTotals[bank.name] || 0;
        const paid = data.paid || false;
        const soaAmount = data.soaAmount != null ? `₱${formatNumber(data.soaAmount)}` : '—';
        const paidLabel = paid ? '<span class="text-green-400">Yes</span>' : '<span class="text-gray-500">No</span>';

        return `<tr class="border-b border-gray-700/30 whitespace-nowrap">
            <td class="px-4 py-3 text-sm font-medium">${bank.name}</td>
            <td class="px-4 py-3 text-sm font-semibold">₱${formatNumber(total)}</td>
            <td class="px-4 py-3 text-sm">${soaAmount}</td>
            <td class="px-4 py-3 text-sm">${paidLabel}</td>
            <td class="px-4 py-3 w-10">
                <button onclick="openSoaModal('${bank.name}')" class="text-accent hover:text-accent-light p-1">${editIcon}</button>
            </td>
        </tr>`;
    }).join('');

    // Add total footer row
    const soaDisplay = allHaveSoa ? `₱${formatNumber(grandSoa)}` : `₱${formatNumber(grandSoa)}*`;
    rowsHtml += `<tr class="border-t border-gray-600 whitespace-nowrap bg-dark-800/50">
        <td class="px-4 py-3 text-sm font-bold text-gray-300">Total</td>
        <td class="px-4 py-3 text-sm font-bold">₱${formatNumber(grandTotal)}</td>
        <td class="px-4 py-3 text-sm font-bold">${soaDisplay}</td>
        <td class="px-4 py-3 text-sm"></td>
        <td class="px-4 py-3"></td>
    </tr>`;

    tbody.innerHTML = rowsHtml;

    updateBsSortIcons();
}

function openSoaModal(bankName) {
    document.getElementById('soa-bank-name').value = bankName;
    document.getElementById('soa-bank-label').textContent = `${bankName} — ${MONTH_NAMES[currentMonth]} ${currentYear}`;
    const key = getBankMonthlyKey(bankName, currentMonth, currentYear);
    const data = bankMonthlyData[key] || {};
    document.getElementById('soa-amount-input').value = data.soaAmount != null ? data.soaAmount : '';
    document.getElementById('soa-paid-input').checked = data.paid || false;
    openModal('modal-soa');
}

async function saveSoaAmount() {
    const bankName = document.getElementById('soa-bank-name').value;
    const val = document.getElementById('soa-amount-input').value;
    const amount = val ? parseFloat(val) : null;
    const paid = document.getElementById('soa-paid-input').checked;
    const key = getBankMonthlyKey(bankName, currentMonth, currentYear);
    if (!bankMonthlyData[key]) bankMonthlyData[key] = {};
    bankMonthlyData[key].soaAmount = amount;
    bankMonthlyData[key].paid = paid;
    await userDoc('bankMonthly').doc(key).set(bankMonthlyData[key], { merge: true });
    closeModal('modal-soa');
    renderMonthly();
}

async function generateRecurringPurchases() {
    const today = new Date();
    for (const template of recurringTemplates) {
        if (!template.active) continue;

        const billingMonth = getBillingMonthForRecurring(template);
        const billingKey = `${billingMonth.year}-${String(billingMonth.month).padStart(2, '0')}`;

        if (template.endDate && billingKey > template.endDate) continue;

        const alreadyGenerated = recurringLog.some(
            log => log.recurringId === template.id && log.billingMonth === billingKey
        );
        if (alreadyGenerated) continue;

        const purchaseDate = buildPurchaseDate(template.dayOfMonth, today);
        const purchaseData = {
            bank: template.bank,
            category: template.category,
            date: purchaseDate,
            amount: template.amount,
            othersText: ''
        };

        const ref = await userDoc('purchases').add(purchaseData);
        purchases.push({ id: ref.id, ...purchaseData });

        const logData = { recurringId: template.id, billingMonth: billingKey };
        const logRef = await userDoc('recurringLog').add(logData);
        recurringLog.push({ id: logRef.id, ...logData });
    }
}

function getBillingMonthForRecurring(template) {
    const today = new Date();
    const day = template.dayOfMonth;
    const month = today.getMonth();
    const year = today.getFullYear();
    const bank = banks.find(b => b.name === template.bank);
    const soaDate = bank ? bank.soaDate : 0;

    if (!soaDate) return { month, year };

    if (day >= soaDate) {
        if (month === 11) return { month: 0, year: year + 1 };
        return { month: month + 1, year: year };
    }
    return { month, year };
}

function buildPurchaseDate(dayOfMonth, refDate) {
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const day = Math.min(dayOfMonth, lastDay);
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// SOA Logic: determine billing month for a purchase
function getBillingMonth(purchaseDate, bankName) {
    const date = new Date(purchaseDate);
    const day = date.getDate();
    const month = date.getMonth();
    const year = date.getFullYear();
    const bank = banks.find(b => b.name === bankName);
    const soaDate = bank ? bank.soaDate : 0;

    if (!soaDate) return { month, year };

    if (day >= soaDate) {
        if (month === 11) return { month: 0, year: year + 1 };
        return { month: month + 1, year: year };
    }
    return { month, year };
}

// Get purchases for a billing month
function getPurchasesForMonth(month, year) {
    return purchases.filter(p => {
        const billing = getBillingMonth(p.date, p.bank);
        return billing.month === month && billing.year === year;
    });
}

// Render Monthly View
function renderMonthly() {
    document.getElementById('current-month-label').textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;

    const monthPurchases = getPurchasesForMonth(currentMonth, currentYear);
    const totalSpent = monthPurchases.reduce((sum, p) => sum + parseFloat(p.amount), 0);

    const monthKey = `${currentYear}-${currentMonth}`;
    const budget = settings.monthOverrides && settings.monthOverrides[monthKey] != null
        ? settings.monthOverrides[monthKey]
        : (settings.defaultBudget || 0);

    document.getElementById('budget-amount').textContent = `₱${formatNumber(budget)}`;
    document.getElementById('spent-amount').textContent = `₱${formatNumber(totalSpent)}`;

    const remaining = budget - totalSpent;
    const remainingEl = document.getElementById('remaining-amount');
    if (remaining >= 0) {
        remainingEl.textContent = `₱${formatNumber(remaining)}`;
        remainingEl.className = 'font-semibold text-green-400';
        document.querySelector('#remaining-display .text-gray-400').textContent = 'Remaining:';
    } else {
        remainingEl.textContent = `₱${formatNumber(Math.abs(remaining))}`;
        remainingEl.className = 'font-semibold text-red-400';
        document.querySelector('#remaining-display .text-gray-400').textContent = 'Overspent:';
    }

    renderBankSummary(monthPurchases);

    // Group by bank then category
    const grouped = {};
    monthPurchases.forEach(p => {
        const groupCategory = p.category === 'Others' ? (p.othersText || 'Others') : p.category;
        const key = `${p.bank}|||${groupCategory}`;
        if (!grouped[key]) grouped[key] = { bank: p.bank, category: groupCategory, total: 0, items: [] };
        grouped[key].total += parseFloat(p.amount);
        grouped[key].items.push(p);
    });

    const sorted = Object.values(grouped).sort((a, b) => {
        let cmp = 0;
        if (sortColumn === 'total') cmp = a.total - b.total;
        else if (sortColumn === 'bank') cmp = a.bank.localeCompare(b.bank);
        else if (sortColumn === 'category') cmp = a.category.localeCompare(b.category);
        return sortDirection === 'asc' ? cmp : -cmp;
    });

    const tbody = document.getElementById('monthly-table-body');
    const emptyMsg = document.getElementById('monthly-empty');

    if (sorted.length === 0) {
        tbody.innerHTML = '';
        emptyMsg.classList.remove('hidden');
        return;
    }

    emptyMsg.classList.add('hidden');
    let html = '';

    const editIcon = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>`;
    const delIcon = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>`;

    sorted.forEach((group, idx) => {
        const categoryLabel = group.category;
        const isPayment = group.items[0].category === 'Payment';
        const amountDisplay = isPayment ? `<span class="text-red-400">₱${formatNumber(group.total)}</span>` : `₱${formatNumber(group.total)}`;

        const hasMultiple = group.items.length > 1;
        html += `<tr class="${hasMultiple ? 'expandable-row' : ''} border-b border-gray-700/30 whitespace-nowrap" ${hasMultiple ? `onclick="toggleExpand(${idx})"` : ''}>
            <td class="px-4 py-3 text-sm font-medium">${group.bank}</td>
            <td class="px-4 py-3 text-sm">${categoryLabel}</td>
            <td class="px-4 py-3 text-sm font-semibold">${amountDisplay}</td>
            <td class="px-4 py-3 w-10">
                ${!hasMultiple ? `
                    <div class="flex items-center justify-end gap-1">
                        <button onclick="event.stopPropagation(); editPurchase('${group.items[0].id}')" class="text-accent hover:text-accent-light p-1">${editIcon}</button>
                        <button onclick="event.stopPropagation(); deletePurchase('${group.items[0].id}')" class="text-red-400 hover:text-red-300 p-1">${delIcon}</button>
                    </div>
                ` : `<svg class="w-4 h-4 text-gray-500 transition-transform expand-icon-${idx}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>`}
            </td>
        </tr>`;
        if (hasMultiple) {
            html += group.items.sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount)).map(item => {
                const itemIsPayment = item.category === 'Payment';
                const itemAmount = itemIsPayment ? `<span class="text-red-400">(₱${formatNumber(parseFloat(item.amount))})</span>` : `₱${formatNumber(parseFloat(item.amount))}`;
                return `
                <tr class="transaction-details details-${idx} bg-dark-800/50 border-b border-gray-700/20 text-sm">
                    <td class="px-4 py-2 pl-8 text-gray-400">${formatDate(item.date)}</td>
                    <td class="px-4 py-2 text-gray-400">${item.others || item.category}</td>
                    <td class="px-4 py-2 font-medium">${itemAmount}</td>
                    <td class="px-4 py-2">
                        <div class="flex items-center gap-1">
                            <button onclick="event.stopPropagation(); editPurchase('${item.id}')" class="text-accent hover:text-accent-light p-1">${editIcon}</button>
                            <button onclick="event.stopPropagation(); deletePurchase('${item.id}')" class="text-red-400 hover:text-red-300 p-1">${delIcon}</button>
                        </div>
                    </td>
                </tr>`;
            }).join('');
        }
    });

    tbody.innerHTML = html;
}

function toggleExpand(idx) {
    const rows = document.querySelectorAll(`.details-${idx}`);
    const isOpen = rows[0]?.classList.contains('open');
    rows.forEach(r => r.classList.toggle('open', !isOpen));
    const icon = document.querySelector(`.expand-icon-${idx}`);
    if (icon) icon.style.transform = !isOpen ? 'rotate(180deg)' : '';
}

function sortTable(column) {
    if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = column;
        sortDirection = column === 'total' ? 'desc' : 'asc';
    }
    updateSortIcons();
    renderMonthly();
}

function updateSortIcons() {
    ['bank', 'category', 'total'].forEach(col => {
        const el = document.getElementById(`sort-icon-${col}`);
        if (col === sortColumn) {
            el.textContent = sortDirection === 'asc' ? '▲' : '▼';
        } else {
            el.textContent = '';
        }
    });
}

// Render Summary View
function renderSummary() {
    const year = parseInt(document.getElementById('summary-year').value);
    const yearPurchases = purchases.filter(p => {
        if (p.category === 'Payment') return false;
        const billing = getBillingMonth(p.date, p.bank);
        return billing.year === year;
    });

    // Pie chart by category
    const catTotals = {};
    yearPurchases.forEach(p => {
        const cat = p.category === 'Others' ? (p.othersText || 'Others') : p.category;
        catTotals[cat] = (catTotals[cat] || 0) + parseFloat(p.amount);
    });

    const catLabels = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);
    const catData = catLabels.map(c => catTotals[c]);
    const colors = generateColors(catLabels.length);

    if (pieChart) pieChart.destroy();
    const ctx = document.getElementById('pie-chart').getContext('2d');
    pieChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: catLabels,
            datasets: [{ data: catData, backgroundColor: colors, borderWidth: 0 }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#9ca3af', padding: 12 } },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.label}: ₱${formatNumber(ctx.raw)}`
                    }
                }
            }
        }
    });

    // Bank totals table
    const bankTotals = {};
    yearPurchases.forEach(p => { bankTotals[p.bank] = (bankTotals[p.bank] || 0) + parseFloat(p.amount); });
    const bankSorted = Object.entries(bankTotals).sort((a, b) => b[1] - a[1]);
    document.getElementById('summary-bank-table').innerHTML = bankSorted.map(([bank, total]) =>
        `<tr class="border-b border-gray-700/30"><td class="py-2">${bank}</td><td class="py-2 text-right font-semibold">₱${formatNumber(total)}</td></tr>`
    ).join('') || '<tr><td colspan="2" class="py-4 text-center text-gray-500">No data</td></tr>';

    // Category totals table
    document.getElementById('summary-category-table').innerHTML = catLabels.map(cat =>
        `<tr class="border-b border-gray-700/30"><td class="py-2">${cat}</td><td class="py-2 text-right font-semibold">₱${formatNumber(catTotals[cat])}</td></tr>`
    ).join('') || '<tr><td colspan="2" class="py-4 text-center text-gray-500">No data</td></tr>';
}

function populateYearDropdown() {
    const years = new Set();
    purchases.forEach(p => {
        const billing = getBillingMonth(p.date, p.bank);
        years.add(billing.year);
    });
    years.add(currentYear);
    const sorted = [...years].sort((a, b) => b - a);
    const select = document.getElementById('summary-year');
    select.innerHTML = sorted.map(y => `<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}</option>`).join('');
}

function updateRecurringTabVisibility() {
    const tabBtn = document.getElementById('tab-recurring');
    if (settings.recurringEnabled) {
        tabBtn.classList.remove('hidden');
    } else {
        tabBtn.classList.add('hidden');
        if (!document.getElementById('view-recurring').classList.contains('hidden')) {
            switchTab('monthly');
        }
    }
}

// Tab switching
function switchTab(tab) {
    document.getElementById('view-monthly').classList.toggle('hidden', tab !== 'monthly');
    document.getElementById('view-summary').classList.toggle('hidden', tab !== 'summary');
    document.getElementById('view-recurring').classList.toggle('hidden', tab !== 'recurring');
    document.getElementById('tab-monthly').classList.toggle('border-accent', tab === 'monthly');
    document.getElementById('tab-monthly').classList.toggle('text-accent', tab === 'monthly');
    document.getElementById('tab-monthly').classList.toggle('border-transparent', tab !== 'monthly');
    document.getElementById('tab-monthly').classList.toggle('text-gray-400', tab !== 'monthly');
    document.getElementById('tab-summary').classList.toggle('border-accent', tab === 'summary');
    document.getElementById('tab-summary').classList.toggle('text-accent', tab === 'summary');
    document.getElementById('tab-summary').classList.toggle('border-transparent', tab !== 'summary');
    document.getElementById('tab-summary').classList.toggle('text-gray-400', tab !== 'summary');
    document.getElementById('tab-recurring').classList.toggle('border-accent', tab === 'recurring');
    document.getElementById('tab-recurring').classList.toggle('text-accent', tab === 'recurring');
    document.getElementById('tab-recurring').classList.toggle('border-transparent', tab !== 'recurring');
    document.getElementById('tab-recurring').classList.toggle('text-gray-400', tab !== 'recurring');

    if (tab === 'summary') {
        populateYearDropdown();
        renderSummary();
    }
    if (tab === 'recurring') {
        renderRecurring();
    }
}

// Month navigation
function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderMonthly();
}

function goToToday() {
    currentMonth = new Date().getMonth();
    currentYear = new Date().getFullYear();
    renderMonthly();
}

// Add Purchase Modal
function openAddPurchase() {
    document.getElementById('modal-purchase-title').textContent = 'Add Purchase';
    document.getElementById('purchase-id').value = '';
    document.getElementById('purchase-form').reset();
    document.getElementById('purchase-date').value = new Date().toISOString().split('T')[0];
    populatePurchaseDropdowns();
    document.getElementById('others-input-wrapper').classList.add('hidden');
    openModal('modal-purchase');
}

function populatePurchaseDropdowns() {
    const bankSelect = document.getElementById('purchase-bank');
    const catSelect = document.getElementById('purchase-category');
    const bankList = Array.isArray(banks[0]) ? banks : banks.map(b => typeof b === 'string' ? b : b.name);
    bankSelect.innerHTML = bankList.map(b => `<option value="${typeof b === 'object' ? b.name : b}">${typeof b === 'object' ? b.name : b}</option>`).join('');
    const sortedCats = categories.filter(c => c !== 'Others').concat(['Others']);
    catSelect.innerHTML = sortedCats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function toggleOthersInput() {
    const val = document.getElementById('purchase-category').value;
    document.getElementById('others-input-wrapper').classList.toggle('hidden', val !== 'Others');
    if (val === 'Others') document.getElementById('purchase-others').required = true;
    else document.getElementById('purchase-others').required = false;
}

async function savePurchase(e) {
    e.preventDefault();
    const id = document.getElementById('purchase-id').value;
    const data = {
        bank: document.getElementById('purchase-bank').value,
        category: document.getElementById('purchase-category').value,
        date: document.getElementById('purchase-date').value,
        amount: parseFloat(document.getElementById('purchase-amount').value),
        othersText: document.getElementById('purchase-category').value === 'Others' ? document.getElementById('purchase-others').value : ''
    };

    if (id) {
        await userDoc('purchases').doc(id).update(data);
        const idx = purchases.findIndex(p => p.id === id);
        if (idx !== -1) purchases[idx] = { id, ...data };
    } else {
        const ref = await userDoc('purchases').add(data);
        purchases.push({ id: ref.id, ...data });
    }

    closeModal('modal-purchase');
    renderMonthly();
}

function editPurchase(id) {
    const purchase = purchases.find(p => p.id === id);
    if (!purchase) return;
    document.getElementById('modal-purchase-title').textContent = 'Edit Purchase';
    document.getElementById('purchase-id').value = id;
    populatePurchaseDropdowns();
    document.getElementById('purchase-bank').value = purchase.bank;
    document.getElementById('purchase-category').value = purchase.category;
    document.getElementById('purchase-date').value = purchase.date;
    document.getElementById('purchase-amount').value = purchase.amount;
    if (purchase.category === 'Others') {
        document.getElementById('others-input-wrapper').classList.remove('hidden');
        document.getElementById('purchase-others').value = purchase.othersText || '';
    } else {
        document.getElementById('others-input-wrapper').classList.add('hidden');
    }
    openModal('modal-purchase');
}

function deletePurchase(id) {
    document.getElementById('delete-purchase-id').value = id;
    openModal('modal-delete');
}

async function confirmDelete() {
    const id = document.getElementById('delete-purchase-id').value;
    await userDoc('purchases').doc(id).delete();
    purchases = purchases.filter(p => p.id !== id);
    closeModal('modal-delete');
    renderMonthly();
}

// Settings
function openSettings() {
    document.getElementById('settings-recurring-enabled').checked = settings.recurringEnabled || false;
    document.getElementById('settings-default-budget').value = settings.defaultBudget || '';
    const monthKey = `${currentYear}-${currentMonth}`;
    document.getElementById('settings-override-month-label').textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;
    document.getElementById('settings-month-override').value = settings.monthOverrides && settings.monthOverrides[monthKey] != null ? settings.monthOverrides[monthKey] : '';

    // Render categories
    const catList = document.getElementById('categories-list');
    catList.innerHTML = categories.filter(c => c !== 'Others').map(c =>
        `<div class="flex items-center justify-between bg-dark-800 rounded-lg px-3 py-2">
            <span class="text-sm">${c}</span>
            <button onclick="removeCategory('${c}')" class="text-red-400 hover:text-red-300 text-xs">Remove</button>
        </div>`
    ).join('');

    // Render banks
    const bankList = document.getElementById('banks-list');
    bankList.innerHTML = banks.map(b => {
        const name = typeof b === 'string' ? b : b.name;
        const soa = typeof b === 'object' ? b.soaDate : 1;
        return `<div class="flex items-center justify-between bg-dark-800 rounded-lg px-3 py-2">
            <span class="text-sm">${name} <span class="text-gray-500">(SOA: ${soa})</span></span>
            <button onclick="removeBank('${name}')" class="text-red-400 hover:text-red-300 text-xs">Remove</button>
        </div>`;
    }).join('');

    openModal('modal-settings');
}

async function saveSettings() {
    const defaultBudget = parseFloat(document.getElementById('settings-default-budget').value) || 0;
    const recurringEnabled = document.getElementById('settings-recurring-enabled').checked;
    const monthKey = `${currentYear}-${currentMonth}`;
    const overrideVal = document.getElementById('settings-month-override').value;

    settings.defaultBudget = defaultBudget;
    settings.recurringEnabled = recurringEnabled;
    if (!settings.monthOverrides) settings.monthOverrides = {};
    if (overrideVal !== '') {
        settings.monthOverrides[monthKey] = parseFloat(overrideVal);
    } else {
        delete settings.monthOverrides[monthKey];
    }

    await db.collection('users').doc(currentUser.uid).set({ settings }, { merge: true });
    closeModal('modal-settings');
    updateRecurringTabVisibility();
    renderMonthly();
}

async function addCategory() {
    const input = document.getElementById('new-category-input');
    const name = input.value.trim();
    if (!name || categories.includes(name)) return;
    await userDoc('categories').add({ name });
    categories.push(name);
    categories.sort((a, b) => {
        if (a === 'Others') return 1;
        if (b === 'Others') return -1;
        return a.localeCompare(b);
    });
    input.value = '';
    openSettings();
}

async function removeCategory(name) {
    const snap = await userDoc('categories').where('name', '==', name).get();
    snap.forEach(doc => doc.ref.delete());
    categories = categories.filter(c => c !== name);
    openSettings();
}

async function addBank() {
    const nameInput = document.getElementById('new-bank-name');
    const soaInput = document.getElementById('new-bank-soa');
    const name = nameInput.value.trim();
    const soa = soaInput.value !== '' ? parseInt(soaInput.value) : 0;
    if (!name || banks.find(b => (typeof b === 'object' ? b.name : b) === name)) return;
    const ref = await userDoc('banks').add({ name, soaDate: soa });
    banks.push({ id: ref.id, name, soaDate: soa });
    banks.sort((a, b) => a.name.localeCompare(b.name));
    nameInput.value = '';
    soaInput.value = '';
    openSettings();
}

async function removeBank(name) {
    const snap = await userDoc('banks').where('name', '==', name).get();
    snap.forEach(doc => doc.ref.delete());
    banks = banks.filter(b => (typeof b === 'object' ? b.name : b) !== name);
    openSettings();
}

// Recurring Templates
function openAddRecurring() {
    document.getElementById('modal-recurring-title').textContent = 'Add Recurring Expense';
    document.getElementById('recurring-id').value = '';
    document.getElementById('recurring-form').reset();
    document.getElementById('recurring-active').checked = true;
    populateRecurringDropdowns();
    openModal('modal-recurring');
}

function editRecurring(id) {
    const template = recurringTemplates.find(t => t.id === id);
    if (!template) return;
    document.getElementById('modal-recurring-title').textContent = 'Edit Recurring Expense';
    document.getElementById('recurring-id').value = id;
    populateRecurringDropdowns();
    document.getElementById('recurring-bank').value = template.bank;
    document.getElementById('recurring-category').value = template.category;
    document.getElementById('recurring-amount').value = template.amount;
    document.getElementById('recurring-day').value = template.dayOfMonth;
    document.getElementById('recurring-end-date').value = template.endDate || '';
    document.getElementById('recurring-active').checked = template.active;
    openModal('modal-recurring');
}

function populateRecurringDropdowns() {
    const bankSelect = document.getElementById('recurring-bank');
    const catSelect = document.getElementById('recurring-category');
    bankSelect.innerHTML = banks.map(b => `<option value="${b.name}">${b.name}</option>`).join('');
    catSelect.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
}

async function saveRecurringTemplate(e) {
    e.preventDefault();
    const id = document.getElementById('recurring-id').value;
    const endDateVal = document.getElementById('recurring-end-date').value;
    const data = {
        bank: document.getElementById('recurring-bank').value,
        category: document.getElementById('recurring-category').value,
        amount: parseFloat(document.getElementById('recurring-amount').value),
        dayOfMonth: parseInt(document.getElementById('recurring-day').value),
        active: document.getElementById('recurring-active').checked,
        endDate: endDateVal || null
    };

    if (id) {
        await userDoc('recurring').doc(id).update(data);
        const idx = recurringTemplates.findIndex(t => t.id === id);
        if (idx !== -1) recurringTemplates[idx] = { id, ...data };
    } else {
        const ref = await userDoc('recurring').add(data);
        const newTemplate = { id: ref.id, ...data };
        recurringTemplates.push(newTemplate);
        if (data.active) {
            await generateForTemplate(newTemplate);
        }
    }

    closeModal('modal-recurring');
    renderRecurring();
}

async function generateForTemplate(template) {
    const billingMonth = getBillingMonthForRecurring(template);
    const billingKey = `${billingMonth.year}-${String(billingMonth.month).padStart(2, '0')}`;

    if (template.endDate && billingKey > template.endDate) return;

    const alreadyGenerated = recurringLog.some(
        log => log.recurringId === template.id && log.billingMonth === billingKey
    );
    if (alreadyGenerated) return;

    const purchaseDate = buildPurchaseDate(template.dayOfMonth, new Date());
    const purchaseData = {
        bank: template.bank,
        category: template.category,
        date: purchaseDate,
        amount: template.amount,
        othersText: ''
    };

    const ref = await userDoc('purchases').add(purchaseData);
    purchases.push({ id: ref.id, ...purchaseData });

    const logData = { recurringId: template.id, billingMonth: billingKey };
    const logRef = await userDoc('recurringLog').add(logData);
    recurringLog.push({ id: logRef.id, ...logData });
}

function deleteRecurring(id) {
    document.getElementById('delete-recurring-id').value = id;
    openModal('modal-delete-recurring');
}

async function confirmDeleteRecurring() {
    const id = document.getElementById('delete-recurring-id').value;
    await userDoc('recurring').doc(id).delete();
    recurringTemplates = recurringTemplates.filter(t => t.id !== id);
    closeModal('modal-delete-recurring');
    renderRecurring();
}

async function toggleRecurringActive(id) {
    const template = recurringTemplates.find(t => t.id === id);
    if (!template) return;
    template.active = !template.active;
    await userDoc('recurring').doc(id).update({ active: template.active });
    renderRecurring();
}

let recurringSortColumn = 'bank';
let recurringSortDirection = 'asc';

function sortRecurringTable(column) {
    if (recurringSortColumn === column) {
        recurringSortDirection = recurringSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        recurringSortColumn = column;
        recurringSortDirection = column === 'amount' ? 'desc' : 'asc';
    }
    updateRecurringSortIcons();
    renderRecurring();
}

function updateRecurringSortIcons() {
    ['bank', 'category', 'amount', 'day', 'endDate', 'active'].forEach(col => {
        const el = document.getElementById(`sort-icon-r-${col}`);
        if (col === recurringSortColumn) {
            el.textContent = recurringSortDirection === 'asc' ? '▲' : '▼';
        } else {
            el.textContent = '';
        }
    });
}

function renderRecurring() {
    const tbody = document.getElementById('recurring-table-body');
    const emptyMsg = document.getElementById('recurring-empty');

    if (recurringTemplates.length === 0) {
        tbody.innerHTML = '';
        emptyMsg.classList.remove('hidden');
        return;
    }

    emptyMsg.classList.add('hidden');

    const sorted = [...recurringTemplates].sort((a, b) => {
        let cmp = 0;
        if (recurringSortColumn === 'bank') cmp = a.bank.localeCompare(b.bank);
        else if (recurringSortColumn === 'category') cmp = a.category.localeCompare(b.category);
        else if (recurringSortColumn === 'amount') cmp = a.amount - b.amount;
        else if (recurringSortColumn === 'day') cmp = a.dayOfMonth - b.dayOfMonth;
        else if (recurringSortColumn === 'endDate') cmp = (a.endDate || '9999-99').localeCompare(b.endDate || '9999-99');
        else if (recurringSortColumn === 'active') cmp = (a.active === b.active) ? 0 : a.active ? -1 : 1;
        return recurringSortDirection === 'asc' ? cmp : -cmp;
    });

    const editIcon = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>`;
    const delIcon = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>`;

    tbody.innerHTML = sorted.map(t => `
        <tr class="border-b border-gray-700/30 whitespace-nowrap">
            <td class="px-4 py-3 text-sm font-medium">${t.bank}</td>
            <td class="px-4 py-3 text-sm">${t.category}</td>
            <td class="px-4 py-3 text-sm font-semibold">₱${formatNumber(t.amount)}</td>
            <td class="px-4 py-3 text-sm">${t.dayOfMonth}</td>
            <td class="px-4 py-3 text-sm">${t.endDate || '—'}</td>
            <td class="px-4 py-3">
                <button onclick="toggleRecurringActive('${t.id}')" class="text-sm ${t.active ? 'text-green-400' : 'text-gray-500'}">${t.active ? 'Active' : 'Paused'}</button>
            </td>
            <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-1">
                    <button onclick="editRecurring('${t.id}')" class="text-accent hover:text-accent-light p-1">${editIcon}</button>
                    <button onclick="deleteRecurring('${t.id}')" class="text-red-400 hover:text-red-300 p-1">${delIcon}</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Modal helpers
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// Utility
function formatNumber(n) {
    return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function generateColors(count) {
    const palette = [
        '#0ea5e9', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
        '#ef4444', '#6366f1', '#14b8a6', '#f97316', '#84cc16',
        '#06b6d4', '#a855f7', '#e11d48', '#eab308', '#22c55e'
    ];
    const colors = [];
    for (let i = 0; i < count; i++) colors.push(palette[i % palette.length]);
    return colors;
}

// Close modals on backdrop click
document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', e => {
        if (e.target === modal) closeModal(modal.id);
    });
});