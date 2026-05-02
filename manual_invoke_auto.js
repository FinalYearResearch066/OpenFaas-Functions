#!/usr/bin/env node
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { logFunctionInvoke } = require('./log_invoke');

// --- Configuration ---
const AI_SERVICE_URL = "http://127.0.0.1:8000/predict";
const CSV_FILE_PATH = path.join(__dirname, 'test_data2.csv'); // ඔබේ CSV ගොනුවේ නම මෙතැන සඳහන් කරන්න
const WARMUP_SUPPRESSION_MS = 5 * 60 * 1000;
const DELAY_BETWEEN_INVOCATIONS = 7000; // මිලි තත්පර 7ක් (පර්යේෂණ කාලය)

let currentUserId = "1";
const functionActivityHistory = new Map();

// --- Helper Functions (Manual logic එකෙන් ගත් ඒවා) ---

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
    if (!lastInvokedAt) return { eligible: true, reason: 'not invoked yet' };
    const ageMs = Date.now() - lastInvokedAt;
    if (ageMs >= WARMUP_SUPPRESSION_MS) return { eligible: true, reason: `last used ${Math.round(ageMs / 60000)}m ago` };
    return { eligible: false, reason: `recently used ${Math.round(ageMs / 1000)}s ago` };
}

async function callAIService(funcName, userId, functionStatus, extras = {}) {
    try {
        const res = await axios.post(AI_SERVICE_URL, {
            function: funcName,
            user: String(userId),
            function_status: functionStatus === 1 ? 1 : 0,
            functionStatus: functionStatus === 1 ? 1 : 0,
            timestamp: Date.now(),
            ...extras
        }, { timeout: 3000 });
        return res.data;
    } catch (e) { return null; }
}

async function triggerEligibleWarmups(aiRes, currentFuncName) {
    if (!aiRes || !aiRes.warmup_candidates) return;
    
    // AI එකෙන් දෙන පළමු candidate දෙන්නා ගමු
    const candidates = aiRes.warmup_candidates.slice(0, 2)
        .map(c => c.function)
        .filter(f => f !== currentFuncName);

    for (const warmupFunc of candidates) {
        const eligibility = getWarmupEligibility(warmupFunc);
        if (eligibility.eligible) {
            console.log(`\x1b[35m[Warm-up] Auto-triggering ${warmupFunc}...\x1b[0m`);
            const res = await logFunctionInvoke(warmupFunc, {});
            recordFunctionActivity(warmupFunc);
            console.log(`\x1b[35m[Warm-up] ${warmupFunc} Status: ${res.functionStatus === 1 ? '✅' : '❌'}\x1b[0m`);
        }
    }
}

// --- CSV Processing Logic ---

async function runAutoSuite() {
    if (!fs.existsSync(CSV_FILE_PATH)) {
        console.error(`\x1b[31mError: ${CSV_FILE_PATH} not found!\x1b[0m`);
        process.exit(1);
    }

    const content = fs.readFileSync(CSV_FILE_PATH, 'utf8');
    const rows = content.split('\n').filter(row => row.trim() !== '').slice(1); // Header එක අතහරින්න

    console.log(`\x1b[1m\x1b[34m🚀 Starting Auto CSV Invoker: ${rows.length} rows found.\x1b[0m\n`);

    for (let i = 0; i < rows.length; i++) {
        // CSV Format: function_name,"{""email"":""test@test.com""}"
        const match = rows[i].match(/^([^,]+),(.+)$/);
        if (!match) continue;

        const funcName = match[1].trim();
        let payloadText = match[2].trim();
        
        // Clean JSON formatting from CSV
        if (payloadText.startsWith('"') && payloadText.endsWith('"')) payloadText = payloadText.slice(1, -1);
        payloadText = payloadText.replace(/""/g, '"');

        let payload = {};
        try { payload = JSON.parse(payloadText); } catch (e) { payload = {}; }

        console.log(`\x1b[32m[Row ${i+1}] Processing ${funcName} for User ${currentUserId}...\x1b[0m`);

        // 1. EXECUTE FUNCTION
        const invokeResult = await logFunctionInvoke(funcName, payload);
        recordFunctionActivity(funcName);
        console.log(`   - Invocation: ${invokeResult.functionStatus === 1 ? '✅ Success' : '❌ Failed'}`);

        // 2. USER TRACKING (Login/Logout logic)
        if (funcName.includes('login')) {
            if (payload.email) currentUserId = payload.email;
            else if (invokeResult.output && invokeResult.output.user) currentUserId = String(invokeResult.output.user.id);
            console.log(`   - User Session Updated: ${currentUserId}`);
        }

        // 3. AI PREDICTION & WARMUP
        const aiRes = await callAIService(funcName, currentUserId, invokeResult.functionStatus, {
            recent_activity: getRecentFunctionActivity()
        });

        if (aiRes) {
            console.log(`   - AI Prediction: ${aiRes.prediction} (Conf: ${aiRes.confidence})`);
            await triggerEligibleWarmups(aiRes, funcName);
        }

        if (funcName.includes('logout')) {
            currentUserId = "1";
            console.log(`   - Session Ended. Reset to default user.`);
        }

        // 4. DELAY
        if (i < rows.length - 1) {
            console.log(`\x1b[90mWaiting ${DELAY_BETWEEN_INVOCATIONS/1000}s...\x1b[0m`);
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_INVOCATIONS));
        }
    }

    console.log(`\n\x1b[1m\x1b[32m✅ All tasks completed successfully!\x1b[0m`);
}

runAutoSuite().catch(err => console.error(err));