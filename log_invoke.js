const fs = require('fs');
const fetch = require('node-fetch');

const csvFile = './metrics.csv';

if (!fs.existsSync(csvFile)) {
    fs.writeFileSync(csvFile, 'function,date,hour,T0,T1,T2,T3,T4,T5,message\n');
}

function getDate() {
    return new Date().toISOString().split('T')[0];
}

function getHour() {
    return new Date().toTimeString().split(' ')[0];
}

function detectBusinessFailure(parsedData, rawResponse, statusMsg) {
    if (parsedData && typeof parsedData === 'object') {
        if (parsedData.success === false || parsedData.ok === false || parsedData.status === false) {
            return true;
        }
        if (parsedData.error != null) {
            return true;
        }
        if (Array.isArray(parsedData.errors) && parsedData.errors.length > 0) {
            return true;
        }
    }

    const combined = `${statusMsg || ''} ${rawResponse || ''}`.toLowerCase();
    return /(error|failed|failure|invalid|unauthorized|forbidden|not found|exception)/.test(combined);
}

async function logFunctionInvoke(funcName, payload) {
    const T0 = Date.now();
    const DATE = getDate();
    const HOUR = getHour();

    let T5;
    let data = {};
    let rawResponse = '';
    let statusMsg = 'No response';
    let functionStatus = 0;
    let statusCode = 'N/A';

    try {
        const res = await fetch(`http://127.0.0.1:8080/function/${funcName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        statusCode = res.status;
        functionStatus = res.ok ? 1 : 0;

        let text;
        try {
            text = await res.text();
            T5 = Date.now();
            try {
                data = JSON.parse(text);
                rawResponse = text;
                statusMsg = data.message || data.error || text;
            } catch {
                rawResponse = text;
                statusMsg = text;
            }
        } catch (err) {
            console.error('Fetch error:', err);
            T5 = Date.now();
            statusMsg = err.message;
        }

        // Treat business-level failures as unsuccessful even when HTTP status is 2xx.
        if (functionStatus === 1 && detectBusinessFailure(data, rawResponse, statusMsg)) {
            functionStatus = 0;
        }

    } catch (err) {
        console.error('Fetch error:', err);
        T5 = Date.now();
    }

    const T4 = data.T4 || 'N/A';
    const T1 = 'N/A';
    const T2 = 'N/A';
    const T3 = 'N/A';

    const row =
        `${funcName},${DATE},${HOUR},${T0},${T1},${T2},${T3},${T4},${T5},"${statusMsg}"`;

    fs.appendFileSync(csvFile, row + '\n');

    console.log(`Logged metrics for ${funcName} → ${statusMsg}`);
    return {
        output: Object.keys(data).length ? data : rawResponse,
        functionStatus,
        statusCode,
        statusMessage: statusMsg,
        invokedFunction: funcName,
        invokedAt: T5
    };
}

module.exports = { logFunctionInvoke };
