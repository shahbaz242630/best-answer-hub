(function() {
  function init() {
    if (typeof marked === 'undefined' || typeof hljs === 'undefined') {
      setTimeout(init, 50);
      return;
    }
    run();
  }
  init();

  function run() {
    const editor = document.getElementById('md-editor');
    const preview = document.getElementById('md-preview');
    const statusEl = document.getElementById('md-status');
    const wordcountEl = document.getElementById('md-wordcount');
    const readingtimeEl = document.getElementById('md-readingtime');
    const charsEl = document.getElementById('md-chars');

    const STORAGE_KEY = 'bae-md-editor-content';
    const SAMPLE = '# Hello World\n\nThis is a **live** Markdown editor with GitHub-flavored preview.\n\n## Features\n\n- Split-pane layout\n- Syntax highlighting\n- Tables & task lists\n- Auto-save to localStorage\n\n## Code Example\n\n```javascript\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}\n```\n\n## Task List\n\n- [x] Write Markdown\n- [x] Preview instantly\n- [ ] Export to HTML\n\n> Tip: Drag and drop a .md file onto the editor to open it.\n';

    // Configure marked
    const renderer = new marked.Renderer();
    renderer.code = function({ text, lang, escaped }) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      const highlighted = hljs.highlight(text, { language }).value;
      return '<pre class="hljs"><code class="language-' + language + '">' + highlighted + '</code></pre>';
    };
    marked.use({ renderer });
    marked.setOptions({
      gfm: true,
      breaks: false,
      headerIds: true,
      mangle: false,
    });

    // Load from storage or sample
    const saved = localStorage.getItem(STORAGE_KEY);
    editor.value = saved || SAMPLE;

    function updateStats() {
      const text = editor.value || '';
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const chars = text.length;
      const minutes = Math.max(1, Math.round(words / 200));
      wordcountEl.textContent = words + ' word' + (words !== 1 ? 's' : '');
      readingtimeEl.textContent = minutes + ' min read';
      charsEl.textContent = chars + ' char' + (chars !== 1 ? 's' : '');
    }

    function renderPreview() {
      const raw = editor.value || '';
      if (!raw.trim()) {
        preview.innerHTML = '<p class="text-sm text-bae-muted italic">Start typing to see the preview.</p>';
        updateStats();
        return;
      }
      const html = marked.parse(raw);
      preview.innerHTML = '<div class="markdown-body">' + html + '</div>';
      updateStats();
    }

    // Auto-save
    let saveTimer;
    editor.addEventListener('input', function() {
      renderPreview();
      statusEl.textContent = 'Saving…';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function() {
        localStorage.setItem(STORAGE_KEY, editor.value);
        statusEl.textContent = 'Saved locally';
      }, 800);
    });

    // Sync scroll (percentage based)
    let syncing = false;
    editor.addEventListener('scroll', function() {
      if (syncing) return;
      syncing = true;
      const pct = editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
      preview.scrollTop = pct * (preview.scrollHeight - preview.clientHeight);
      syncing = false;
    });
    preview.addEventListener('scroll', function() {
      if (syncing) return;
      syncing = true;
      const pct = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
      editor.scrollTop = pct * (editor.scrollHeight - editor.clientHeight);
      syncing = false;
    });

    // Toolbar actions
    function wrapSelection(before, after, placeholder) {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const value = editor.value;
      const selected = value.substring(start, end);
      const replacement = before + (selected || placeholder) + after;
      editor.value = value.substring(0, start) + replacement + value.substring(end);
      editor.selectionStart = start + before.length;
      editor.selectionEnd = start + before.length + (selected ? selected.length : placeholder.length);
      editor.focus();
      editor.dispatchEvent(new Event('input'));
    }

    function insertAtCursor(text) {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const value = editor.value;
      editor.value = value.substring(0, start) + text + value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + text.length;
      editor.focus();
      editor.dispatchEvent(new Event('input'));
    }

    function prependLine(prefix) {
      const start = editor.selectionStart;
      const value = editor.value;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      editor.value = value.substring(0, lineStart) + prefix + value.substring(lineStart);
      editor.selectionStart = editor.selectionEnd = lineStart + prefix.length;
      editor.focus();
      editor.dispatchEvent(new Event('input'));
    }

    function getHeadingLevel() {
      const start = editor.selectionStart;
      const value = editor.value;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = value.indexOf('\n', lineStart);
      const line = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);
      const match = line.match(/^(#{1,6})\s/);
      return match ? match[1].length : 0;
    }

    function setHeading(level) {
      const start = editor.selectionStart;
      const value = editor.value;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = value.indexOf('\n', lineStart);
      const line = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);
      const currentLevel = getHeadingLevel();
      let newLine;
      if (currentLevel === level) {
        newLine = line.replace(/^#{1,6}\s*/, '');
      } else {
        newLine = '#'.repeat(level) + ' ' + line.replace(/^#{1,6}\s*/, '');
      }
      editor.value = value.substring(0, lineStart) + newLine + value.substring(lineEnd === -1 ? value.length : lineEnd);
      editor.selectionStart = editor.selectionEnd = lineStart + newLine.length;
      editor.focus();
      editor.dispatchEvent(new Event('input'));
    }

    const actions = {
      bold: () => wrapSelection('**', '**', 'bold text'),
      italic: () => wrapSelection('*', '*', 'italic text'),
      heading1: () => setHeading(1),
      heading2: () => setHeading(2),
      heading3: () => setHeading(3),
      link: () => wrapSelection('[', '](https://example.com)', 'link text'),
      image: () => insertAtCursor('\n![alt text](https://example.com/image.png)\n'),
      code: () => wrapSelection('`', '`', 'code'),
      quote: () => prependLine('> '),
      ul: () => prependLine('- '),
      ol: () => prependLine('1. '),
      table: () => insertAtCursor('\n| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |\n'),
      hr: () => insertAtCursor('\n---\n'),
      toc: () => {
        const text = editor.value;
        const lines = text.split('\n');
        const toc = [];
        lines.forEach(line => {
          const match = line.match(/^(#{1,6})\s+(.+)/);
          if (match) {
            const level = match[1].length;
            const title = match[2].trim();
            const slug = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
            toc.push('  '.repeat(level - 1) + '- [' + title + '](#' + slug + ')');
          }
        });
        if (toc.length) {
          insertAtCursor('## Table of Contents\n\n' + toc.join('\n') + '\n\n');
        }
      },
    };

    document.querySelectorAll('.md-tool-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const action = this.dataset.action;
        if (actions[action]) actions[action]();
      });
    });

    // Keyboard shortcuts
    editor.addEventListener('keydown', function(e) {
      if (e.ctrlKey || e.metaKey) {
        switch(e.key.toLowerCase()) {
          case 'b': e.preventDefault(); actions.bold(); break;
          case 'i': e.preventDefault(); actions.italic(); break;
          case 'k': e.preventDefault(); actions.link(); break;
        }
      }
    });

    // Clear
    document.getElementById('md-clear').addEventListener('click', function() {
      if (confirm('Clear the editor? Your content will be removed from localStorage.')) {
        editor.value = '';
        localStorage.removeItem(STORAGE_KEY);
        renderPreview();
        statusEl.textContent = 'Cleared';
      }
    });

    // Open file
    document.getElementById('md-open').addEventListener('click', function() {
      document.getElementById('md-file-input').click();
    });

    document.getElementById('md-file-input').addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 1024 * 1024) {
        alert('File must be under 1 MB');
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = function(ev) {
        editor.value = ev.target.result;
        renderPreview();
        statusEl.textContent = 'File loaded';
      };
      reader.readAsText(file);
    });

    // Drag and drop
    editor.addEventListener('dragover', function(e) { e.preventDefault(); editor.classList.add('ring-2', 'ring-bae-primary'); });
    editor.addEventListener('dragleave', function() { editor.classList.remove('ring-2', 'ring-bae-primary'); });
    editor.addEventListener('drop', function(e) {
      e.preventDefault();
      editor.classList.remove('ring-2', 'ring-bae-primary');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (file.size > 1024 * 1024) {
        alert('File must be under 1 MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = function(ev) {
        editor.value = ev.target.result;
        renderPreview();
        statusEl.textContent = 'File loaded';
      };
      reader.readAsText(file);
    });

    // Copy HTML
    document.getElementById('md-copy-html').addEventListener('click', function() {
      const html = preview.querySelector('.markdown-body');
      const text = html ? html.innerHTML : '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    });

    // Download Markdown
    document.getElementById('md-dl-md').addEventListener('click', function() {
      const blob = new Blob([editor.value], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'document.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    // Download HTML
    document.getElementById('md-dl-html').addEventListener('click', function() {
      const body = preview.querySelector('.markdown-body');
      const html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>Exported Markdown</title>\n<link rel="stylesheet" href="/github-markdown.min.css">\n<link rel="stylesheet" href="/github-highlight.min.css">\n<style>body{padding:2rem;background:#fff;}</style>\n</head>\n<body class="markdown-body">\n' + (body ? body.innerHTML : '') + '\n</body>\n</html>';
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'document.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    // Initial render
    renderPreview();
    statusEl.textContent = 'Saved locally';
  }
})();
