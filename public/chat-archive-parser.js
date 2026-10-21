/*
 * Best Answer Hub — AI Chat Archive Viewer parser core.
 * Runs as a same-origin Web Worker (spawned by /tools/ai-chat-archive-viewer/)
 * and as a plain page script for shared helpers (toMarkdown etc.).
 * Pure functions live on ChatArchiveParser so Node tests can run this exact file.
 * Everything is 100% client-side: files are parsed in the browser, never uploaded.
 */
(function (root) {
  'use strict';

  /* ───────────────────────── byte-level JSON splitting ─────────────────────────
   * conversations.json is a single top-level ARRAY that can be hundreds of MB —
   * far past V8's max string length (~512 MB). We never decode it as one string.
   * Instead we scan the raw bytes, slice out one top-level element at a time and
   * JSON.parse each small slice individually.
   */
  var QUOTE = 34, BACKSLASH = 92, LBRACE = 123, RBRACE = 125, LBRACKET = 91, RBRACKET = 93, NEWLINE = 10;

  function sliceTopLevelJson(bytes) {
    var slices = [];
    var depth = 0, inString = false, escaped = false, start = -1, sawArray = false;
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (inString) {
        if (escaped) { escaped = false; }
        else if (b === BACKSLASH) { escaped = true; }
        else if (b === QUOTE) { inString = false; }
        continue;
      }
      if (b === QUOTE) { inString = true; continue; }
      if (b === LBRACKET || b === LBRACE) {
        if (!sawArray && b === LBRACKET && depth === 0) { sawArray = true; depth = 1; continue; }
        if (depth === (sawArray ? 1 : 0) && b === LBRACE && start === -1) start = i;
        depth++;
      } else if (b === RBRACKET || b === RBRACE) {
        depth--;
        if (start !== -1 && depth === (sawArray ? 1 : 0)) { slices.push([start, i + 1]); start = -1; }
      }
    }
    return slices;
  }

  /* JSONL variant (some Claude exports): one JSON object per line.
   * Safe to split on raw newline bytes — JSON strings escape newlines as \n. */
  function sliceJsonLines(bytes) {
    var slices = [];
    var start = 0;
    for (var i = 0; i <= bytes.length; i++) {
      if (i === bytes.length || bytes[i] === NEWLINE) {
        var s = start, e = i;
        while (s < e && (bytes[s] === 32 || bytes[s] === 9 || bytes[s] === 13)) s++;
        while (e > s && (bytes[e - 1] === 32 || bytes[e - 1] === 9 || bytes[e - 1] === 13)) e--;
        if (e > s) slices.push([s, e]);
        start = i + 1;
      }
    }
    return slices;
  }

  function firstMeaningfulByte(bytes) {
    for (var i = 0; i < bytes.length && i < 4096; i++) {
      var b = bytes[i];
      if (b === 32 || b === 9 || b === 13 || b === 10) continue;
      if (i === 0 && b === 0xEF) { i += 2; continue; } /* UTF-8 BOM */
      return b;
    }
    return -1;
  }

  /* ───────────────────────── provider detection ───────────────────────── */

  function detectProvider(conv) {
    if (conv && typeof conv === 'object') {
      if (conv.mapping && typeof conv.mapping === 'object') return 'chatgpt';
      if (Array.isArray(conv.chat_messages)) return 'claude';
    }
    return null;
  }

  /* ───────────────────────── ChatGPT normalization ─────────────────────────
   * mapping = tree of nodes (edits/regenerations create sibling branches).
   * The canonical thread is the path from current_node back to the root.
   */
  function findLeafNode(mapping) {
    var best = null, bestTime = -Infinity;
    for (var id in mapping) {
      var node = mapping[id];
      if (!node || (node.children && node.children.length)) continue;
      var t = node.message && node.message.create_time ? node.message.create_time : 0;
      if (t >= bestTime) { bestTime = t; best = id; }
    }
    return best;
  }

  function canonicalNodeIds(conv) {
    var mapping = conv.mapping || {};
    var id = conv.current_node;
    if (!id || !mapping[id]) id = findLeafNode(mapping);
    var ids = [];
    var guard = 0;
    while (id && mapping[id] && guard++ < 100000) {
      ids.push(id);
      id = mapping[id].parent;
    }
    return ids.reverse();
  }

  var HIDDEN_CONTENT_TYPES = {
    sonic_webpage: 1, system_error: 1, tether_browsing_display: 1,
    thoughts: 1, reasoning_recap: 1, model_editable_context: 1
  };

  function hasImageParts(m) {
    var parts = m.content && m.content.parts;
    if (!Array.isArray(parts)) return false;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p && typeof p === 'object' && /image_asset_pointer/.test(p.content_type || '')) return true;
    }
    return false;
  }

  function hasNonEmptyParts(m) {
    var parts = m.content && m.content.parts;
    if (!Array.isArray(parts)) return false;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (typeof p === 'string' ? p.trim().length : p) return true;
    }
    return false;
  }

  function isVisibleMessage(m) {
    if (!m || !m.content) return false;
    var md = m.metadata || {};
    if (md.is_visually_hidden_from_conversation) return false;
    var role = m.author ? m.author.role : null;
    var name = (m.author && m.author.name) || '';
    var ct = m.content.content_type;
    if (HIDDEN_CONTENT_TYPES[ct]) return false;
    if (ct === 'user_editable_context') return true; /* custom instructions — labeled block */
    if (role === 'system') return !!md.is_user_system_message;
    if (role === 'tool') {
      if (name.indexOf('canmore') === 0) return !!canvasDocFromMessage(m); /* canvas document */
      if (name === 'browser') return ct === 'tether_quote';
      if (hasImageParts(m)) return true; /* DALL-E / generated images */
      return ct === 'tether_quote';
    }
    if (role === 'assistant') {
      if (ct === 'code') return false; /* tool-call payloads */
      var rec = m.recipient;
      if (rec && rec !== 'all' && rec !== 'python') return false;
    }
    if (m.content.parts !== undefined && !hasNonEmptyParts(m)) return false;
    return true;
  }

  function canvasDocFromMessage(m) {
    var text = m.content && (m.content.text || (Array.isArray(m.content.parts) && typeof m.content.parts[0] === 'string' ? m.content.parts[0] : null));
    if (!text || typeof text !== 'string' || text.charAt(0) !== '{') return null;
    try {
      var doc = JSON.parse(text);
      if (doc && typeof doc.content === 'string' && doc.content.trim()) {
        return { name: typeof doc.name === 'string' ? doc.name : 'Canvas', content: doc.content };
      }
    } catch (e) { /* not a canvas payload */ }
    return null;
  }

  function assetPointerOf(part) {
    if (!part || typeof part !== 'object') return null;
    var ct = part.content_type || '';
    if (ct === 'image_asset_pointer' || ct === 'audio_asset_pointer') {
      return { kind: ct === 'image_asset_pointer' ? 'image' : 'audio', pointer: part.asset_pointer || '' };
    }
    if (ct === 'real_time_user_audio_video_asset_pointer') {
      var inner = part.audio_asset_pointer;
      if (inner && inner.asset_pointer) return { kind: 'audio', pointer: inner.asset_pointer };
      if (part.asset_pointer) return { kind: 'audio', pointer: part.asset_pointer };
    }
    return null;
  }

  function blocksFromChatGPTMessage(m) {
    var blocks = [];
    var c = m.content || {};
    var ct = c.content_type;
    var role = m.author ? m.author.role : '';
    var name = (m.author && m.author.name) || '';

    if (ct === 'user_editable_context') {
      var ctxText = '';
      if (typeof c.user_profile === 'string' && c.user_profile.trim()) ctxText += c.user_profile.trim();
      if (typeof c.user_instructions === 'string' && c.user_instructions.trim()) ctxText += (ctxText ? '\n\n' : '') + c.user_instructions.trim();
      if (!ctxText && typeof c.text === 'string') ctxText = c.text;
      if (ctxText) blocks.push({ kind: 'context', label: 'Custom instructions', text: ctxText });
      return blocks;
    }
    if (role === 'tool' && name.indexOf('canmore') === 0) {
      var doc = canvasDocFromMessage(m);
      if (doc) blocks.push({ kind: 'document', label: doc.name, text: doc.content });
      return blocks;
    }
    if (ct === 'tether_quote') {
      var qTitle = c.title || c.domain || '';
      blocks.push({ kind: 'quote', label: qTitle, text: typeof c.text === 'string' ? c.text : '' });
      return blocks;
    }
    if (ct === 'code') {
      blocks.push({ kind: 'code', lang: c.language || '', text: typeof c.text === 'string' ? c.text : '' });
      return blocks;
    }
    if (ct === 'execution_output') {
      blocks.push({ kind: 'code', lang: 'output', text: typeof c.text === 'string' ? c.text : '' });
      return blocks;
    }
    var parts = Array.isArray(c.parts) ? c.parts : (typeof c.text === 'string' ? [c.text] : []);
    var textAcc = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (typeof p === 'string') { if (p.length) textAcc.push(p); continue; }
      var ap = assetPointerOf(p);
      if (ap && ap.pointer) {
        if (textAcc.length) { blocks.push({ kind: 'text', text: textAcc.join('\n') }); textAcc = []; }
        blocks.push({ kind: ap.kind, pointer: ap.pointer, width: p.width || 0, height: p.height || 0 });
      }
    }
    if (textAcc.length) blocks.push({ kind: 'text', text: textAcc.join('\n') });
    return blocks;
  }

  function normalizeChatGPT(conv, fallbackId) {
    var ids = canonicalNodeIds(conv);
    var mapping = conv.mapping || {};
    var messages = [];
    var model = conv.default_model_slug || '';
    for (var i = 0; i < ids.length; i++) {
      var node = mapping[ids[i]];
      var m = node && node.message;
      if (!m) continue; /* root nodes carry message: null */
      if (!isVisibleMessage(m)) continue;
      var blocks = blocksFromChatGPTMessage(m);
      if (!blocks.length) continue;
      var role = m.author.role === 'tool' ? 'assistant' : m.author.role;
      if (m.content && m.content.content_type === 'user_editable_context') role = 'context';
      if (!model && m.metadata && m.metadata.model_slug) model = m.metadata.model_slug;
      messages.push({
        role: role,
        time: typeof m.create_time === 'number' ? Math.round(m.create_time * 1000) : null,
        blocks: blocks
      });
    }
    return {
      id: String(conv.id || conv.conversation_id || fallbackId),
      provider: 'chatgpt',
      title: (typeof conv.title === 'string' && conv.title.trim()) ? conv.title.trim() : 'Untitled conversation',
      createTime: typeof conv.create_time === 'number' ? Math.round(conv.create_time * 1000) : null,
      updateTime: typeof conv.update_time === 'number' ? Math.round(conv.update_time * 1000) : null,
      model: model,
      messages: messages
    };
  }

  /* ───────────────────────── Claude normalization ─────────────────────────
   * Linear array — no tree, no branches. Timestamps are ISO-8601 strings.
   * Image/file bytes are NOT included in Claude exports (metadata only);
   * pasted-document text arrives as attachments[].extracted_content.
   */
  function claudeMessageText(m) {
    if (Array.isArray(m.content) && m.content.length) {
      var out = [];
      for (var i = 0; i < m.content.length; i++) {
        var blk = m.content[i];
        if (blk && blk.type === 'text' && typeof blk.text === 'string' && blk.text.length) out.push(blk.text);
      }
      if (out.length) return out.join('\n\n');
    }
    return typeof m.text === 'string' ? m.text : '';
  }

  function normalizeClaude(conv, fallbackId) {
    var messages = [];
    var list = Array.isArray(conv.chat_messages) ? conv.chat_messages : [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i] || {};
      var blocks = [];
      var text = claudeMessageText(m);
      if (text.trim()) blocks.push({ kind: 'text', text: text });
      var atts = Array.isArray(m.attachments) ? m.attachments : [];
      for (var a = 0; a < atts.length; a++) {
        var att = atts[a] || {};
        blocks.push({
          kind: 'attachment',
          name: typeof att.file_name === 'string' ? att.file_name : 'attachment',
          text: typeof att.extracted_content === 'string' ? att.extracted_content : ''
        });
      }
      var files = Array.isArray(m.files) ? m.files : [];
      for (var f = 0; f < files.length; f++) {
        var fl = files[f] || {};
        blocks.push({ kind: 'file', name: typeof fl.file_name === 'string' ? fl.file_name : 'file' });
      }
      if (!blocks.length) continue;
      messages.push({
        role: m.sender === 'human' ? 'user' : 'assistant',
        time: m.created_at ? Date.parse(m.created_at) || null : null,
        blocks: blocks
      });
    }
    return {
      id: String(conv.uuid || fallbackId),
      provider: 'claude',
      title: (typeof conv.name === 'string' && conv.name.trim()) ? conv.name.trim() : 'Untitled conversation',
      createTime: conv.created_at ? Date.parse(conv.created_at) || null : null,
      updateTime: conv.updated_at ? Date.parse(conv.updated_at) || null : null,
      model: '',
      messages: messages
    };
  }

  function normalizeConversation(conv, fallbackId) {
    var provider = detectProvider(conv);
    if (provider === 'chatgpt') return normalizeChatGPT(conv, fallbackId);
    if (provider === 'claude') return normalizeClaude(conv, fallbackId);
    return null;
  }

  /* ───────────────────────── asset index (ChatGPT ZIPs) ─────────────────────────
   * parts reference images as file-service://file-ABC123 or sediment://file_0000…
   * The bytes live in the ZIP as  file-ABC123-originalname.png  (root),
   * dalle-generations/file-GEN…, "user-<id>/file_…", or <conv-uuid>/audio/….
   */
  function assetKeyFromPointer(pointer) {
    if (typeof pointer !== 'string') return '';
    var key = pointer.replace(/^(file-service:\/\/|sediment:\/\/)/, '');
    if (!key || key.indexOf('..') !== -1 || key.indexOf('/') !== -1 || key.indexOf('\\') !== -1) return '';
    return key;
  }

  function buildAssetIndex(entryNames) {
    var index = { names: [] };
    for (var i = 0; i < entryNames.length; i++) {
      var full = entryNames[i];
      if (full.charAt(full.length - 1) === '/') continue;
      var base = full.substring(full.lastIndexOf('/') + 1);
      if (/^(file[-_])/i.test(base)) index.names.push({ base: base, full: full });
    }
    return index;
  }

  function resolveAsset(pointer, index) {
    var key = assetKeyFromPointer(pointer);
    if (!key || !index) return null;
    var names = index.names;
    var candidate = null;
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (n.base === key) return n.full; /* exact */
      if (n.base.indexOf(key) === 0) {
        var ch = n.base.charAt(key.length);
        if (ch === '-' || ch === '.' || ch === '_' || ch === '') { if (!candidate) candidate = n.full; }
      }
    }
    return candidate;
  }

  function sniffMime(bytes, name) {
    if (bytes && bytes.length > 11) {
      if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
      if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
      if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
      if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
      if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
          bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) return 'audio/wav';
    }
    var ext = (name || '').toLowerCase().replace(/^.*\./, '');
    var map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4' };
    return map[ext] || 'application/octet-stream';
  }

  /* ───────────────────────── search + text extraction ───────────────────────── */

  function conversationText(convo) {
    var out = [convo.title];
    for (var i = 0; i < convo.messages.length; i++) {
      var blocks = convo.messages[i].blocks;
      for (var b = 0; b < blocks.length; b++) {
        var blk = blocks[b];
        if (typeof blk.text === 'string' && blk.text) out.push(blk.text);
        if (typeof blk.name === 'string' && blk.name) out.push(blk.name);
        if (typeof blk.label === 'string' && blk.label) out.push(blk.label);
      }
    }
    return out.join('\n');
  }

  function snippetAround(text, lowerText, lowerQuery, radius) {
    var at = lowerText.indexOf(lowerQuery);
    if (at === -1) return '';
    var start = Math.max(0, at - radius);
    var end = Math.min(text.length, at + lowerQuery.length + radius);
    return (start > 0 ? '…' : '') + text.substring(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
  }

  /* ───────────────────────── Markdown export ───────────────────────── */

  function roleLabel(role, provider) {
    if (role === 'user') return 'You';
    if (role === 'context') return 'Custom instructions';
    return provider === 'claude' ? 'Claude' : 'ChatGPT';
  }

  function formatStamp(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function toMarkdown(convo) {
    var lines = ['# ' + convo.title, ''];
    var meta = [];
    if (convo.provider) meta.push('Provider: ' + (convo.provider === 'claude' ? 'Claude' : 'ChatGPT'));
    if (convo.model) meta.push('Model: ' + convo.model);
    if (convo.createTime) meta.push('Started: ' + formatStamp(convo.createTime));
    if (convo.updateTime) meta.push('Updated: ' + formatStamp(convo.updateTime));
    if (meta.length) { lines.push('> ' + meta.join(' · ')); lines.push(''); }
    for (var i = 0; i < convo.messages.length; i++) {
      var msg = convo.messages[i];
      var stamp = formatStamp(msg.time);
      lines.push('## ' + roleLabel(msg.role, convo.provider) + (stamp ? ' — ' + stamp : ''));
      lines.push('');
      for (var b = 0; b < msg.blocks.length; b++) {
        var blk = msg.blocks[b];
        if (blk.kind === 'text') { lines.push(blk.text); lines.push(''); }
        else if (blk.kind === 'code') { lines.push('```' + (blk.lang && blk.lang !== 'output' ? blk.lang : '')); lines.push(blk.text); lines.push('```'); lines.push(''); }
        else if (blk.kind === 'quote') { lines.push('> ' + (blk.label ? '**' + blk.label + '**: ' : '') + String(blk.text || '').replace(/\n/g, '\n> ')); lines.push(''); }
        else if (blk.kind === 'image') { lines.push('![Image](' + (assetKeyFromPointer(blk.pointer) || 'image-in-export') + ')'); lines.push(''); }
        else if (blk.kind === 'audio') { lines.push('*[Voice clip: ' + (assetKeyFromPointer(blk.pointer) || 'audio-in-export') + ']*'); lines.push(''); }
        else if (blk.kind === 'document') { lines.push('### Canvas: ' + (blk.label || 'Document')); lines.push(''); lines.push(blk.text); lines.push(''); }
        else if (blk.kind === 'context') { lines.push('*' + (blk.label || 'Context') + ':*'); lines.push(''); lines.push(blk.text); lines.push(''); }
        else if (blk.kind === 'attachment') {
          lines.push('**Attachment: ' + blk.name + '**');
          if (blk.text) { lines.push(''); lines.push('```'); lines.push(blk.text); lines.push('```'); }
          lines.push('');
        }
        else if (blk.kind === 'file') { lines.push('*[File: ' + blk.name + ' (binary not included in the export)]*'); lines.push(''); }
      }
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  function safeFileName(title, taken) {
    var base = String(title || 'conversation').replace(/[<>:"/\\|?* -]/g, '').replace(/\s+/g, ' ').trim().substring(0, 80) || 'conversation';
    var name = base, n = 2;
    while (taken && taken[name.toLowerCase()]) { name = base + ' (' + n + ')'; n++; }
    if (taken) taken[name.toLowerCase()] = true;
    return name;
  }

  function formatBytes(bytes) {
    if (bytes >= 1099511627776) return (bytes / 1099511627776).toFixed(2) + ' TB';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
  }

  var Parser = {
    sliceTopLevelJson: sliceTopLevelJson,
    sliceJsonLines: sliceJsonLines,
    firstMeaningfulByte: firstMeaningfulByte,
    detectProvider: detectProvider,
    canonicalNodeIds: canonicalNodeIds,
    isVisibleMessage: isVisibleMessage,
    blocksFromChatGPTMessage: blocksFromChatGPTMessage,
    normalizeChatGPT: normalizeChatGPT,
    normalizeClaude: normalizeClaude,
    normalizeConversation: normalizeConversation,
    assetKeyFromPointer: assetKeyFromPointer,
    buildAssetIndex: buildAssetIndex,
    resolveAsset: resolveAsset,
    sniffMime: sniffMime,
    conversationText: conversationText,
    snippetAround: snippetAround,
    toMarkdown: toMarkdown,
    safeFileName: safeFileName,
    formatBytes: formatBytes
  };

  root.ChatArchiveParser = Parser;

  /* ───────────────────────── Worker glue (browser only) ───────────────────────── */
  var isWorker = typeof importScripts === 'function' && typeof document === 'undefined';
  if (!isWorker) return;

  importScripts('/jszip.min.js');

  var store = {
    zips: [],             /* [{zip, assetIndex}] — kept for lazy asset extraction */
    convos: new Map(),    /* id -> normalized conversation */
    order: []             /* ids in display order */
  };

  var MAX_ZIP_BYTES = 2147483648;      /* 2 GB */
  var MAX_JSON_BYTES = 1610612736;     /* 1.5 GB per conversations file */

  function post(msg, transfer) { self.postMessage(msg, transfer || []); }

  function fail(message) { post({ type: 'error', message: message }); }

  function registerConversation(convo) {
    if (!convo || !convo.messages.length) return false;
    var id = convo.id;
    while (store.convos.has(id)) id = id + '_x';
    convo.id = id;
    store.convos.set(id, convo);
    return true;
  }

  function parseConversationBytes(bytes, sourceName, counters) {
    if (bytes.length > MAX_JSON_BYTES) {
      counters.warnings.push(sourceName + ' is larger than ' + formatBytes(MAX_JSON_BYTES) + ' and was skipped.');
      return;
    }
    var first = firstMeaningfulByte(bytes);
    var slices = first === LBRACKET ? sliceTopLevelJson(bytes) : sliceJsonLines(bytes);
    var decoder = new TextDecoder('utf-8');
    for (var i = 0; i < slices.length; i++) {
      var raw = null;
      try {
        raw = JSON.parse(decoder.decode(bytes.subarray(slices[i][0], slices[i][1])));
      } catch (e) { counters.failed++; continue; }
      var convo = normalizeConversation(raw, sourceName + '-' + i);
      if (convo && registerConversation(convo)) {
        counters.parsed++;
        counters.providers[convo.provider] = (counters.providers[convo.provider] || 0) + 1;
        counters.msgTotal += convo.messages.length;
      } else if (convo) { counters.empty++; }
      else { counters.failed++; }
      if ((i & 63) === 0) post({ type: 'progress', phase: 'parse', done: i + 1, total: slices.length, source: sourceName });
    }
    post({ type: 'progress', phase: 'parse', done: slices.length, total: slices.length, source: sourceName });
  }

  function buildIndexPayload(counters) {
    var ids = Array.from(store.convos.keys());
    ids.sort(function (a, b) {
      var ta = store.convos.get(a).updateTime || store.convos.get(a).createTime || 0;
      var tb = store.convos.get(b).updateTime || store.convos.get(b).createTime || 0;
      return tb - ta;
    });
    store.order = ids;
    var index = [];
    for (var i = 0; i < ids.length; i++) {
      var c = store.convos.get(ids[i]);
      index.push({ id: c.id, title: c.title, provider: c.provider, createTime: c.createTime, updateTime: c.updateTime, msgCount: c.messages.length });
    }
    return { type: 'loaded', index: index, stats: counters };
  }

  function loadOneFile(file, counters) {
    if (file.size > MAX_ZIP_BYTES) {
      counters.warnings.push((file.name || 'file') + ' is ' + formatBytes(file.size) + ' — over the ' + formatBytes(MAX_ZIP_BYTES) + ' limit, skipped. Try a fresh export, or drop its conversations.json on its own.');
      return Promise.resolve();
    }
    var name = (file.name || '').toLowerCase();
    return file.slice(0, 4).arrayBuffer().then(function (head) {
      var h = new Uint8Array(head);
      var isZip = h[0] === 0x50 && h[1] === 0x4B; /* PK */
      if (isZip) {
        post({ type: 'progress', phase: 'unzip', done: 0, total: 1, source: file.name });
        return JSZip.loadAsync(file).then(function (zip) {
          var entryNames = Object.keys(zip.files);
          var assetIndex = buildAssetIndex(entryNames);
          store.zips.push({ zip: zip, assetIndex: assetIndex });
          counters.assets += assetIndex.names.length;
          var convFiles = entryNames.filter(function (n) { return /(^|\/)conversations(-\d+)?\.json(l)?$/i.test(n) && !zip.files[n].dir; }).sort();
          if (!convFiles.length) {
            counters.warnings.push('No conversations.json found inside ' + (file.name || 'the ZIP') + '. Make sure it is the data export from ChatGPT (Settings → Data controls → Export) or Claude (Settings → Privacy → Export data).');
            return null;
          }
          var chain = Promise.resolve();
          convFiles.forEach(function (entry) {
            chain = chain.then(function () {
              post({ type: 'progress', phase: 'read', done: 0, total: 1, source: entry });
              return zip.file(entry).async('uint8array').then(function (bytes) {
                parseConversationBytes(bytes, entry, counters);
              });
            });
          });
          return chain;
        });
      }
      if (/\.(json|jsonl|txt)$/.test(name) || h[0] === LBRACKET || h[0] === LBRACE || h[0] === 0xEF) {
        return file.arrayBuffer().then(function (buf) {
          parseConversationBytes(new Uint8Array(buf), file.name || 'conversations.json', counters);
        });
      }
      counters.warnings.push((file.name || 'One file') + ' is not a ZIP or JSON export — skipped.');
      return null;
    });
  }

  function handleLoad(files) {
    var counters = { parsed: 0, failed: 0, empty: 0, msgTotal: 0, providers: {}, warnings: [], assets: 0 };
    store.zips = []; store.convos = new Map(); store.order = [];
    var list = Array.isArray(files) ? files : [files];
    var chain = Promise.resolve();
    list.forEach(function (f) { chain = chain.then(function () { return loadOneFile(f, counters); }); });
    chain.then(function () {
      if (!store.convos.size) {
        fail(counters.warnings.length ? counters.warnings.join(' ') : 'No conversations could be read from that file. If this is a ChatGPT or Claude export, the format may have changed — the raw JSON is still intact, nothing was modified.');
        return;
      }
      post(buildIndexPayload(counters));
    }).catch(function (err) {
      fail('Could not read the file: ' + (err && err.message ? err.message : 'unknown error') + '. The file was not modified — everything stays on your device.');
    });
  }

  function handleGet(id) {
    var c = store.convos.get(id);
    if (!c) { fail('Conversation not found.'); return; }
    post({ type: 'conversation', conversation: c });
  }

  function handleSearch(query, reqId) {
    var q = String(query || '').toLowerCase().trim();
    var results = [];
    if (q) {
      for (var i = 0; i < store.order.length && results.length < 500; i++) {
        var c = store.convos.get(store.order[i]);
        if (!c._text) { c._text = conversationText(c); c._lower = c._text.toLowerCase(); }
        var at = c._lower.indexOf(q);
        if (at !== -1) results.push({ id: c.id, snippet: snippetAround(c._text, c._lower, q, 60) });
      }
    }
    post({ type: 'results', reqId: reqId, query: query, results: results });
  }

  function handleAsset(pointer) {
    var entryName = null, holder = null;
    for (var i = 0; i < store.zips.length; i++) {
      entryName = resolveAsset(pointer, store.zips[i].assetIndex);
      if (entryName && store.zips[i].zip.file(entryName)) { holder = store.zips[i].zip; break; }
      entryName = null;
    }
    if (!entryName || !holder) { post({ type: 'asset', pointer: pointer, found: false }); return; }
    holder.file(entryName).async('uint8array').then(function (bytes) {
      var mime = sniffMime(bytes, entryName);
      post({ type: 'asset', pointer: pointer, found: true, name: entryName, mime: mime, buffer: bytes.buffer }, [bytes.buffer]);
    }).catch(function () { post({ type: 'asset', pointer: pointer, found: false }); });
  }

  function handleExportAll() {
    var zip = new JSZip();
    var taken = {};
    var n = 0;
    store.order.forEach(function (id) {
      var c = store.convos.get(id);
      zip.file(safeFileName(c.title, taken) + '.md', toMarkdown(c));
      n++;
      if ((n & 127) === 0) post({ type: 'progress', phase: 'export', done: n, total: store.order.length });
    });
    zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }).then(function (buf) {
      post({ type: 'export-all', buffer: buf, count: n }, [buf]);
    }).catch(function (err) { fail('Could not build the Markdown ZIP: ' + (err && err.message ? err.message : 'unknown error')); });
  }

  self.onmessage = function (ev) {
    var msg = ev.data || {};
    try {
      if (msg.type === 'load') handleLoad(msg.files || msg.file);
      else if (msg.type === 'get') handleGet(msg.id);
      else if (msg.type === 'search') handleSearch(msg.query, msg.reqId);
      else if (msg.type === 'asset') handleAsset(msg.pointer);
      else if (msg.type === 'export-all') handleExportAll();
    } catch (err) {
      fail('Unexpected error: ' + (err && err.message ? err.message : 'unknown') + '. Your file was not modified.');
    }
  };
})(typeof self !== 'undefined' ? self : globalThis);
