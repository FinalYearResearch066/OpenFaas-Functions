#!/usr/bin/env node
const axios = require('axios');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { logFunctionInvoke } = require('./log_invoke');

// Configuration
const AI_SERVICE_URL = "http://127.0.0.1:8000/predict";
const examplesPath = path.join(__dirname, 'function_input_examples.json');
const WARMUP_SUPPRESSION_MS = 5 * 60 * 1000;
const IO_LOG_PATH = path.join(__dirname, 'manual_invoke_io_log2.csv');
let inputExamples = {};

function stripAnsi(text) {
    return String(text).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function toLogText(value) {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch (e) {
        return String(value);
    }
}

function escapeCsv(value) {
    return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
}

function ensureIoLogHeader() {
    if (!fs.existsSync(IO_LOG_PATH)) {
        fs.writeFileSync(IO_LOG_PATH, 'timestamp,type,message\n');
    }
}

function appendIoLog(type, message) {
    ensureIoLogHeader();
    const row = [
        escapeCsv(new Date().toISOString()),
        escapeCsv(type),
        escapeCsv(stripAnsi(message))
    ].join(',');
    fs.appendFileSync(IO_LOG_PATH, row + '\n');
}

const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);

console.log = (...args) => {
    const line = args.map(toLogText).join(' ');
    appendIoLog('output', line);
    originalConsoleLog(...args);
};

console.error = (...args) => {
    const line = args.map(toLogText).join(' ');
    appendIoLog('error', line);
    originalConsoleError(...args);
};

try { 
    inputExamples = JSON.parse(fs.readFileSync(examplesPath, 'utf8')); 
} catch (e) {
    console.log("⚠️ No input examples found.");
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, (answer) => {
    appendIoLog('input', `${q}${answer}`);
    res(answer);
}));

let currentUserId = "1"; // Default User
const functionActivityHistory = new Map();

function recordFunctionActivity(funcName) {
    functionActivityHistory.set(funcName, Date.now());
}

function getRecentFunctionActivity() {
    return Array.from(functionActivityHistory.entries()).map(([funcName, lastInvokedAt]) => ({
        functionName: funcName,
        lastInvokedAt
    }));
}

function getWarmupEligibility(funcName) {
    const lastInvokedAt = functionActivityHistory.get(funcName);
    if (!lastInvokedAt) {
        return {
            eligible: true,
            reason: 'not invoked yet'
        };
    }

    const ageMs = Date.now() - lastInvokedAt;
    if (ageMs >= WARMUP_SUPPRESSION_MS) {
        return {
            eligible: true,
            reason: `last used ${Math.round(ageMs / 60000)}m ago`
        };
    }

    return {
        eligible: false,
        reason: `recently used ${Math.round(ageMs / 1000)}s ago`
    };
}

function clonePayload(payload) {
    return JSON.parse(JSON.stringify(payload || {}));
}

function getDefaultPayload(funcName) {
    const examples = inputExamples[funcName];
    if (Array.isArray(examples) && examples.length > 0) {
        return clonePayload(examples[0]);
    }
    return {};
}

function getWarmupCandidateFunctions(aiRes, limit = 2) {
    const candidates = [];

    if (aiRes && Array.isArray(aiRes.warmup_candidates)) {
        aiRes.warmup_candidates.forEach((item) => {
            if (item && item.function) candidates.push(String(item.function));
        });
    }

    extractTopConfidentFunctions(aiRes, limit).forEach((item) => {
        if (item && item.function) candidates.push(String(item.function));
    });

    const unique = [];
    const seen = new Set();
    for (const funcName of candidates) {
        if (!seen.has(funcName)) {
            seen.add(funcName);
            unique.push(funcName);
        }
        if (unique.length >= limit) break;
    }

    return unique;
}

async function triggerEligibleWarmups(aiRes, currentFunctionName) {
    if (!aiRes) return [];

    const candidates = getWarmupCandidateFunctions(aiRes, 2)
        .filter((funcName) => funcName !== currentFunctionName);
    const decisions = [];

    if (candidates.length === 0) {
        console.log('\x1b[90m[Warm-up] No eligible candidates found from AI response.\x1b[0m');
        return decisions;
    }

    for (const warmupFunc of candidates) {
        const eligibility = getWarmupEligibility(warmupFunc);
        if (!eligibility.eligible) {
            console.log(`\x1b[90m[Warm-up] Skipped ${warmupFunc}: ${eligibility.reason}.\x1b[0m`);
            decisions.push({
                functionName: warmupFunc,
                eligible: false,
                warmedUp: false,
                reason: eligibility.reason
            });
            continue;
        }

        const warmupPayload = getDefaultPayload(warmupFunc);
        console.log(`\x1b[35m[Warm-up] Invoking ${warmupFunc} (${eligibility.reason})...\x1b[0m`);
        const warmupResult = await logFunctionInvoke(warmupFunc, warmupPayload);
        recordFunctionActivity(warmupFunc);
        console.log(`\x1b[35m[Warm-up] ${warmupFunc} completed with status ${warmupResult.functionStatus === 1 ? 'Success' : 'Failed'}.\x1b[0m`);

        decisions.push({
            functionName: warmupFunc,
            eligible: true,
            warmedUp: true,
            reason: eligibility.reason,
            status: warmupResult.functionStatus === 1 ? 'Success' : 'Failed'
        });
    }

    decisions.forEach((d) => {
        console.log(`[Warm-up Decision] function=${d.functionName} eligible=${d.eligible ? 'YES' : 'NO'} warmed_up=${d.warmedUp ? 'YES' : 'NO'} reason=${d.reason}${d.status ? ` status=${d.status}` : ''}`);
    });

    return decisions;
}

//send function details to AI service and get predictions
async function callAIService(funcName, userId, functionStatus, functionDetails = {}) {
    try {
        const normalizedStatus = functionStatus === 1 ? 1 : 0;
        const res = await axios.post(AI_SERVICE_URL, {
            function: funcName,
            user: String(userId),
            function_status: normalizedStatus,
            functionStatus: normalizedStatus,
            function_details: functionDetails,
            timestamp: Date.now()
        }, { timeout: 3000 });
        return res.data;
    } catch (e) {
        return null;
    }
}

// Extract the selected warm-up function from AI response using multiple possible keys
function extractLoginBody(result) {
    const normalizedResult =
        result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'output')
            ? result.output
            : result;

    if (!normalizedResult) return null;
    if (typeof normalizedResult === 'object' && normalizedResult.user) return normalizedResult;
    if (typeof normalizedResult === 'object' && typeof normalizedResult.body === 'string') {
        try { return JSON.parse(normalizedResult.body); } catch (e) { return null; }
    }
    return null;
}

function toPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "N/A";
    const normalized = num > 1 ? num : num * 100;
    return `${normalized.toFixed(2)}%`;
}

function extractTopConfidentFunctions(aiRes, limit = 2) {
    const candidates = [];

    if (aiRes && typeof aiRes === 'object') {
        if (Array.isArray(aiRes.top2_predictions)) {
            candidates.push(...aiRes.top2_predictions);
        }

        if (Array.isArray(aiRes.top2_functions) && Array.isArray(aiRes.top2_values)) {
            const pairedCount = Math.min(aiRes.top2_functions.length, aiRes.top2_values.length);
            for (let i = 0; i < pairedCount; i += 1) {
                candidates.push({
                    function: aiRes.top2_functions[i],
                    confidence: aiRes.top2_values[i]
                });
            }
        }

        if (Array.isArray(aiRes.top_confident_functions)) {
            candidates.push(...aiRes.top_confident_functions);
        }

        if (Array.isArray(aiRes.top_functions)) {
            candidates.push(...aiRes.top_functions);
        }

        if (Array.isArray(aiRes.confidences)) {
            candidates.push(...aiRes.confidences);
        }

        const confidenceMap = aiRes.function_confidences || aiRes.confidence_by_function || aiRes.probabilities;
        if (confidenceMap && typeof confidenceMap === 'object' && !Array.isArray(confidenceMap)) {
            Object.entries(confidenceMap).forEach(([func, score]) => {
                candidates.push({ function: func, confidence: score });
            });
        }
    }

    const normalized = candidates
        .map((item) => {
            if (!item) return null;

            if (Array.isArray(item) && item.length >= 2) {
                return {
                    function: String(item[0]),
                    confidence: Number(item[1])
                };
            }

            if (typeof item === 'object') {
                const func = item.function || item.func || item.name || item.label || item.prediction;
                const score =
                    item.confidence !== undefined ? item.confidence :
                    item.score !== undefined ? item.score :
                    item.probability !== undefined ? item.probability :
                    item.value;

                if (func != null && score != null) {
                    return {
                        function: String(func),
                        confidence: Number(score)
                    };
                }
            }

            return null;
        })
        .filter((item) => item && Number.isFinite(item.confidence))
        .sort((a, b) => b.confidence - a.confidence);

    const unique = [];
    const seen = new Set();
    for (const item of normalized) {
        if (!seen.has(item.function)) {
            seen.add(item.function);
            unique.push(item);
        }
        if (unique.length >= limit) break;
    }

    if (unique.length === 0 && aiRes && aiRes.prediction != null && aiRes.confidence != null) {
        unique.push({ function: String(aiRes.prediction), confidence: Number(aiRes.confidence) });
    }

    return unique;
}

function getSelectedWarmupFunction(aiRes) {
    if (!aiRes || typeof aiRes !== 'object') return 'N/A';
    return String(
        aiRes.selected_warmup_function ||
        aiRes.warmup_function ||
        aiRes.warmupFunction ||
        aiRes.prediction ||
        'N/A'
    );
}

//AI prediction
function displayAIInsights(aiRes) {
    if (!aiRes) {
        console.log("\x1b[31m[System] AI Service is offline.\x1b[0m");
        return;
    }

    const prediction = String(aiRes.prediction != null ? aiRes.prediction : "N/A");
    const status = String(aiRes.status != null ? aiRes.status : "");
    const top2 = extractTopConfidentFunctions(aiRes, 2);
    const selectedWarmup = getSelectedWarmupFunction(aiRes);

    console.log("\x1b[1m\x1b[36m┌──────────────────────────────────────────────────┐\x1b[0m");
    
    const top1 = top2[0]
        ? `${top2[0].function} (${toPercent(top2[0].confidence)})`
        : 'N/A';
    const top2Line = top2[1]
        ? `${top2[1].function} (${toPercent(top2[1].confidence)})`
        : 'N/A';

    //console.log(`\x1b[1m\x1b[36m│\x1b[0m  \x1b[33m🥇 TOP 1:\x1b[0m ${top1.padEnd(35)}\x1b[1m\x1b[36m│\x1b[0m`);
    //console.log(`\x1b[1m\x1b[36m│\x1b[0m  \x1b[33m🥈 TOP 2:\x1b[0m ${top2Line.padEnd(35)}\x1b[1m\x1b[36m│\x1b[0m`);
    //console.log(`\x1b[1m\x1b[36m│\x1b[0m  \x1b[32m🔥 SELECTED WARM-UP:\x1b[0m ${selectedWarmup.padEnd(22)}\x1b[1m\x1b[36m│\x1b[0m`);

    if (Array.isArray(aiRes.warmup_candidates) && aiRes.warmup_candidates.length > 0) {
        const candidateSummary = aiRes.warmup_candidates.slice(0, 2).map((candidate) => {
            const func = candidate && candidate.function ? String(candidate.function) : 'N/A';
            const count = candidate && candidate.count != null ? String(candidate.count) : '0';
            const eligibility = getWarmupEligibility(func);
            return `${func} x${count} (${eligibility.eligible ? 'eligible' : 'suppressed: ' + eligibility.reason})`;
        }).join(', ');
        console.log(`\x1b[1m\x1b[36m│\x1b[0m  \x1b[35m🧠 WARM-UP CANDIDATES:\x1b[0m ${candidateSummary.padEnd(18)}\x1b[1m\x1b[36m│\x1b[0m`);
    }
    
    if (aiRes.warmup_triggered) {
        console.log(`\x1b[1m\x1b[36m│\x1b[0m  \x1b[32m🔥 WARM-UP STATUS: Triggered Successfully!      \x1b[0m \x1b[1m\x1b[36m│\x1b[0m`);
    } else {
        console.log(`\x1b[1m\x1b[36m│\x1b[0m  \x1b[33m❄️  WARM-UP STATUS: Idle / Not Triggered        \x1b[0m \x1b[1m\x1b[36m│\x1b[0m`);
    }
    
    if (status && status !== "Success") {
        console.log(`\x1b[1m\x1b[36m│\x1b[0m  \x1b[90mℹ️  Note: ${status.padEnd(35)}\x1b[0m \x1b[1m\x1b[36m│\x1b[0m`);
    }
    console.log("\x1b[1m\x1b[36m└──────────────────────────────────────────────────┘\x1b[0m");
}

//main
async function main() {
    appendIoLog('session', '--- manual_invoke.js session started ---');
    console.clear();
    console.log("\x1b[1m\x1b[34m===================================================\x1b[0m");
    console.log("\x1b[1m\x1b[34m   OPENFAAS AI PROACTIVE MONITORING SYSTEM       \x1b[0m");
    console.log("\x1b[1m\x1b[34m===================================================\x1b[0m");

    while (true) {
        console.log(`\x1b[32m\n[Active Session: User ID ${currentUserId}]\x1b[0m`);
        const funcName = await ask('Enter function name (or "exit"): ');
        
        if (funcName.toLowerCase() === 'exit') break;

        const examples = inputExamples[funcName];
        let payloadStr = await ask('Enter payload JSON (Press Enter for default): ');
        let payload;
        
        try {
            payload = (payloadStr.trim() === '' && examples) ? examples[0] : JSON.parse(payloadStr || "{}");
        } catch (e) {
            console.log("\x1b[31mInvalid JSON. Using empty object.\x1b[0m");
            payload = {};
        }

        // FUNCTION EXECUTION 
        if (funcName === 'login1') {
            console.log(`\x1b[33mAuthenticating via OpenFaaS...\x1b[0m`);
            const invokeResult = await logFunctionInvoke(funcName, payload);
            recordFunctionActivity(funcName);
            const body = extractLoginBody(invokeResult);

            if (body && body.user && body.user.id != null) {
                currentUserId = String(body.user.id);
                console.log(`\x1b[32m✅ User ID ${currentUserId} verified.\x1b[0m`);
            } else {
                console.log(`\x1b[31m⚠️  Login response did not contain a User ID.\x1b[0m`);
            }

            console.log(`\x1b[33m[AI] Sending function details with status...\x1b[0m`);
            const aiRes = await callAIService(
                funcName,
                currentUserId,
                invokeResult.functionStatus,
                {
                    status_code: invokeResult.statusCode,
                    status_message: invokeResult.statusMessage,
                    payload,
                    result: invokeResult.output,
                    recent_activity: getRecentFunctionActivity(),
                    warmup_suppression_ms: WARMUP_SUPPRESSION_MS
                }
            );
            displayAIInsights(aiRes);
            await triggerEligibleWarmups(aiRes, funcName);
        } else {
            console.log(`\x1b[33mInvoking ${funcName}...\x1b[0m`);
            const invokeResult = await logFunctionInvoke(funcName, payload);
            recordFunctionActivity(funcName);

            console.log(`\x1b[33m[AI] Sending function details with status...\x1b[0m`);
            const aiRes = await callAIService(
                funcName,
                currentUserId,
                invokeResult.functionStatus,
                {
                    status_code: invokeResult.statusCode,
                    status_message: invokeResult.statusMessage,
                    payload,
                    result: invokeResult.output,
                    recent_activity: getRecentFunctionActivity(),
                    warmup_suppression_ms: WARMUP_SUPPRESSION_MS
                }
            );
            displayAIInsights(aiRes);
            await triggerEligibleWarmups(aiRes, funcName);

            if (funcName === 'logout') {
                currentUserId = "1";
                console.log(`\x1b[35m[Session] Logged out. Reset to User ID 1.\x1b[0m`);
            }
        }
    }
    rl.close();
}

main().catch(err => console.error("\x1b[31mFatal Error:\x1b[0m", err));
