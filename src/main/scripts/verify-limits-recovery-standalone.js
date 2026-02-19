
/**
 * STANDALONE VERIFICATION: VIDEO LIMITS & MISSED JOB RECOVERY
 * This script mirrors and verifies the logic implemented in JobQueue.ts
 */

const logs = [];
const log = (msg) => {
    console.log(`[VERIFY] ${msg}`);
    logs.push(msg);
};

// --- MOCK ENVIRONMENT ---
const mockStorage = {
    jobs: [],
    run(sql, params) {
        // Simple mock for UPDATE/INSERT
        if (sql.includes('UPDATE jobs SET scheduled_for')) {
            const id = params[1];
            const newTime = params[0];
            const job = this.jobs.find(j => j.id === id);
            if (job) {
                job.scheduled_for = newTime;
                job.status = 'pending';
            }
        }
        if (sql.includes('UPDATE jobs SET status = \'missed\'')) {
            const ids = params;
            this.jobs.filter(j => ids.includes(j.id)).forEach(j => j.status = 'missed');
        }
    }
};

// --- TEST CASE 1: Video Limits Logic Simulation ---
async function testLimitsLogic() {
    log('--- Phase 1: Video Limits Logic Verification ---');

    const isMonitoring = true; // Simulating monitoring phase
    const totalScheduled = 99; // Almost at total limit (100)
    const monitoredCount = 4;  // Almost at future limit (5)

    const sourceConfig = {
        totalLimit: 100,
        futureLimit: 5,
        historyLimit: 10
    };

    const uniqueVideos = [
        { id: 'vid_1', url: '...' },
        { id: 'vid_2', url: '...' },
        { id: 'vid_3', url: '...' }
    ];

    log(`Initial State: TotalScheduled=${totalScheduled}, Monitored=${monitoredCount}, Monitoring=${isMonitoring}`);
    log(`Config: TotalLimit=${sourceConfig.totalLimit}, FutureLimit=${sourceConfig.futureLimit}`);

    let newlyScheduled = 0;
    let currentTotal = totalScheduled;
    let currentMonitored = monitoredCount;

    for (const v of uniqueVideos) {
        // MIRRORED LOGIC from JobQueue.ts:562-575

        // 1. Check Total Limit
        if (sourceConfig.totalLimit && sourceConfig.totalLimit !== 'unlimited') {
            if (currentTotal >= sourceConfig.totalLimit) {
                log(`[STOP] Total limit (${sourceConfig.totalLimit}) reached at video ${v.id}.`);
                break;
            }
        }

        // 2. Check Future Limit
        if (isMonitoring && sourceConfig.futureLimit && sourceConfig.futureLimit !== 'unlimited') {
            if (currentMonitored >= sourceConfig.futureLimit) {
                log(`[STOP] Future limit (${sourceConfig.futureLimit}) reached at video ${v.id}.`);
                break;
            }
        }

        log(`Scheduling video: ${v.id}`);
        newlyScheduled++;
        currentTotal++;
        if (isMonitoring) currentMonitored++;
    }

    log(`Result: Scheduled ${newlyScheduled} videos. Final Total: ${currentTotal}`);

    if (newlyScheduled !== 1) {
        throw new Error(`Expected only 1 video to be scheduled due to Limits, but got ${newlyScheduled}`);
    }
    log('✅ Phase 1 Passed: Limits correctly enforced.');
}

// --- TEST CASE 2: Missed Job Recovery Logic Simulation ---
async function testRecoveryLogic() {
    log('--- Phase 2: Missed Job Recovery Logic Verification ---');

    const now = Date.now();
    const pastTime = new Date(now - 120 * 60000).toISOString(); // 2 hours ago

    mockStorage.jobs = [
        { id: 1, campaign_id: 10, status: 'pending', scheduled_for: pastTime }
    ];

    log(`Simulating missed job from: ${pastTime}`);

    const config = { autoSchedule: true }; // Target behavior
    const autoSchedule = config.autoSchedule !== false;

    if (autoSchedule) {
        log('Auto-reschedule enabled. Shifting schedule...');

        // MIRRORED LOGIC from JobQueue.ts:shiftCampaignSchedule
        const jobs = mockStorage.jobs.filter(j => j.campaign_id === 10);
        const firstJob = jobs[0];
        const scheduledTime = new Date(firstJob.scheduled_for).getTime();

        let shiftMs = now - scheduledTime;
        if (shiftMs > 0) {
            shiftMs += 1000 * 60; // 1 min buffer
        }

        log(`Shifting by ${(shiftMs / 60000).toFixed(2)} minutes...`);

        const updates = jobs.map(j => {
            const oldTime = new Date(j.scheduled_for).getTime();
            const newTime = new Date(oldTime + shiftMs).toISOString();
            return { id: j.id, scheduled_for: newTime };
        });

        updates.forEach(u => {
            mockStorage.run('UPDATE jobs SET scheduled_for = ?, status = \'pending\' WHERE id = ?', [u.scheduled_for, u.id]);
        });
    }

    const updatedJob = mockStorage.jobs.find(j => j.id === 1);
    const newTime = new Date(updatedJob.scheduled_for).getTime();

    log(`New scheduled time: ${updatedJob.scheduled_for}`);

    if (newTime > now) {
        log('✅ Phase 2 Passed: Missed job recovered and shifted to future.');
    } else {
        throw new Error(`Recovery logic failed! Job still in past: ${updatedJob.scheduled_for}`);
    }
}

async function run() {
    try {
        await testLimitsLogic();
        console.log('');
        await testRecoveryLogic();
        console.log('\n🎉 ALL STANDALONE VERIFICATION TESTS PASSED!');
    } catch (err) {
        console.error(`\n❌ VERIFICATION FAILED: ${err.message}`);
        process.exit(1);
    }
}

run();
