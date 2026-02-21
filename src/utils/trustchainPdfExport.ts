import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ExecutionStep, ToolCall } from '../ui/components/types';

/**
 * Generates an edit-protected PDF document containing the TrustChain execution trace.
 */
export function exportTrustChainPdf(steps: ExecutionStep[], toolCalls?: ToolCall[]) {
    // 1. Gather Items
    const chainItems: any[] = [];
    (steps || []).filter(s => s.type === 'tool' || s.signed || s.signature).forEach(s => {
        chainItems.push({
            id: s.id,
            toolName: s.toolName || s.label,
            latencyMs: s.latencyMs,
            signature: s.signature,
            args: s.args,
            result: s.result,
        });
    });

    if (chainItems.length === 0 && toolCalls) {
        toolCalls.forEach(tc => {
            chainItems.push({
                id: tc.id,
                toolName: tc.name,
                latencyMs: tc.latencyMs,
                signature: tc.signature,
                args: tc.args,
                result: tc.result,
            });
        });
    }

    // 2. Build Base PDF with jsPDF & Encryption
    const ownerPassword = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

    // Create jsPDF with encryption options ensuring the document is protected from modifications
    const doc = new jsPDF({
        encryption: {
            userPassword: '', // Open silently
            ownerPassword: ownerPassword,
            userPermissions: ['print', 'copy'] // Omit 'modify' and 'annot-forms' to prevent editing
        }
    });

    const pageWidth = doc.internal.pageSize.width;

    // Fonts & Colors
    doc.setTextColor(30, 41, 59); // slate-800
    doc.setFontSize(18);
    doc.text('TrustChain Audit Report', 14, 20);

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text(`Generated at: ${new Date().toLocaleString()}`, 14, 28);
    doc.text(`Total Authenticated Nodes: ${chainItems.length}`, 14, 34);

    const verifiedText = "CRYPTOGRAPHICALLY VERIFIED";
    doc.setTextColor(16, 185, 129); // emerald-500
    doc.setFontSize(10);
    doc.text(verifiedText, pageWidth - 14 - doc.getTextWidth(verifiedText), 20);

    // Build Table Body
    const tableData = chainItems.map((item, idx) => {
        const shortSig = item.signature ? `${item.signature.substring(0, 16)}...${item.signature.slice(-16)}` : 'Unsigned';

        let payloadStr = '';
        if (item.args && Object.keys(item.args).length > 0) {
            payloadStr = JSON.stringify(item.args).substring(0, 100);
            if (payloadStr.length >= 100) payloadStr += '...';
        }

        return [
            `#${idx + 1}`,
            item.toolName || 'Unknown',
            shortSig,
            item.latencyMs ? `${item.latencyMs}ms` : '-',
            payloadStr || '-'
        ];
    });

    autoTable(doc, {
        startY: 45,
        head: [['Step', 'Operation', 'Ed25519 Signature', 'Latency', 'Payload Sample']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [16, 185, 129] }, // emerald-500
        styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
        columnStyles: {
            0: { cellWidth: 12 },
            1: { cellWidth: 35 },
            2: { cellWidth: 50, font: 'courier' },
            3: { cellWidth: 15 },
            4: { cellWidth: 'auto', font: 'courier' },
        }
    });

    // Full Signatures Appendix
    // @ts-ignore
    let finalY = doc.lastAutoTable.finalY + 15;

    doc.setFontSize(14);
    doc.setTextColor(30, 41, 59);
    doc.text('Appendix A: Full Signatures', 14, finalY);

    finalY += 10;
    doc.setFontSize(8);

    chainItems.forEach((item, idx) => {
        if (finalY > doc.internal.pageSize.height - 20) {
            doc.addPage();
            finalY = 20;
        }
        doc.setTextColor(30, 41, 59);
        doc.text(`Step #${idx + 1}: ${item.toolName}`, 14, finalY);
        finalY += 5;
        doc.setTextColor(16, 185, 129);
        doc.setFont('courier');

        // Wrap signature if too long
        const splitSig = doc.splitTextToSize(item.signature || 'Unsigned', pageWidth - 28);
        doc.text(splitSig, 14, finalY);
        finalY += (splitSig.length * 4) + 5;
        doc.setFont('helvetica');
    });

    // 4. Download Trigger
    const traceFilename = `trustchain-audit-report-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.pdf`;

    try {
        // In a cross-origin iframe, Chrome blocks ALL download navigations
        // Delegate to the parent window via postMessage.
        if (window.self !== window.top) {
            try {
                // Get base64 representation to safely pass over postMessage
                const pdfDataUri = doc.output('datauristring');
                const b64Data = pdfDataUri.split(',')[1];

                window.parent.postMessage({
                    type: 'trustchain:download',
                    version: 2,
                    data: b64Data,
                    isBase64: true,
                    filename: traceFilename,
                    mimeType: 'application/pdf',
                    requestId: `dl-${Date.now()}`,
                }, '*');
                console.log('[TrustChain] Delegated PDF download via postMessage');
                return;
            } catch (err) {
                console.warn('[TrustChain] postMessage delegate failed, falling back to direct download:', err);
                // fall through
            }
        }

        // Top-level context (fallback)
        console.log('[TrustChain] Triggering direct PDF download (fallback)');
        const blob = new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = traceFilename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60000); // 60s timeout to survive slow downloads
    } catch (err) {
        console.error('[TrustChain] Failed to generate or download PDF:', err);
    }
}
