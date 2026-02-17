/**
 * PythonArtifactRenderer — Executable Python terminal in artifacts
 * 
 * Uses Pyodide (Python compiled to WebAssembly) to execute Python code
 * directly in the browser. Renders with a split-pane: code editor (top)
 * and terminal output (bottom).
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { ArtifactContent } from '../../services/artifacts/types';
import { Play, Square, Terminal, Copy, Check } from 'lucide-react';

interface PythonArtifactRendererProps {
    artifact: ArtifactContent;
}

/** Extract Python code from HTML artifact or raw code content */
function extractPythonCode(content: string): string {
    // If HTML, extract from <code> or <pre> tags
    const codeMatch = content.match(/<code[^>]*>([\s\S]*?)<\/code>/i)
        || content.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (codeMatch) {
        return codeMatch[1]
            .replace(/<[^>]+>/g, '')           // strip HTML tags
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
    }
    return content.trim();
}

/** Build the Pyodide iframe srcdoc HTML */
function buildPyodideHTML(code: string): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace;
        background: #1a1b26;
        color: #a9b1d6;
        height: 100vh;
        display: flex;
        flex-direction: column;
    }
    
    /* ── Code Editor Pane ── */
    .editor-pane {
        flex: 0 0 auto;
        background: #1e1f2e;
        border-bottom: 1px solid #2f3348;
        position: relative;
    }
    .editor-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 12px;
        background: #16171f;
        border-bottom: 1px solid #2f3348;
        font-size: 11px;
        color: #565f89;
    }
    .editor-header .lang { color: #7aa2f7; font-weight: 600; }
    .editor-header .dots {
        display: flex; gap: 5px;
    }
    .editor-header .dots span {
        width: 8px; height: 8px; border-radius: 50%;
    }
    .dot-red { background: #f7768e; }
    .dot-yellow { background: #e0af68; }
    .dot-green { background: #9ece6a; }
    
    #code-editor {
        width: 100%;
        min-height: 80px;
        max-height: 300px;
        background: transparent;
        color: #c0caf5;
        border: none;
        outline: none;
        resize: vertical;
        padding: 12px 14px;
        font-family: inherit;
        font-size: 13px;
        line-height: 1.6;
        tab-size: 4;
    }
    
    /* ── Terminal Pane ── */
    .terminal-pane {
        flex: 1;
        background: #0f0f14;
        display: flex;
        flex-direction: column;
        min-height: 120px;
    }
    .terminal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 5px 12px;
        background: #16171f;
        border-bottom: 1px solid #2f3348;
        font-size: 11px;
        color: #565f89;
    }
    .terminal-header .title {
        display: flex; align-items: center; gap: 6px;
    }
    .terminal-header .title svg { color: #9ece6a; }
    
    #terminal-output {
        flex: 1;
        padding: 10px 14px;
        overflow-y: auto;
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-all;
    }
    
    .output-line { margin-bottom: 2px; }
    .output-stdout { color: #c0caf5; }
    .output-stderr { color: #f7768e; }
    .output-result { color: #9ece6a; }
    .output-system { color: #565f89; font-style: italic; }
    .output-prompt { color: #7aa2f7; }
    
    /* ── Toolbar ── */
    .toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: #16171f;
        border-top: 1px solid #2f3348;
    }
    
    .btn {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 5px 12px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
        font-family: inherit;
    }
    .btn-run {
        background: #9ece6a;
        color: #1a1b26;
    }
    .btn-run:hover { background: #b4e88d; }
    .btn-run:disabled { opacity: 0.5; cursor: not-allowed; }
    
    .btn-stop {
        background: #f7768e;
        color: #1a1b26;
    }
    .btn-stop:hover { background: #ff9eb0; }
    
    .btn-clear {
        background: transparent;
        color: #565f89;
        border: 1px solid #2f3348;
    }
    .btn-clear:hover { border-color: #565f89; color: #a9b1d6; }
    
    .status {
        flex: 1;
        text-align: right;
        font-size: 11px;
        color: #565f89;
    }
    .status.loading { color: #e0af68; }
    .status.ready { color: #9ece6a; }
    .status.running { color: #7aa2f7; }
    .status.error { color: #f7768e; }
    
    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #2f3348; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #3b4261; }
</style>
</head>
<body>
    <!-- Code Editor -->
    <div class="editor-pane">
        <div class="editor-header">
            <div class="dots">
                <span class="dot-red"></span>
                <span class="dot-yellow"></span>
                <span class="dot-green"></span>
            </div>
            <span class="lang">Python 3.11 (Pyodide)</span>
        </div>
        <textarea id="code-editor" spellcheck="false">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
    </div>
    
    <!-- Terminal Output -->
    <div class="terminal-pane">
        <div class="terminal-header">
            <div class="title">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>
                </svg>
                Terminal
            </div>
        </div>
        <div id="terminal-output">
            <div class="output-line output-system">⏳ Loading Python runtime (Pyodide)...</div>
        </div>
    </div>
    
    <!-- Toolbar -->
    <div class="toolbar">
        <button class="btn btn-run" id="btn-run" disabled onclick="runCode()">▶ Run</button>
        <button class="btn btn-clear" onclick="clearOutput()">Clear</button>
        <div class="status loading" id="status">Loading Pyodide...</div>
    </div>

<script src="https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js"></script>
<script>
let pyodide = null;

const terminal = document.getElementById('terminal-output');
const btnRun = document.getElementById('btn-run');
const statusEl = document.getElementById('status');

function appendOutput(text, cls = 'output-stdout') {
    const line = document.createElement('div');
    line.className = 'output-line ' + cls;
    line.textContent = text;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

function clearOutput() {
    terminal.innerHTML = '';
}

async function initPyodide() {
    try {
        pyodide = await loadPyodide();
        // Redirect stdout/stderr
        pyodide.runPython(\`
import sys
from io import StringIO

class OutputCapture:
    def __init__(self, stream_name):
        self.stream_name = stream_name
        self.buffer = []
    def write(self, text):
        if text.strip():
            self.buffer.append(text)
        return len(text)
    def flush(self):
        pass
    def get_output(self):
        out = ''.join(self.buffer)
        self.buffer = []
        return out

sys.stdout = OutputCapture('stdout')
sys.stderr = OutputCapture('stderr')
\`);
        clearOutput();
        appendOutput('>>> Python 3.11 ready (Pyodide WebAssembly)', 'output-system');
        appendOutput('>>> Type code above and press ▶ Run', 'output-system');
        appendOutput('', 'output-system');
        
        btnRun.disabled = false;
        statusEl.textContent = 'Ready';
        statusEl.className = 'status ready';
    } catch (e) {
        appendOutput('❌ Failed to load Pyodide: ' + e.message, 'output-stderr');
        statusEl.textContent = 'Error';
        statusEl.className = 'status error';
    }
}

async function runCode() {
    if (!pyodide) return;
    
    const code = document.getElementById('code-editor').value;
    if (!code.trim()) return;
    
    btnRun.disabled = true;
    statusEl.textContent = 'Running...';
    statusEl.className = 'status running';
    
    appendOutput('>>> ' + code.split('\\n')[0] + (code.includes('\\n') ? ' ...' : ''), 'output-prompt');
    
    try {
        const result = pyodide.runPython(code);
        
        // Get captured stdout
        const stdout = pyodide.runPython("sys.stdout.get_output()");
        if (stdout) {
            stdout.split('\\n').forEach(line => {
                if (line) appendOutput(line, 'output-stdout');
            });
        }
        
        // Get captured stderr
        const stderr = pyodide.runPython("sys.stderr.get_output()");
        if (stderr) {
            stderr.split('\\n').forEach(line => {
                if (line) appendOutput(line, 'output-stderr');
            });
        }
        
        // Show return value if not None
        if (result !== undefined && result !== null && String(result) !== 'None') {
            appendOutput(String(result), 'output-result');
        }
        
        appendOutput('', 'output-system');
        statusEl.textContent = 'Done';
        statusEl.className = 'status ready';
    } catch (e) {
        appendOutput(e.message, 'output-stderr');
        statusEl.textContent = 'Error';
        statusEl.className = 'status error';
    }
    
    btnRun.disabled = false;
}

// Handle Ctrl+Enter to run
document.getElementById('code-editor').addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runCode();
    }
    // Tab support
    if (e.key === 'Tab') {
        e.preventDefault();
        const start = this.selectionStart;
        const end = this.selectionEnd;
        this.value = this.value.substring(0, start) + '    ' + this.value.substring(end);
        this.selectionStart = this.selectionEnd = start + 4;
    }
});

initPyodide();
<\/script>
</body>
</html>`;
}

export const PythonArtifactRenderer: React.FC<PythonArtifactRendererProps> = ({ artifact }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const code = extractPythonCode(artifact.content);
    const [copied, setCopied] = useState(false);

    const copyCode = useCallback(() => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [code]);

    return (
        <div className="artifact-renderer artifact-python flex flex-col h-full">
            <div className="flex items-center justify-between px-4 py-2 border-b tc-border">
                <div className="flex items-center gap-2">
                    <Terminal size={14} className="text-emerald-500" />
                    <span className="text-xs font-mono tc-text">{artifact.filename}</span>
                    <span className="text-[10px] tc-text-muted">({artifact.size} bytes)</span>
                </div>
                <button
                    onClick={copyCode}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] tc-text-muted hover:tc-text rounded transition-colors tc-surface-hover"
                >
                    {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>
            <iframe
                ref={iframeRef}
                className="flex-1 w-full border-0"
                style={{ minHeight: '450px' }}
                title={`Python: ${artifact.filename}`}
                sandbox="allow-scripts allow-same-origin"
                srcDoc={buildPyodideHTML(code)}
            />
        </div>
    );
};
