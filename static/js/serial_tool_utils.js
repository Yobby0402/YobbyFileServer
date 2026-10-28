(function initSerialToolUtils(root, factory) {
    const utils = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = utils;
    }
    root.SerialToolUtils = utils;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createSerialToolUtils() {
    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function parseHexBytes(value) {
        const hex = String(value ?? '').replace(/\s+/g, '');
        if (!hex) {
            throw new Error('请输入要发送的数据');
        }
        if (!/^[0-9A-Fa-f]+$/.test(hex)) {
            throw new Error('HEX 格式错误，请只输入十六进制字符');
        }
        if (hex.length % 2 !== 0) {
            throw new Error('HEX 格式错误，每个字节必须包含两位十六进制字符');
        }

        const bytes = new Uint8Array(hex.length / 2);
        for (let index = 0; index < hex.length; index += 2) {
            bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
        }
        return bytes;
    }

    function createPortStats(startedAt = Date.now()) {
        return { rxBytes: 0, txBytes: 0, startedAt };
    }

    function addPortBytes(stats, direction, byteCount) {
        const target = stats || createPortStats();
        const count = Number.isFinite(Number(byteCount)) ? Math.max(0, Number(byteCount)) : 0;
        if (direction === 'rx') {
            target.rxBytes += count;
        } else if (direction === 'tx') {
            target.txBytes += count;
        }
        return target;
    }

    return { escapeHtml, parseHexBytes, createPortStats, addPortBytes };
});
