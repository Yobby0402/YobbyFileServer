import json
import subprocess
import unittest
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
UTILS_PATH = ROOT_DIR / 'static' / 'js' / 'serial_tool_utils.js'
SERIAL_TOOL_PATH = ROOT_DIR / 'static' / 'js' / 'serial_tool.js'
SERIAL_SHARED_PATH = ROOT_DIR / 'static' / 'js' / 'serial_tool_shared.js'


class SerialToolFrontendUtilsTests(unittest.TestCase):
    def run_node(self, expression):
        script = (
            f"const utils = require({json.dumps(str(UTILS_PATH))});"
            f"const result = {expression};"
            "process.stdout.write(JSON.stringify(result));"
        )
        completed = subprocess.run(
            ['node', '-e', script],
            cwd=ROOT_DIR,
            check=True,
            capture_output=True,
            text=True,
            encoding='utf-8',
        )
        return json.loads(completed.stdout)

    def test_parse_hex_bytes_accepts_whitespace(self):
        result = self.run_node(
            "Array.from(utils.parseHexBytes('41 0d' + String.fromCharCode(10) + '0A'))"
        )
        self.assertEqual(result, [0x41, 0x0D, 0x0A])

    def test_parse_hex_bytes_rejects_odd_length(self):
        result = self.run_node(
            "(() => { try { utils.parseHexBytes('ABC'); return null; } "
            "catch (error) { return error.message; } })()"
        )
        self.assertIn('两位十六进制字符', result)

    def test_escape_html_blocks_markup(self):
        result = self.run_node("utils.escapeHtml('<img src=x onerror=alert(1)>')")
        self.assertEqual(result, '&lt;img src=x onerror=alert(1)&gt;')

    def test_port_stats_keep_rx_and_tx_separate(self):
        result = self.run_node(
            "(() => { const stats = utils.createPortStats(123); "
            "utils.addPortBytes(stats, 'rx', 7); utils.addPortBytes(stats, 'tx', 3); "
            "return stats; })()"
        )
        self.assertEqual(result, {'rxBytes': 7, 'txBytes': 3, 'startedAt': 123})

    def test_port_stats_ignore_invalid_counts(self):
        result = self.run_node(
            "(() => { const stats = utils.createPortStats(123); "
            "utils.addPortBytes(stats, 'rx', -5); utils.addPortBytes(stats, 'tx', 'bad'); "
            "return stats; })()"
        )
        self.assertEqual(result, {'rxBytes': 0, 'txBytes': 0, 'startedAt': 123})

    def test_shared_layer_overrides_write_hook_not_send_workflow(self):
        shared_source = SERIAL_SHARED_PATH.read_text(encoding='utf-8')
        self.assertIn('SerialToolApp.prototype.writePortData =', shared_source)
        self.assertNotIn('SerialToolApp.prototype.sendData =', shared_source)
        self.assertNotIn('SerialToolApp.prototype.sendRawBytes =', shared_source)

    def test_shared_layer_has_single_port_list_renderer(self):
        shared_source = SERIAL_SHARED_PATH.read_text(encoding='utf-8')
        self.assertEqual(shared_source.count('SerialToolApp.prototype.renderPortList ='), 1)

    def test_base_send_workflow_uses_write_hook(self):
        source = SERIAL_TOOL_PATH.read_text(encoding='utf-8')
        self.assertIn('async writePortData(portId, portInfo, data)', source)
        self.assertGreaterEqual(source.count('this.writePortData('), 2)

    def test_shared_layer_uses_extension_hooks_for_core_workflows(self):
        base_source = SERIAL_TOOL_PATH.read_text(encoding='utf-8')
        shared_source = SERIAL_SHARED_PATH.read_text(encoding='utf-8')

        self.assertIn('bindAdditionalEvents() {}', base_source)
        self.assertIn('bindSerialSocketFeatureEvents(socket)', base_source)
        self.assertIn('async disconnectPortTransport(portId, portInfo)', base_source)
        self.assertIn('SerialToolApp.prototype.bindAdditionalEvents =', shared_source)
        self.assertIn('SerialToolApp.prototype.bindSerialSocketFeatureEvents =', shared_source)
        self.assertIn('SerialToolApp.prototype.disconnectPortTransport =', shared_source)
        self.assertNotIn('SerialToolApp.prototype.bindEvents =', shared_source)
        self.assertNotIn('SerialToolApp.prototype.connectWebSocket =', shared_source)
        self.assertNotIn('SerialToolApp.prototype.disconnectPort =', shared_source)

    def test_shared_layer_contains_relay_controls(self):
        shared_source = SERIAL_SHARED_PATH.read_text(encoding='utf-8')
        self.assertIn("'start_relay'", shared_source)
        self.assertIn("'stop_relay'", shared_source)
        self.assertIn("socket.on('serial_relays'", shared_source)

    def test_shared_layer_polls_active_capture_logs_into_monitor(self):
        shared_source = SERIAL_SHARED_PATH.read_text(encoding='utf-8')
        self.assertIn('pollSelectedCaptureLog', shared_source)
        self.assertIn('after_seq=${encodeURIComponent(cursor)}', shared_source)
        self.assertIn('await this.selectPort(portId, { resetHistory: true });', shared_source)

    def test_terminal_renderer_keeps_input_after_new_output(self):
        script = f"""
const fs = require('fs');
const vm = require('vm');
class FakeNode {{
    constructor(nodeType = 1, text = '') {{
        this.nodeType = nodeType;
        this._text = text;
        this.children = [];
        this.className = '';
        this.style = {{}};
        this.listeners = {{}};
        this.value = '';
        this.scrollTop = 0;
        this.scrollHeight = 100;
    }}
    addEventListener(name, handler) {{ this.listeners[name] = handler; }}
    focus() {{ global.document.activeElement = this; }}
    setSelectionRange() {{}}
    append(...nodes) {{ nodes.forEach((node) => this.appendChild(node)); }}
    appendChild(node) {{ this.children.push(node); return node; }}
    querySelector(selector) {{
        const className = selector.startsWith('.') ? selector.slice(1) : '';
        for (const child of this.children) {{
            if (child.className === className) return child;
            const nested = child.querySelector ? child.querySelector(selector) : null;
            if (nested) return nested;
        }}
        return null;
    }}
    querySelectorAll(selector) {{
        const result = [];
        const className = selector.startsWith('.') ? selector.slice(1) : '';
        for (const child of this.children) {{
            if (child.className === className) result.push(child);
            if (child.querySelectorAll) result.push(...child.querySelectorAll(selector));
        }}
        return result;
    }}
    set innerHTML(_value) {{ this.children = []; this._text = ''; }}
    get textContent() {{
        if (this.nodeType === 3) return this._text;
        return this.children.map((child) => child.textContent).join('');
    }}
    set textContent(value) {{
        if (this.nodeType === 3) {{ this._text = String(value); return; }}
        this.children = value ? [new FakeNode(3, String(value))] : [];
    }}
}}
const display = new FakeNode();
const input = new FakeNode();
global.document = {{
    activeElement: null,
    getElementById: (id) => id === 'terminalDisplay' ? display : id === 'terminalInput' ? input : null,
    createElement: () => new FakeNode(),
    createTextNode: (text) => new FakeNode(3, String(text)),
    addEventListener: () => {{}},
}};
const source = fs.readFileSync({json.dumps(str(SERIAL_TOOL_PATH))}, 'utf8');
const classSource = source.slice(0, source.indexOf('// 初始化应用'));
vm.runInThisContext(`${{classSource}}\nglobalThis.SerialToolApp = SerialToolApp;`);
const app = Object.create(globalThis.SerialToolApp.prototype);
app.termLineBuffer = 'status';
app.localEcho = true;
app.displayMode = 'terminalRepl';
app.autoScroll = true;
app.resetTerminalDisplay('RX-1\\n');
app.appendToTerminalDisplay('RX-2\\n');
const replResult = {{
    output: display.querySelector('.terminal-output-text').textContent,
    input: display.querySelector('.terminal-input-echo').textContent,
    cursors: display.querySelectorAll('.terminal-cursor').length,
    cursorDisplay: display.querySelector('.terminal-cursor').style.display,
}};
app.displayMode = 'terminal';
app.renderTerminalInputEcho();
replResult.normalCursorDisplay = display.querySelector('.terminal-cursor').style.display;
app.displayMode = 'terminalRepl';
app.termLineBuffer = 'status';
app.currentPort = 'port-1';
const sentBytes = [];
app.sendRawBytes = (bytes) => sentBytes.push(bytes);
app.setupInteractiveTerminal();
const keyEvent = (key, ctrlKey = false) => ({{
    key, ctrlKey, altKey: false, shiftKey: false, metaKey: false,
    preventDefault() {{}}, stopPropagation() {{}},
}});
input.listeners.keydown(keyEvent('d', true));
input.listeners.keydown(keyEvent('Tab'));
replResult.bufferAfterControls = app.termLineBuffer;
replResult.sentBytes = sentBytes;
process.stdout.write(JSON.stringify(replResult));
"""
        completed = subprocess.run(
            ['node', '-e', script],
            cwd=ROOT_DIR,
            check=True,
            capture_output=True,
            text=True,
            encoding='utf-8',
        )
        result = json.loads(completed.stdout)
        self.assertEqual(result['output'], 'RX-1\nRX-2\n')
        self.assertEqual(result['input'], 'status')
        self.assertEqual(result['cursors'], 1)
        self.assertEqual(result['cursorDisplay'], 'inline-block')
        self.assertEqual(result['normalCursorDisplay'], 'none')
        self.assertEqual(result['bufferAfterControls'], 'status\t')
        self.assertEqual(result['sentBytes'], [[0x04]])


if __name__ == '__main__':
    unittest.main()
