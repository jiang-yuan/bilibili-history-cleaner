// ==UserScript==
// @name         B站历史清理
// @name:en      Bilibili History Cleaner
// @namespace    https://github.com/jiang-yuan/bilibili-history-cleaner
// @version      0.1.4
// @description  手动批量清理 B 站历史记录：删除 80% 以上普通视频，以及直播、专栏、PGC 记录。
// @description:en Manually clean Bilibili history in batches: delete 80%+ completed archive records and live/article/PGC records.
// @author       wtvxy
// @license      MIT
// @match        https://www.bilibili.com/history*
// @homepageURL  https://github.com/jiang-yuan/bilibili-history-cleaner
// @supportURL   https://github.com/jiang-yuan/bilibili-history-cleaner/issues
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function init(root, factory) {
  const cleaner = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = cleaner;
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.BilibiliHistoryCleaner = cleaner;
    cleaner.start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildCleaner() {
  'use strict';

  const CLEANUP_THRESHOLD = 0.8;
  const DIRECT_DELETE_BUSINESS = new Set(['live', 'article', 'article-list', 'pgc']);
  const HISTORY_API_URL = 'https://api.bilibili.com/x/web-interface/history/cursor';
  const HISTORY_PAGE_SIZE = 30;
  const DELETE_API_URL = 'https://api.bilibili.com/x/v2/history/delete';
  const DELETE_DELAY_MS = 350;

  function getBusiness(record) {
    return record && record.history ? String(record.history.business || '') : '';
  }

  function shouldDeleteRecord(record) {
    const business = getBusiness(record);

    if (DIRECT_DELETE_BUSINESS.has(business)) {
      return true;
    }

    if (business !== 'archive') {
      return false;
    }

    const progress = Number(record.progress);
    const duration = Number(record.duration);

    if (progress === -1) {
      return true;
    }

    return Number.isFinite(progress) && Number.isFinite(duration) && duration > 0 && progress / duration >= CLEANUP_THRESHOLD;
  }

  function normalizeIdentifier(value) {
    if (value === null || value === undefined) {
      return '';
    }

    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : '';
  }

  function buildDeleteKid(record) {
    const business = getBusiness(record);
    const history = record && record.history ? record.history : {};
    const id = normalizeIdentifier(
      record && record.kid !== undefined && record.kid !== null ? record.kid : history.kid || history.oid
    );

    if (!business || !id) {
      return null;
    }

    return `${business}_${id}`;
  }

  function selectCandidates(records, limit) {
    const candidates = [];

    for (const record of records || []) {
      if (candidates.length >= limit) {
        break;
      }

      if (!shouldDeleteRecord(record)) {
        continue;
      }

      const kid = buildDeleteKid(record);
      if (!kid) {
        continue;
      }

      candidates.push({
        business: getBusiness(record),
        kid,
        record
      });
    }

    return candidates;
  }

  function countByBusiness(candidates) {
    return (candidates || []).reduce((counts, candidate) => {
      const business = candidate.business || 'unknown';
      counts[business] = (counts[business] || 0) + 1;
      return counts;
    }, {});
  }

  function parseBiliJctCookie(cookieString) {
    const parts = String(cookieString || '').split(';');

    for (const part of parts) {
      const [rawName, ...rawValue] = part.split('=');
      if (rawName && rawName.trim() === 'bili_jct') {
        return decodeURIComponent(rawValue.join('=').trim());
      }
    }

    return '';
  }

  function buildHistoryUrl(cursor) {
    const params = new URLSearchParams();
    params.set('ps', String(HISTORY_PAGE_SIZE));

    if (cursor && cursor.max !== undefined && cursor.max !== null) {
      params.set('max', String(cursor.max));
    }

    if (cursor && cursor.view_at !== undefined && cursor.view_at !== null) {
      params.set('view_at', String(cursor.view_at));
    }

    if (cursor && cursor.business) {
      params.set('business', String(cursor.business));
    }

    return `${HISTORY_API_URL}?${params.toString()}`;
  }

  function cursorKey(cursor) {
    if (!cursor) {
      return '';
    }

    return [cursor.max, cursor.view_at, cursor.business]
      .map((value) => (value === undefined || value === null ? '' : String(value)))
      .join('|');
  }

  async function scanCandidates(limit, fetchJson, onProgress) {
    const candidates = [];
    const seenCursorKeys = new Set();
    let cursor = null;
    let scannedRecords = 0;
    let reachedEnd = false;

    while (candidates.length < limit) {
      const url = buildHistoryUrl(cursor);
      const response = await fetchJson(url);

      if (!response || response.code !== 0) {
        throw new Error(response && response.message ? response.message : 'Failed to fetch Bilibili history');
      }

      const data = response.data || {};
      const list = Array.isArray(data.list) ? data.list : [];
      scannedRecords += list.length;

      for (const candidate of selectCandidates(list, limit - candidates.length)) {
        candidates.push(candidate);
      }

      if (typeof onProgress === 'function') {
        onProgress({
          candidates: candidates.slice(),
          scannedRecords
        });
      }

      if (list.length === 0 || !data.cursor) {
        reachedEnd = true;
        break;
      }

      const nextKey = cursorKey(data.cursor);
      if (!nextKey || seenCursorKeys.has(nextKey)) {
        reachedEnd = true;
        break;
      }

      seenCursorKeys.add(nextKey);
      cursor = data.cursor;
    }

    return {
      candidates,
      scannedRecords,
      reachedEnd
    };
  }

  function delay(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function buildDeleteBody(kid, csrf) {
    const params = new URLSearchParams();
    params.set('kid', kid);
    params.set('csrf', csrf);
    return params.toString();
  }

  async function deleteCandidates(candidates, csrf, deleteOne, wait, onProgress) {
    const failures = [];
    let successCount = 0;

    for (const candidate of candidates || []) {
      const body = buildDeleteBody(candidate.kid, csrf);

      try {
        const response = await deleteOne(candidate, body);
        if (response && response.code === 0) {
          successCount += 1;
        } else {
          failures.push({
            kid: candidate.kid,
            business: candidate.business,
            message: response && response.message ? response.message : 'Delete failed'
          });
        }
      } catch (error) {
        failures.push({
          kid: candidate.kid,
          business: candidate.business,
          message: error && error.message ? error.message : String(error)
        });
      }

      if (typeof onProgress === 'function') {
        onProgress({
          successCount,
          failures: failures.slice(),
          total: candidates.length
        });
      }

      await wait(DELETE_DELAY_MS);
    }

    return {
      successCount,
      failures
    };
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }

  async function postDelete(candidate, body) {
    const response = await fetch(DELETE_API_URL, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }

  function formatCounts(counts) {
    const entries = Object.entries(counts || {});
    if (entries.length === 0) {
      return '无';
    }

    return entries.map(([business, count]) => `${business}: ${count}`).join(', ');
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.id = 'bilibili-history-cleaner-panel';
    panel.innerHTML = [
      '<style>',
      '#bilibili-history-cleaner-panel { position: fixed; right: 4px; bottom: 18px; z-index: 999999; width: 248px; padding: 10px; border: 1px solid #d9dde4; border-radius: 6px; background: #fff; color: #18191c; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.10); }',
      '#bilibili-history-cleaner-panel.is-collapsed { width: auto; padding: 0; border: 0; background: transparent; box-shadow: none; }',
      '#bilibili-history-cleaner-panel h2 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }',
      '#bilibili-history-cleaner-panel .bhc-toggle { width: 90px; height: 30px; padding: 0 8px; border: 1px solid #00aeec; border-radius: 6px; background: #00aeec; color: #fff; cursor: pointer; font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.10); }',
      '#bilibili-history-cleaner-panel:not(.is-collapsed) .bhc-toggle { width: 100%; margin-bottom: 8px; background: #fff; color: #00aeec; box-shadow: none; }',
      '#bilibili-history-cleaner-panel.is-collapsed .bhc-content { display: none; }',
      '#bilibili-history-cleaner-panel .bhc-actions { display: grid; grid-template-columns: 1fr; gap: 8px; margin-bottom: 10px; }',
      '#bilibili-history-cleaner-panel .bhc-actions button { height: 32px; border: 1px solid #00aeec; border-radius: 6px; background: #00aeec; color: #fff; cursor: pointer; font: inherit; }',
      '#bilibili-history-cleaner-panel button[data-mode="preview"] { background: #fff; color: #00aeec; }',
      '#bilibili-history-cleaner-panel button:disabled { border-color: #c9ccd0; background: #e3e5e7; color: #9499a0; cursor: not-allowed; }',
      '#bilibili-history-cleaner-panel .bhc-status { white-space: pre-wrap; min-height: 72px; padding: 8px; border-radius: 6px; background: #f6f7f8; color: #61666d; }',
      '</style>',
      '<button type="button" class="bhc-toggle" data-mode="toggle">B站历史清理</button>',
      '<div class="bhc-content">',
      '<h2>B站历史清理</h2>',
      '<div class="bhc-actions">',
      '<button type="button" data-mode="preview">预览候选</button>',
      '<button type="button" data-mode="delete" data-limit="50">立即清理 50 条</button>',
      '<button type="button" data-mode="delete" data-limit="100">立即清理 100 条</button>',
      '</div>',
      '<div class="bhc-status" aria-live="polite">待命</div>',
      '</div>'
    ].join('');
    panel.classList.add('is-collapsed');

    document.body.appendChild(panel);

    return {
      root: panel,
      actionButtons: Array.from(panel.querySelectorAll('.bhc-actions button')),
      status: panel.querySelector('.bhc-status')
    };
  }

  function setBusy(panel, busy) {
    for (const button of panel.actionButtons) {
      button.disabled = busy;
    }
  }

  function setStatus(panel, message) {
    panel.status.textContent = message;
  }

  function setExpanded(panel, expanded) {
    panel.root.classList.toggle('is-collapsed', !expanded);
  }

  function start() {
    if (!location.href.startsWith('https://www.bilibili.com/history')) {
      return;
    }

    if (document.getElementById('bilibili-history-cleaner-panel')) {
      return;
    }

    const panel = createPanel();

    async function preview(limit) {
      setExpanded(panel, true);
      setBusy(panel, true);
      setStatus(panel, '扫描中...');

      try {
        const result = await scanCandidates(limit, fetchJson, (progress) => {
          setStatus(panel, `扫描中...\n已扫描: ${progress.scannedRecords}\n候选: ${progress.candidates.length}`);
        });

        setStatus(panel, [
          '预览完成',
          `已扫描: ${result.scannedRecords}`,
          `候选: ${result.candidates.length}`,
          `按类型: ${formatCounts(countByBusiness(result.candidates))}`,
          result.reachedEnd ? '已到末尾: 是' : '已到末尾: 否'
        ].join('\n'));
      } catch (error) {
        setStatus(panel, `失败: ${error && error.message ? error.message : String(error)}`);
      } finally {
        setBusy(panel, false);
      }
    }

    async function clean(limit) {
      setExpanded(panel, true);
      const csrf = parseBiliJctCookie(document.cookie);
      if (!csrf) {
        setStatus(panel, '失败: 未找到 bili_jct cookie，请确认 B 站登录状态');
        return;
      }

      setBusy(panel, true);
      setStatus(panel, '扫描中...');

      try {
        const scanResult = await scanCandidates(limit, fetchJson, (progress) => {
          setStatus(panel, `扫描中...\n已扫描: ${progress.scannedRecords}\n候选: ${progress.candidates.length}`);
        });

        if (scanResult.candidates.length === 0) {
          setStatus(panel, `完成: 没有匹配记录\n已扫描: ${scanResult.scannedRecords}`);
          return;
        }

        setStatus(panel, [
          '删除中...',
          `候选: ${scanResult.candidates.length}`,
          `按类型: ${formatCounts(countByBusiness(scanResult.candidates))}`
        ].join('\n'));

        const deleteResult = await deleteCandidates(scanResult.candidates, csrf, postDelete, delay, (progress) => {
          setStatus(panel, [
            '删除中...',
            `成功: ${progress.successCount}/${progress.total}`,
            `失败: ${progress.failures.length}`
          ].join('\n'));
        });

        const failureLines = deleteResult.failures.slice(0, 5).map((failure) => `${failure.kid}: ${failure.message}`);
        setStatus(panel, [
          '完成',
          `已删除: ${deleteResult.successCount}/${scanResult.candidates.length}`,
          `失败: ${deleteResult.failures.length}`,
          failureLines.length ? `失败详情:\n${failureLines.join('\n')}` : '失败详情: 无',
          '刷新页面可更新可见历史'
        ].join('\n'));
      } catch (error) {
        setStatus(panel, `失败: ${error && error.message ? error.message : String(error)}`);
      } finally {
        setBusy(panel, false);
      }
    }

    panel.root.addEventListener('click', (event) => {
      if (!event.target || typeof event.target.closest !== 'function') {
        return;
      }

      const button = event.target.closest('button');
      if (!button) {
        return;
      }

      if (button.dataset.mode === 'toggle') {
        setExpanded(panel, panel.root.classList.contains('is-collapsed'));
        return;
      }

      if (button.dataset.mode === 'preview') {
        preview(100);
        return;
      }

      if (button.dataset.mode === 'delete') {
        clean(Number(button.dataset.limit));
      }
    });
  }

  return {
    CLEANUP_THRESHOLD,
    DELETE_API_URL,
    DELETE_DELAY_MS,
    DIRECT_DELETE_BUSINESS,
    HISTORY_API_URL,
    HISTORY_PAGE_SIZE,
    buildDeleteBody,
    buildDeleteKid,
    buildHistoryUrl,
    countByBusiness,
    createPanel,
    deleteCandidates,
    formatCounts,
    fetchJson,
    parseBiliJctCookie,
    postDelete,
    scanCandidates,
    selectCandidates,
    setBusy,
    setExpanded,
    setStatus,
    shouldDeleteRecord,
    start
  };
});
