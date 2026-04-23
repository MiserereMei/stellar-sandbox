// --- CONTROL PANEL ---
const VERBOSE_TELEMETRY = false;  // Toggle second-by-second log stream
const TARGET_KM = 1500;           // Target orbit altitude
const TURN_START_KM = 15;         // Altitude to start gravity turn
const tts = true

// --- FLIGHT STATES ---
const ST = {
    ASCENT: "ASCENT",
    TURN: "GRAVITY_TURN",
    STABLE: "ORBITAL_STABILIZATION"
};

let currentState = ST.ASCENT;
let lastTelemetryTime = -1;
let lastCountdown = -1;

function autopilotStep(t, fc) {
    // --- UI COUNTDOWN SYNC ---
    if (t < 10) {
        const remaining = Math.ceil(10 - t);
        if (remaining !== lastCountdown) {
            if (tts) fc.speak(remaining.toString());
            lastCountdown = remaining;
        }
        return;
    }

    const earth = fc.getDominantBody();
    if (!earth) return;

    // --- MATH CONVERSIONS ---
    const earthRadiusMeters = earth.circumference / (2 * Math.PI);
    const kmToSimUnits = (km) => (km * 1000) / earthRadiusMeters;
    const simUnitsToKm = (units) => (units * earthRadiusMeters) / 1000;

    const targetAltSim = kmToSimUnits(TARGET_KM);
    const turnStartSim = kmToSimUnits(TURN_START_KM);

    // --- SENSORS ---
    const alt = fc.getAltitude();
    const rSpeed = fc.getRadialSpeed();
    const tSpeed = fc.getTangentialSpeed();
    const shipAngle = fc.getRotation();
    const angVel = fc.getAngularVelocity();
    const vOrbital = Math.sqrt(2.442e-7 / (1.0 + alt)); // Local gravity constant
    const currentKm = simUnitsToKm(alt);

    // --- RELATIVE NAVIGATION ---
    const relativeUp = earth.angle + 180;
    const relativeHorizon = earth.angle - 90;

    // --- TELEMETRY ---
    if (Math.floor(t) > lastTelemetryTime) {
        if (VERBOSE_TELEMETRY) {
            fc.log(`T+${Math.floor(t)}s | ${currentKm.toFixed(1)}km | Vel:${tSpeed.toFixed(6)}`);
        } else if (currentState === ST.STABLE && rSpeed < -0.000002) {
            fc.log(`⚠️ CORRECTION | Alt: ${currentKm.toFixed(1)}km | R.Vel:${(rSpeed * 100000).toFixed(1)}`);
        }
        lastTelemetryTime = Math.floor(t);
    }

    let targetAngle = relativeUp;
    let throttle = 0;

    // --- ROCKET ALGORITHM (Your Logic) ---
    switch (currentState) {
        case ST.ASCENT:
            throttle = 1.0;
            targetAngle = relativeUp;
            if (alt > turnStartSim) {
                currentState = ST.TURN;
                fc.log(">>> Gravity Turn Initiated.");
                if (tts) fc.speak("Starting gravity turn.");
            }
            break;

        case ST.TURN:
            throttle = 1.0;
            let progress = (alt - turnStartSim) / (targetAltSim - turnStartSim);
            progress = Math.max(0, Math.min(1, progress));
            targetAngle = relativeUp + (progress * 80);

            if (tSpeed >= vOrbital * 0.98) {
                currentState = ST.STABLE;
                fc.log(">>> ORBIT REACHED. Stabilization active.");
                if (tts) fc.speak("Orbit achieved. Disengaging main engines.");
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

    // --- ACTUATORS (PD Control) ---
    let angleDiff = targetAngle - shipAngle;
    while (angleDiff > 180) angleDiff -= 360;
    while (angleDiff < -180) angleDiff += 360;

    fc.setRotate(angleDiff * 0.2 - angVel * 0.1);
    fc.setThrust(throttle);
}

fc.setLaunchTime(10);

function onLaunch(fc) {
    fc.log(`🚀 Mission Started: Target ${TARGET_KM} KM`);
    if (tts) fc.speak("Liftoff!");
    fc.igniteBooster(32000000, 126, () => {
        fc.log("📦 Booster jettisoned.");
        if (tts) fc.speak("Booster separation confirmed.");
    });
}

// --- SYSTEM BINDINGS ---
fc.on("launch", onLaunch);
fc.on("step", autopilotStep);
