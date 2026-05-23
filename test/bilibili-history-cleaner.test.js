const test = require('node:test');
const assert = require('node:assert/strict');

const cleaner = require('../src/bilibili-history-cleaner.user.js');

function record(business, fields = {}) {
  return {
    kid: fields.topLevelKid,
    progress: fields.progress,
    duration: fields.duration,
    history: {
      business,
      kid: fields.kid,
      oid: fields.oid
    }
  };
}

test('archive records are deleted only when finished or at least 80 percent complete', () => {
  assert.equal(cleaner.shouldDeleteRecord(record('archive', { progress: -1, duration: 120, kid: 1 })), true);
  assert.equal(cleaner.shouldDeleteRecord(record('archive', { progress: 80, duration: 100, kid: 2 })), true);
  assert.equal(cleaner.shouldDeleteRecord(record('archive', { progress: 79, duration: 100, kid: 3 })), false);
  assert.equal(cleaner.shouldDeleteRecord(record('archive', { progress: 0, duration: 0, kid: 4 })), false);
});

test('live article article-list and pgc records are deleted directly', () => {
  for (const business of ['live', 'article', 'article-list', 'pgc']) {
    assert.equal(cleaner.shouldDeleteRecord(record(business, { progress: 0, duration: 0, kid: 10 })), true);
  }
});

test('unknown and malformed records are not deleted', () => {
  assert.equal(cleaner.shouldDeleteRecord(record('unknown', { progress: -1, duration: 1, kid: 1 })), false);
  assert.equal(cleaner.shouldDeleteRecord({ progress: -1, duration: 1, history: {} }), false);
  assert.equal(cleaner.shouldDeleteRecord(null), false);
});

test('buildDeleteKid uses business and kid and skips records without identifiers', () => {
  assert.equal(cleaner.buildDeleteKid(record('archive', { kid: 123 })), 'archive_123');
  assert.equal(cleaner.buildDeleteKid(record('live', { kid: '456' })), 'live_456');
  assert.equal(cleaner.buildDeleteKid(record('pgc', { oid: 789 })), 'pgc_789');
  assert.equal(cleaner.buildDeleteKid(record('archive')), null);
  assert.equal(cleaner.buildDeleteKid({ history: { business: '' } }), null);
});

test('buildDeleteKid prefers top-level kid from cursor history items', () => {
  const pgc = record('pgc', { topLevelKid: 26193, oid: 370908663 });

  assert.equal(cleaner.buildDeleteKid(pgc), 'pgc_26193');
});

test('selectCandidates keeps matching records with delete keys until the limit', () => {
  const records = [
    record('archive', { progress: 10, duration: 100, kid: 1 }),
    record('archive', { progress: 95, duration: 100, kid: 2 }),
    record('live', { kid: 3 }),
    record('unknown', { kid: 4 }),
    record('pgc', { kid: 5 })
  ];

  assert.deepEqual(cleaner.selectCandidates(records, 2), [
    { business: 'archive', kid: 'archive_2', record: records[1] },
    { business: 'live', kid: 'live_3', record: records[2] }
  ]);
});

test('countByBusiness returns stable per-business counts', () => {
  assert.deepEqual(cleaner.countByBusiness([
    { business: 'archive' },
    { business: 'archive' },
    { business: 'live' },
    { business: 'pgc' }
  ]), {
    archive: 2,
    live: 1,
    pgc: 1
  });
});

test('parseBiliJctCookie extracts csrf token from cookie string', () => {
  assert.equal(cleaner.parseBiliJctCookie('foo=bar; bili_jct=abc123; other=x'), 'abc123');
  assert.equal(cleaner.parseBiliJctCookie('foo=bar'), '');
  assert.equal(cleaner.parseBiliJctCookie(''), '');
});

test('buildHistoryUrl creates initial and cursor URLs without filtering to archive only', () => {
  assert.equal(
    cleaner.buildHistoryUrl(null),
    'https://api.bilibili.com/x/web-interface/history/cursor?ps=30'
  );

  assert.equal(
    cleaner.buildHistoryUrl({ max: 100, view_at: 200, business: 'archive' }),
    'https://api.bilibili.com/x/web-interface/history/cursor?ps=30&max=100&view_at=200&business=archive'
  );
});

test('scanCandidates fetches pages until requested candidates are collected', async () => {
  const pages = [
    {
      code: 0,
      data: {
        cursor: { max: 10, view_at: 20, business: 'archive' },
        list: [
          record('archive', { progress: 10, duration: 100, kid: 1 }),
          record('live', { kid: 2 })
        ]
      }
    },
    {
      code: 0,
      data: {
        cursor: { max: 9, view_at: 19, business: 'pgc' },
        list: [
          record('archive', { progress: 95, duration: 100, kid: 3 }),
          record('pgc', { kid: 4 })
        ]
      }
    }
  ];

  const requestedUrls = [];
  const result = await cleaner.scanCandidates(2, async (url) => {
    requestedUrls.push(url);
    return pages.shift();
  });

  assert.deepEqual(result.candidates.map((candidate) => candidate.kid), ['live_2', 'archive_3']);
  assert.equal(result.scannedRecords, 4);
  assert.equal(result.reachedEnd, false);
  assert.equal(requestedUrls.length, 2);
});

test('buildDeleteBody includes kid and csrf', () => {
  assert.equal(cleaner.buildDeleteBody('archive_123', 'csrf-token'), 'kid=archive_123&csrf=csrf-token');
});

test('deleteCandidates runs serially and records failures', async () => {
  const calls = [];
  const candidates = [
    { business: 'archive', kid: 'archive_1' },
    { business: 'live', kid: 'live_2' },
    { business: 'pgc', kid: 'pgc_3' }
  ];

  const result = await cleaner.deleteCandidates(candidates, 'csrf-token', async (candidate, body) => {
    calls.push({ candidate, body });
    if (candidate.kid === 'live_2') {
      return { code: -1, message: 'delete failed' };
    }
    return { code: 0 };
  }, async () => {});

  assert.deepEqual(calls.map((call) => call.candidate.kid), ['archive_1', 'live_2', 'pgc_3']);
  assert.deepEqual(calls.map((call) => call.body), [
    'kid=archive_1&csrf=csrf-token',
    'kid=live_2&csrf=csrf-token',
    'kid=pgc_3&csrf=csrf-token'
  ]);
  assert.equal(result.successCount, 2);
  assert.deepEqual(result.failures, [
    { kid: 'live_2', business: 'live', message: 'delete failed' }
  ]);
});
