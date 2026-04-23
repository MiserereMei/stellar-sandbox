/**
 * Artemis II Mission Autopilot (NASA Authentic - Sim-Unit Calibrated)
 */

const MS = {
    ASCENT: "ASCENT",
    GRAVITY_TURN: "GRAVITY_TURN",
    LEO_INSERTION: "LEO_INSERTION",
    HEO_BURN: "HEO_RAISE_BURN",       
    HEO_CHECKOUT: "HEO_SYSTEMS_CHECK", 
    TLI_WINDOW: "TLI_WINDOW_HUNT",    
    TLI_BURN: "TLI_BURN",             
    COASTING: "TRANS_LUNAR_COAST",
    LUNAR_FLYBY: "LUNAR_FLYBY"
};

let currentState = MS.ASCENT;
let lastLogTime = -1;
let orbitStartTime = -1;

fc.on("launch", async () => {
    fc.log("🚀 Artemis II: Liftoff! Using SLS Core + SRBs.");
    fc.igniteBooster(32000000, 126, () => {
        fc.log("📦 SRB Separation confirmed.");
    });
});

fc.on("step", (t, fc) => {
    const moon = fc.getBodies().find(b => b.name === "Moon");
    const earth = fc.getBodies().find(b => b.name === "Earth");
    if (!moon || !earth) return;

    const alt = fc.getAltitude(); 
    const speed = fc.getRelativeSpeed(); 
    const altKm = alt * 6371;
    const moonDistKm = moon.distance / 1000;
    
    // --- HIGH-PRECISION LOGGING (DEBUG) ---
    if (Math.floor(t) % 60 === 0 && Math.floor(t) !== lastLogTime) {
        fc.log(`[DEBUG] State: ${currentState} | Speed: ${speed.toFixed(7)} | Alt: ${altKm.toFixed(1)}km`);
        lastLogTime = Math.floor(t);
    }

    // SAFETY OVERRIDE: Slightly higher limit to allow full TLI (0.00171)
    if (speed > 0.00175) {
        fc.setThrust(0);
        if (currentState === MS.TLI_BURN) {
            fc.log("!!! TLI TARGET REACHED (Safety Cutoff). Proceeding to Moon.");
            currentState = MS.COASTING;
        } else if (currentState !== MS.COASTING && currentState !== MS.LUNAR_FLYBY) {
            fc.log("!!! EMERGENCY CUTOFF: Overspeed detected.");
            currentState = MS.HEO_CHECKOUT;
            orbitStartTime = t;
        }
    }

    switch (currentState) {
        case MS.ASCENT:
            fc.setThrust(1.0);
            fc.essentials.setPitch(90);
            if (altKm > 10) { 
                currentState = MS.GRAVITY_TURN;
                fc.log(">>> Initiating Gravity Turn.");
            }
            break;

        case MS.GRAVITY_TURN:
            fc.setThrust(1.0);
            let targetPitch = 90 - (altKm / 2.2); 
            fc.essentials.setPitch(Math.max(12, targetPitch));
            
            // LEO speed target: 0.00122 units
            if (speed >= 0.00122) {
                fc.setThrust(0);
                currentState = MS.HEO_BURN;
                fc.log(">>> LEO speed reached. Coasting to perigee for HEO burn.");
            }
            break;

        case MS.HEO_BURN:
            // Ensure we are prograde and fairly low before starting HEO burn
            if (altKm < 400) {
                fc.setThrust(1.0);
                fc.essentials.setPitch(0);
            } else {
                fc.setThrust(0);
            }
            
            if (speed >= 0.00155) {
                fc.setThrust(0);
                currentState = MS.HEO_CHECKOUT;
                orbitStartTime = t;
                fc.log(`>>> HEO Cutoff. Speed: ${speed.toFixed(6)}. Systems checkout starting.`);
            }
            break;

        case MS.HEO_CHECKOUT:
            fc.setThrust(0);
            fc.essentials.setPitch(0);
            
            // Log phase angle every 10 min
            if (Math.floor(t) % 600 === 0 && Math.floor(t) !== lastLogTime) {
                const dom = fc.getDominantBody();
                if (dom) {
                    const progradeAngle = dom.angle - 90;
                    let phaseAngle = moon.angle - progradeAngle;
                    while (phaseAngle > 180) phaseAngle -= 360;
                    while (phaseAngle < -180) phaseAngle += 360;
                    fc.log(`[CHECKOUT] Moon Phase Angle: ${phaseAngle.toFixed(1)}° | Target: ~145°`);
                }
            }

            if (t - orbitStartTime > 43200) {
                if (alt < 0.15) { 
                    currentState = MS.TLI_WINDOW;
                    fc.log(">>> Checkout nominal. Searching for TLI window (145° target).");
                }
            }
            break;

        case MS.TLI_WINDOW:
            fc.setThrust(0);
            fc.essentials.setPitch(0);
            
            const dom = fc.getDominantBody();
            if (dom) {
                const progradeAngle = dom.angle - 90;
                let phaseAngle = moon.angle - progradeAngle;
                while (phaseAngle > 180) phaseAngle -= 360;
                while (phaseAngle < -180) phaseAngle += 360;

                // Precision window for Free Return: 142° to 148°
                if (phaseAngle > 142 && phaseAngle < 148) {
                    if (alt < 0.2) {
                        currentState = MS.TLI_BURN;
                        fc.log(`>>> TLI EXECUTION: Phase ${phaseAngle.toFixed(1)}°. Aiming for Lunar Flyby.`);
                        fc.speak("Executing trans-lunar injection burn.");
                    }
                }
            }
            break;

        case MS.TLI_BURN:
            fc.setThrust(1.0);
            fc.essentials.setPitch(0);
            
            if (speed >= 0.001715) {
                fc.setThrust(0);
                currentState = MS.COASTING;
                fc.log(">>> TLI Burn Complete. Free-return trajectory active.");
            }
            break;

        case MS.COASTING:
            fc.setThrust(0);
            fc.essentials.setPitch(0);
            
            // Log distance to Moon every 5 minutes (300s)
            if (Math.floor(t) % 300 === 0 && Math.floor(t) !== lastLogTime) {
                fc.log(`[COASTING] Distance to Moon: ${moonDistKm.toFixed(0)} km | Speed: ${speed.toFixed(6)}`);
                lastLogTime = Math.floor(t);
            }

            if (moonDistKm < 20000) {
                currentState = MS.LUNAR_FLYBY;
                fc.log(">>> ENTERING LUNAR INFLUENCE ZONE. Brace for flyby.");
                fc.speak("Entering lunar sphere of influence.");
            }
            break;

        case MS.LUNAR_FLYBY:
            fc.setThrust(0);
            // NASA Flyby Target: ~7,400 km
            if (Math.floor(t) % 60 === 0 && Math.floor(t) !== lastLogTime) {
                fc.log(`>>> LUNAR FLYBY ACTIVE. Altitude: ${(moonDistKm - 1737).toFixed(0)} km`);
                lastLogTime = Math.floor(t);
            }
            break;
    }
});
