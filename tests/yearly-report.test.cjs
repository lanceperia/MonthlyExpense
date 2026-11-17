const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
    const downloads = [];
    const blobs = [];
    const revoked = [];
    const context = vm.createContext({
        firebase: { initializeApp() {}, auth: () => ({ onAuthStateChanged() {} }), firestore: () => ({}) },
        document: {
            querySelectorAll: () => [],
            getElementById: () => ({ value: '2026' }),
            createElement: () => ({ click() { downloads.push({ href: this.href, name: this.download }); }, remove() {} }),
            body: { appendChild() {} }
        },
        Blob,
        URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:report'; }, revokeObjectURL(url) { revoked.push(url); } },
        setTimeout(callback) { callback(); }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);
    vm.runInContext(`
        banks = [{ name: 'BPI', soaDate: 15 }, { name: 'Cash', soaDate: 0 }];
        purchases = [
            { date: '2025-12-15', bank: 'BPI', category: 'Grocery', amount: 100 },
            { date: '2026-01-01', bank: 'Cash', category: 'Others', othersText: 'Café, "food"\\nshared', amount: '50.25' },
            { date: '2026-06-01', bank: 'Cash', category: 'Grocery', amount: -10 },
            { date: '2026-12-14', bank: 'BPI', category: 'Grocery', amount: 20 },
            { date: '2026-12-15', bank: 'BPI', category: 'Grocery', amount: 999 },
            { date: '2026-01-01', bank: 'BPI', category: 'Payment', amount: 1000 }
        ];
    `, context);
    return { run: source => vm.runInContext(source, context), downloads, blobs, revoked };
}

test('report uses billing year, excludes repayments, and reconciles totals', () => {
    const { run } = setup();
    const csv = run('buildYearlyReportCsv(2026)');
    assert.ok(csv.startsWith('\uFEFF'));
    assert.ok(csv.includes('"Total Expenses (PHP)","160.25"'));
    assert.ok(csv.includes('"Transaction Count","4"'));
    assert.ok(csv.includes('"January","150.25"'));
    assert.ok(csv.includes('"June","-10.00"'));
    assert.ok(csv.includes('"December","20.00"'));
    assert.ok(csv.includes('"BPI","120.00"'));
    assert.ok(csv.includes('"Grocery","110.00"'));
    assert.ok(csv.includes('"2025-12-15","2026","January"'));
    assert.ok(csv.includes('"Café, ""food""\nshared"'));
    assert.ok(!csv.includes('999.00'));
    assert.ok(!csv.includes('1000.00'));
});

test('empty years still include all months and zero totals', () => {
    const { run } = setup();
    const csv = run('buildYearlyReportCsv(2024)');
    assert.ok(csv.includes('"Total Expenses (PHP)","0.00"'));
    assert.ok(csv.includes('"Transaction Count","0"'));
    assert.equal((csv.match(/"(?:January|February|March|April|May|June|July|August|September|October|November|December)","0.00"/g) || []).length, 12);
});

test('CSV escapes quotes, multiline values, and formula-like text', () => {
    const { run } = setup();
    for (const value of ['=SUM(A1)', '+cmd', '-cmd', '@SUM(A1)', '\t=1+1', '\r=1']) {
        assert.ok(run(`escapeCsvCell(${JSON.stringify(value)})`).startsWith('"\''));
    }
    assert.equal(run('escapeCsvCell(-10)'), '"-10"');
});

test('download uses selected year, UTF-8 CSV, and releases object URL', async () => {
    const { run, downloads, blobs, revoked } = setup();
    run('downloadYearlyReport()');
    assert.equal(downloads[0].name, 'expense-report-2026.csv');
    assert.equal(downloads[0].href, 'blob:report');
    assert.equal(blobs[0].type, 'text/csv;charset=utf-8;');
    assert.ok((await blobs[0].text()).includes('"Total Expenses (PHP)","160.25"'));
    assert.deepEqual(revoked, ['blob:report']);
});
