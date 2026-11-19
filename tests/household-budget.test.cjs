const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(items = [], failWrites = false) {
    const elements = new Map();
    const writes = [];
    const alerts = [];
    function element(tag = 'div') {
        return { tag, children: [], style: {}, classList: { add() {}, remove() {} },
            append(...children) { this.children.push(...children); },
            replaceChildren(...children) { this.children = children; },
            setAttribute() {} };
    }
    const context = vm.createContext({
        firebase: {
            initializeApp() {}, auth: () => ({ onAuthStateChanged() {} }),
            firestore: () => ({ collection: collection => ({ doc: id => ({
                async set(data, options) {
                    if (failWrites) throw new Error('Offline');
                    writes.push({ collection, id, data, options });
                }
            }) }) })
        },
        alert: message => alerts.push(message),
        document: {
            querySelectorAll: () => [], createElement: element,
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, element());
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
        renderBankSummary = () => {};
        const realRenderHousehold = renderHousehold;
        renderHousehold = () => {};
    `, context);
    return { run: source => vm.runInContext(source, context), elements, writes, alerts };
}

const grocery = amount => ({ date: '2026-11-05', bank: 'BPI', category: 'Grocery', amount });
const group = 'getHouseholdForMonth(10, 2026)[0]';

function buttons(element) {
    return [element, ...element.children.flatMap(buttons)].filter(item => item.tag === 'button');
}

test('full grocery allocation counts once until release, including months with no purchases', () => {
    assert.equal(setup().run(`${group}.commitment`), 15000);
    const { run } = setup([grocery('7200')]);
    assert.equal(run(`${group}.commitment`), 15000);
    assert.equal(run('getMonthlyCommitment([], getHouseholdForMonth(10, 2026))'), 23000);
    // Time alone must never release an old billing month.
    assert.equal(run('getHouseholdForMonth(0, 2020)[0].commitment'), 15000);
});

test('manual release persists for the selected month and is idempotent', async () => {
    const { run, writes } = setup([grocery(7200)]);
    await run('releaseGrocery(10, 2026)');
    assert.equal(run(`${group}.commitment`), 7200);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].collection, 'users');
    assert.equal(writes[0].id, 'test-user');
    assert.equal(writes[0].data.settings.groceryReleasedMonths['2026-10'], true);
    assert.equal(writes[0].options.merge, true);
    assert.equal(run('getHouseholdForMonth(11, 2026)[0].commitment'), 15000);
    await run('releaseGrocery(10, 2026)');
    assert.equal(writes.length, 1);
    const reloaded = setup([grocery(7200)]);
    reloaded.run(`settings.groceryReleasedMonths = ${JSON.stringify(writes[0].data.settings.groceryReleasedMonths)}`);
    assert.equal(reloaded.run(`${group}.commitment`), 7200);
});

test('failed release preserves the allocation and allows retry', async () => {
    const { run, writes, alerts } = setup([grocery(7200)], true);
    await run('releaseGrocery(10, 2026)');
    assert.equal(run(`${group}.commitment`), 15000);
    assert.equal(run('groceryReleasePending.size'), 0);
    assert.equal(writes.length, 0);
    assert.equal(alerts.length, 1);
});

test('overspending keeps increasing Total spent and has no release button', async () => {
    for (const amount of [15000, 16000, 18000]) {
        const { run, elements, writes } = setup([grocery(amount)]);
        run('renderHousehold = realRenderHousehold; renderMonthly()');
        assert.equal(run(`${group}.commitment`), amount);
        assert.equal(elements.get('spent-amount').textContent, '₱' + (amount + 8000).toLocaleString('en-US', { minimumFractionDigits: 2 }));
        assert.equal(buttons(elements.get('household-table-body')).some(button => button.textContent?.startsWith('Release')), false);
        await run('releaseGrocery(10, 2026)');
        assert.equal(writes.length, 0);
    }
});

test('release button shows unused money, stops row expansion, and disappears after release', async () => {
    const { run, elements } = setup([grocery(7200), grocery(0)]);
    run('renderHousehold = realRenderHousehold; renderMonthly()');
    const release = buttons(elements.get('household-table-body')).find(button => button.textContent === 'Release ₱7,800.00');
    assert.ok(release);
    let stopped = false;
    await release.onclick({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true);
    assert.equal(buttons(elements.get('household-table-body')).some(button => button.textContent?.startsWith('Release')), false);
    assert.equal(run(`${group}.commitment`), 7200);
});

test('zero-purchase release and edits after release recalculate actual grocery spending', async () => {
    const { run } = setup();
    await run('releaseGrocery(10, 2026)');
    assert.equal(run(`${group}.commitment`), 0);
    run(`purchases = ${JSON.stringify([grocery(16000)])}`);
    assert.equal(run(`${group}.commitment`), 16000);
    run(`purchases = ${JSON.stringify([grocery(7200), grocery(-200)])}`);
    assert.equal(run(`${group}.commitment`), 7000);
});

test('SOA attribution and release state remain separate across year boundaries', () => {
    const { run } = setup([
        { date: '2026-12-14', bank: 'BPI', category: 'Grocery', amount: 1000 },
        { date: '2026-12-15', bank: 'BPI', category: 'Grocery', amount: 2000 },
        { date: '2026-12-15', bank: 'Cash', category: 'Grocery', amount: 500 }
    ]);
    run("settings.groceryReleasedMonths = { '2026-11': true }");
    assert.equal(run('getHouseholdForMonth(11, 2026)[0].commitment'), 1500);
    assert.equal(run('getHouseholdForMonth(0, 2027)[0].spent'), 2000);
    assert.equal(run('getHouseholdForMonth(0, 2027)[0].commitment'), 15000);
});

test('Total spent includes allocations, excludes repayments, and reconciles after release', async () => {
    const { run, elements } = setup([
        grocery(7200),
        { date: '2026-11-02', bank: 'Cash', category: 'PLDT', amount: 1400 },
        { date: '2026-11-02', bank: 'Cash', category: 'Others', amount: 1000 },
        { date: '2026-11-02', bank: 'BPI', category: 'Payment', amount: 7200 }
    ]);
    run('renderMonthly()');
    assert.equal(elements.get('spent-amount').textContent, '₱23,900.00');
    assert.equal(elements.get('remaining-amount').textContent, '₱26,100.00');
    await run('releaseGrocery(10, 2026)');
    assert.equal(elements.get('spent-amount').textContent, '₱16,100.00');
    assert.equal(elements.get('remaining-amount').textContent, '₱33,900.00');
});

test('December screenshot totals include unused groceries until manual release', async () => {
    const { run, elements } = setup([
        { date: '2026-11-20', bank: 'BPI', category: 'Others', amount: 48291.83 },
        { date: '2026-11-20', bank: 'BPI', category: 'Grocery', amount: 6420.80 }
    ]);
    run('currentMonth = 11; settings.defaultBudget = 58000; renderMonthly()');
    assert.equal(elements.get('spent-amount').textContent, '₱71,291.83');
    assert.equal(elements.get('remaining-label').textContent, 'Overspent:');
    assert.equal(elements.get('remaining-amount').textContent, '₱13,291.83');
    await run('releaseGrocery(11, 2026)');
    assert.equal(elements.get('spent-amount').textContent, '₱62,712.63');
    assert.equal(elements.get('remaining-amount').textContent, '₱4,712.63');
});
