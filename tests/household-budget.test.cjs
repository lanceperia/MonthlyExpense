const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(items = [], today = '2026-11-14T23:59:59') {
    const elements = new Map();
    const timers = [];
    const cleared = [];
    let now = new Date(today).getTime();
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const context = vm.createContext({
        Date: ClockDate,
        firebase: { initializeApp() {}, auth: () => ({ onAuthStateChanged() {} }), firestore: () => ({}) },
        setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
        clearTimeout(id) { cleared.push(id); },
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
        currentUser = { uid: 'test-user' };
        banks = [{ name: 'BPI', soaDate: 15 }, { name: 'Cash', soaDate: 0 }];
        purchases = ${JSON.stringify(items)};
        currentMonth = 10; currentYear = 2026; settings.defaultBudget = 50000;
        renderBankSummary = () => {}; renderHousehold = () => {};
    `, context);
    return { run: source => vm.runInContext(source, context), elements, timers, cleared,
        advance: value => { now = new Date(value).getTime(); } };
}

const grocery = amount => ({ date: '2026-11-05', bank: 'BPI', category: 'Grocery', amount });
const group = 'getHouseholdForMonth(10, 2026)[0]';

test('counts the full allocation once until the billing month\'s 15th', () => {
    assert.equal(setup().run(`${group}.commitment`), 15000);
    const { run } = setup([grocery('7200')]);
    assert.equal(run(`${group}.commitment`), 15000);
    assert.equal(run('getMonthlyCommitment([], getHouseholdForMonth(10, 2026))'), 23000);
    assert.equal(run("getHouseholdForMonth(10, 2026, new Date('2026-11-14T12:00:00'))[0].commitment"), 15000);
});

test('automatically releases only unused money at midnight on the billing month\'s 15th', () => {
    const { run, advance } = setup([grocery(7200)]);
    assert.equal(run(`${group}.groceryCycleClosed`), false);
    // Old manual flags must not override the new automatic cutoff.
    run("settings.groceryReleasedMonths = { '2026-10': true }");
    assert.equal(run(`${group}.commitment`), 15000);
    advance('2026-11-15T00:00:00');
    assert.equal(run(`${group}.groceryCycleClosed`), true);
    assert.equal(run(`${group}.commitment`), 7200);
    assert.equal(setup([], '2026-11-15T00:00:00').run(`${group}.commitment`), 0);
});

test('spending at or above 15000 continues counting in full before and after cutoff', () => {
    for (const date of ['2026-11-14T23:59:59', '2026-11-15T00:00:00']) {
        for (const amount of [15000, 16000, 18000]) {
            const { run, elements } = setup([grocery(amount)], date);
            run('renderMonthly()');
            assert.equal(run(`${group}.commitment`), amount);
            assert.equal(elements.get('spent-amount').textContent, '₱' + (amount + 8000).toLocaleString('en-US', { minimumFractionDigits: 2 }));
        }
    }
    assert.equal(setup([grocery(7200), grocery(-200)], '2026-11-16T12:00:00').run(`${group}.commitment`), 7000);
});

test('December releases in December while January remains fully allocated', () => {
    const { run, advance } = setup([
        { date: '2026-12-14', bank: 'BPI', category: 'Grocery', amount: 1000 },
        { date: '2026-12-15', bank: 'BPI', category: 'Grocery', amount: 2000 },
        { date: '2026-12-15', bank: 'Cash', category: 'Grocery', amount: 500 }
    ], '2026-12-14T23:59:59');
    assert.equal(run('getHouseholdForMonth(11, 2026)[0].commitment'), 15000);
    advance('2026-12-15T00:00:00');
    assert.equal(run('getHouseholdForMonth(11, 2026)[0].commitment'), 1500);
    assert.equal(run('getHouseholdForMonth(0, 2027)[0].spent'), 2000);
    assert.equal(run('getHouseholdForMonth(0, 2027)[0].commitment'), 15000);
    advance('2027-01-14T23:59:59');
    assert.equal(run('getHouseholdForMonth(0, 2027)[0].commitment'), 15000);
    advance('2027-01-15T00:00:00');
    assert.equal(run('getHouseholdForMonth(0, 2027)[0].commitment'), 2000);
});

test('Total spent includes household allocations and excludes repayments', () => {
    const { run, elements, advance } = setup([
        grocery(7200),
        { date: '2026-11-02', bank: 'Cash', category: 'PLDT', amount: 1400 },
        { date: '2026-11-02', bank: 'Cash', category: 'Others', amount: 1000 },
        { date: '2026-11-02', bank: 'BPI', category: 'Payment', amount: 7200 }
    ]);
    run('renderMonthly()');
    assert.equal(elements.get('spent-amount').textContent, '₱23,900.00');
    assert.equal(elements.get('remaining-amount').textContent, '₱26,100.00');
    advance('2026-11-15T00:00:00');
    run('renderMonthly()');
    assert.equal(elements.get('spent-amount').textContent, '₱16,100.00');
    assert.equal(elements.get('remaining-amount').textContent, '₱33,900.00');
});

test('an open view refreshes at release and monthly navigation replaces its timer', () => {
    const { run, timers, cleared, advance, elements } = setup([grocery(7200)]);
    run('renderMonthly()');
    assert.equal(timers[0].delay, 1000);
    run('renderMonthly()');
    assert.ok(cleared.includes(1));
    advance('2026-11-15T00:00:00');
    timers[1].callback();
    assert.equal(elements.get('spent-amount').textContent, '₱15,200.00');
    const count = timers.length;
    run('currentMonth = 11; renderMonthly()');
    assert.equal(timers.length, count + 1);
    assert.ok(timers.at(-1).delay <= 2147483647);
});

test('December screenshot figures reconcile before and after December 15', () => {
    const { run, elements, advance } = setup([
        { date: '2026-11-20', bank: 'BPI', category: 'Others', amount: 48291.83 },
        { date: '2026-11-20', bank: 'BPI', category: 'Grocery', amount: 6420.80 }
    ], '2026-12-14T23:59:59');
    run('currentMonth = 11; settings.defaultBudget = 58000; renderMonthly()');
    assert.equal(elements.get('spent-amount').textContent, '₱71,291.83');
    assert.equal(elements.get('remaining-label').textContent, 'Overspent:');
    assert.equal(elements.get('remaining-amount').textContent, '₱13,291.83');
    advance('2026-12-15T00:00:00');
    run('renderMonthly()');
    assert.equal(elements.get('spent-amount').textContent, '₱62,712.63');
    assert.equal(elements.get('remaining-amount').textContent, '₱4,712.63');
});
