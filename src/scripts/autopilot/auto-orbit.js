// --- INITIALIZATION ---
fc.setLaunchTime(10); // Schedule launch for T+10s

fc.on("launch", async () => {
    fc.log(`🚀 Mission Started: Target 1500 KM`);
    await fc.speak("Liftoff!");
    fc.igniteBooster(32000000, 126, () => {
        fc.log("📦 Booster jettisoned.");
        fc.speak("Booster separation confirmed.");
    });
});

// --- CONTROL PANEL ---
const VERBOSE_TELEMETRY = false;
const TARGET_KM = 1500;
const TURN_START_KM = 15;

// --- FLIGHT STATES ---
const ST = { ASCENT: "ASCENT", TURN: "GRAVITY_TURN", STABLE: "ORBITAL_INSERTION" };
let currentState = ST.ASCENT;
let lastTelemetryTime = -1;
let lastCountdown = -1;

// --- MAIN FLIGHT LOOP ---
fc.on("step", (t, fc) => {
    // Countdown Audio (UI Sync)
    if (t < 10) {
        const remaining = Math.ceil(10 - t);
        if (remaining !== lastCountdown) {
            fc.speak(remaining.toString());
            lastCountdown = remaining;
        }
        return;
    }

    const earth = fc.getDominantBody();
    if (!earth) return;

    const earthRadiusMeters = earth.circumference / (2 * Math.PI);
    const kmToSimUnits = (km) => (km * 1000) / earthRadiusMeters;
    const simUnitsToKm = (units) => (units * earthRadiusMeters) / 1000;

    const targetAltSim = kmToSimUnits(TARGET_KM);
    const turnStartSim = kmToSimUnits(TURN_START_KM);

    const alt = fc.getAltitude();
    const rSpeed = fc.getRadialSpeed();
    const tSpeed = fc.getTangentialSpeed();
    const shipAngle = fc.getRotation();
    const angVel = fc.getAngularVelocity();
    const vOrbital = Math.sqrt(1.541e-6 / (1.0 + alt));
    const currentKm = simUnitsToKm(alt);

    const relativeUp = earth.angle + 180;
    const relativeHorizon = earth.angle - 90;

    const telemetry = `T+${Math.floor(t)}s | ${currentKm.toFixed(1)}km | Vel:${tSpeed.toFixed(6)}`;
    if (Math.floor(t) > lastTelemetryTime) {
        if (VERBOSE_TELEMETRY) fc.log(telemetry);
        else if (currentState === ST.STABLE && rSpeed < -0.000002) {
            fc.log(`⚠️ EMERGENCY CORRECTION | Alt: ${currentKm.toFixed(1)}km`);
        }
        lastTelemetryTime = Math.floor(t);
    }

    let targetAngle = relativeUp;
    let throttle = 1.0;

    switch (currentState) {
        case ST.ASCENT:
            targetAngle = relativeUp;
            if (alt > turnStartSim) {
                currentState = ST.TURN;
                fc.log(">>> Gravity Turn Started.");
            }
            break;
        case ST.TURN:
            let progress = (alt - turnStartSim) / (targetAltSim - turnStartSim);
            progress = Math.max(0, Math.min(1, progress));
            targetAngle = relativeUp + (progress * 80);
            if (tSpeed >= vOrbital * 0.98) {
                currentState = ST.STABLE;
                fc.log(">>> ORBIT REACHED. Stabilization active.");
            }
            break;
        case ST.STABLE:
            targetAngle = relativeHorizon;
            if (rSpeed < -0.000001) {
                targetAngle = relativeHorizon - 45;
                throttle = 1.0;
            } else if (tSpeed < vOrbital) {
                throttle = 0.6;
            } else {
                throttle = 0;
            }
            break;
    }

    let angleDiff = targetAngle - shipAngle;
    while (angleDiff > 180) angleDiff -= 360;
    while (angleDiff < -180) angleDiff += 360;

    fc.setRotate(angleDiff * 0.2 - angVel * 0.1);
    fc.setThrust(throttle);
});
