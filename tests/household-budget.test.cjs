const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(items = []) {
    const elements = new Map();
    const context = vm.createContext({
        firebase: { initializeApp() {}, auth: () => ({ onAuthStateChanged() {} }), firestore: () => ({}) },
        document: {
            querySelectorAll: () => [],
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, { classList: { add() {}, remove() {} } });
                return elements.get(id);
            }
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);
    vm.runInContext(`
        banks = [{ name: 'BPI', soaDate: 15 }, { name: 'Cash', soaDate: 0 }];
        purchases = ${JSON.stringify(items)};
        renderBankSummary = () => {};
        renderHousehold = () => {};
    `, context);
    return { run: source => vm.runInContext(source, context), elements };
}

const grocery = amount => ({ date: '2026-11-05', bank: 'BPI', category: 'Grocery', amount });
const groupAt = date => `getHouseholdForMonth(10, 2026, new Date('${date}')).find(g => g.category === 'Grocery')`;

test('reserves groceries before any purchases and does not deduct purchases twice', () => {
    const empty = setup();
    assert.equal(empty.run(`${groupAt('2026-11-14T23:59:59')}.commitment`), 15000);
    const { run } = setup([grocery('7200')]);
    assert.equal(run(`${groupAt('2026-11-14T23:59:59')}.commitment`), 15000);
    assert.equal(run(`getMonthlyCommitment([], getHouseholdForMonth(10, 2026, new Date('2026-11-14T12:00:00')))`), 23000);
});

test('releases only unused grocery money at midnight on the 15th', () => {
    const { run } = setup([grocery(7200)]);
    assert.equal(run(`${groupAt('2026-11-14T23:59:59')}.groceryCycleClosed`), false);
    assert.equal(run(`${groupAt('2026-11-15T00:00:00')}.groceryCycleClosed`), true);
    assert.equal(run(`${groupAt('2026-11-15T00:00:00')}.commitment`), 7200);
    assert.equal(run(`getMonthlyCommitment([], getHouseholdForMonth(10, 2026, new Date('2026-11-15T00:00:00')))`), 15200);
    assert.equal(setup().run(`${groupAt('2026-11-15T00:00:00')}.commitment`), 0);
});

test('overspending and later corrections still count after release', () => {
    for (const date of ['2026-11-14T12:00:00', '2026-11-15T12:00:00']) {
        assert.equal(setup([grocery(16000)]).run(`${groupAt(date)}.commitment`), 16000);
        assert.equal(setup([grocery(15000)]).run(`${groupAt(date)}.commitment`), 15000);
    }
    assert.equal(setup([grocery(7200), grocery(-200)]).run(`${groupAt('2026-11-16T12:00:00')}.commitment`), 7000);
});

test('preserves bank SOA attribution and reserves the next month across year boundaries', () => {
    const { run } = setup([
        { date: '2026-12-14', bank: 'BPI', category: 'Grocery', amount: 1000 },
        { date: '2026-12-15', bank: 'BPI', category: 'Grocery', amount: 2000 },
        { date: '2026-12-15', bank: 'Cash', category: 'Grocery', amount: 500 }
    ]);
    const december = "getHouseholdForMonth(11, 2026, new Date('2026-12-15T12:00:00'))[0]";
    const january = "getHouseholdForMonth(0, 2027, new Date('2026-12-15T12:00:00'))[0]";
    assert.equal(run(`${december}.spent`), 1500);
    assert.equal(run(`${december}.commitment`), 1500);
    assert.equal(run(`${january}.spent`), 2000);
    assert.equal(run(`${january}.commitment`), 15000);
});

test('Actual spent excludes reservations and repayments; Remaining deducts both expenses and reservations', () => {
    const { run, elements } = setup([
        grocery(7200),
        { date: '2026-11-02', bank: 'Cash', category: 'PLDT', amount: 1400 },
        { date: '2026-11-02', bank: 'Cash', category: 'Others', amount: 1000 },
        { date: '2026-11-02', bank: 'BPI', category: 'Payment', amount: 7200 }
    ]);
    run(`
        currentMonth = 10; currentYear = 2026; settings.defaultBudget = 50000;
        const originalHousehold = getHouseholdForMonth;
        getHouseholdForMonth = (month, year) => originalHousehold(month, year, new Date('2026-11-14T12:00:00'));
        renderMonthly();
    `);
    assert.equal(elements.get('spent-amount').textContent, '₱9,600.00');
    assert.equal(elements.get('remaining-amount').textContent, '₱26,100.00');
    run(`getHouseholdForMonth = (month, year) => originalHousehold(month, year, new Date('2026-11-15T12:00:00')); renderMonthly();`);
    assert.equal(elements.get('spent-amount').textContent, '₱9,600.00');
    assert.equal(elements.get('remaining-amount').textContent, '₱33,900.00');
});
