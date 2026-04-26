import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Power, Flame } from 'lucide-react';
import { Simulation } from '../lib/Simulation';

interface MobileFlightControllerProps {
  sim: Simulation;
  isMobile: boolean;
}

export const MobileFlightController: React.FC<MobileFlightControllerProps> = ({ sim, isMobile }) => {
  const [activeVehicle, setActiveVehicle] = useState<any>(null);
  const [isJoystickActive, setIsJoystickActive] = useState(false);
  const [joystickCenter, setJoystickCenter] = useState({ x: 0, y: 0 });
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  
  const joystickRadius = 60;

  useEffect(() => {
    const interval = setInterval(() => {
      const followed = sim.bodies.find(b => b.id === sim.camera.followingId) as any;
      const isRocket = followed && (followed.type === 'rocket' || followed.type === 'heatProtectedRocket');
      
      if (isRocket) {
        setActiveVehicle(followed);
      } else {
        setActiveVehicle(null);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [sim]);

  const handleJoystickDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setIsJoystickActive(true);
    setJoystickCenter({ x: e.clientX, y: e.clientY });
    setJoystickPos({ x: 0, y: 0 });
    
    if (activeVehicle && activeVehicle.isAutopilotActive) {
      sim.stopAutopilot(activeVehicle.id);
    }
  };

  const handleJoystickMove = (e: React.PointerEvent) => {
    if (!isJoystickActive) return;
    e.stopPropagation();

    const dx = e.clientX - joystickCenter.x;
    const dy = e.clientY - joystickCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Clamp joystick position
    const limitedDist = Math.min(dist, joystickRadius);
    const angle = Math.atan2(dy, dx);
    const limitedX = Math.cos(angle) * limitedDist;
    const limitedY = Math.sin(angle) * limitedDist;
    
    setJoystickPos({ x: limitedX, y: limitedY });

    // SET SIMULATION VALUES
    if (activeVehicle) {
      // Distance from center -> Thrust (0 to 1)
      const thrust = limitedDist / joystickRadius;
      activeVehicle.thrustAmount = thrust;
      activeVehicle.thrusting = thrust > 0.05;
      if (thrust > 0.05) activeVehicle.parentBodyId = null;

      // RESPONSIVE PID CONTROL (Via internal targetPitch)
      if (dist > 10) {
        const dom = sim.getDominantBody(activeVehicle.position);
        if (dom) {
          const dx = dom.position.x - activeVehicle.position.x;
          const dy = dom.position.y - activeVehicle.position.y;
          const horizonBase = (Math.atan2(dy, dx) + Math.PI / 2) * (180 / Math.PI);
          const absoluteTarget = angle * (180 / Math.PI);
          
          let pitch = absoluteTarget - horizonBase;
          while (pitch > 180) pitch -= 360;
          while (pitch < -180) pitch += 360;
          
          activeVehicle.targetPitch = pitch;
          activeVehicle.isAutopilotActive = true;
          activeVehicle.manualTargetRotation = null; // Disable the snap override
        }
      } else {
        activeVehicle.targetPitch = null;
        activeVehicle.isAutopilotActive = false;
      }
    }
  };

  const handleJoystickUp = () => {
    setIsJoystickActive(false);
    setJoystickPos({ x: 0, y: 0 });
    
    if (activeVehicle) {
      activeVehicle.thrustAmount = 0;
      activeVehicle.thrusting = false;
      activeVehicle.rotationAmount = 0;
      activeVehicle.targetPitch = null;
      activeVehicle.manualTargetRotation = null;
      activeVehicle.isAutopilotActive = false;
      activeVehicle.rotatingLeft = false;
      activeVehicle.rotatingRight = false;
    }
  };

  const [isFiringLocally, setIsFiringLocally] = useState(false);

  const handleIgnitionDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (activeVehicle) {
      activeVehicle.parentBodyId = null;
      activeVehicle.isIgniting = true;
      setIsFiringLocally(true);
      if (navigator.vibrate) {
        // Use a repeating pattern for more robust mobile support
        navigator.vibrate([200, 50, 200, 50, 200, 50]); 
      }
    }
  };

  const handleIgnitionUp = () => {
    setIsFiringLocally(false);
    if (activeVehicle) {
      activeVehicle.isIgniting = false;
      if (navigator.vibrate) navigator.vibrate(0); // Stop
    }
  };

  const [zoomPos, setZoomPos] = useState({ y: 0 });
  const [isZoomActive, setIsZoomActive] = useState(false);
  const zoomCenterY = useRef(0);

  const handleZoomDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setIsZoomActive(true);
    zoomCenterY.current = e.clientY;
    setZoomPos({ y: 0 });
  };

  const handleZoomMove = (e: React.PointerEvent) => {
    if (!isZoomActive) return;
    const dy = e.clientY - zoomCenterY.current;
    const limitedY = Math.max(-joystickRadius, Math.min(joystickRadius, dy));
    setZoomPos({ y: limitedY });
  };

  const handleZoomUp = () => {
    setIsZoomActive(false);
    setZoomPos({ y: 0 });
  };


  useEffect(() => {
    if (!isFiringLocally) return;
    const interval = setInterval(() => {
      if (navigator.vibrate) navigator.vibrate(20);
    }, 40);
    return () => {
      clearInterval(interval);
      if (navigator.vibrate) navigator.vibrate(0);
    };
  }, [isFiringLocally]);

  useEffect(() => {
    if (!isZoomActive || Math.abs(zoomPos.y) < 5) return;
    const interval = setInterval(() => {
      // Logarithmic zoom velocity
      const velocity = -zoomPos.y / 500;
      const factor = 1 + velocity;
      sim.camera.zoom *= factor;
    }, 16);
    return () => clearInterval(interval);
  }, [isZoomActive, zoomPos.y, sim]);

  if (!isMobile || !activeVehicle) return null;

  return (
    <div className="fixed inset-0 z-[50] pointer-events-none select-none">
      {/* HUD Info - Top Left */}
      <div className="absolute top-24 left-6 text-left">
        <div className="text-[10px] font-bold text-blue-400/60 uppercase tracking-[3px] mb-1">Thrust Level</div>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-mono font-bold text-white leading-none">
            {Math.round((activeVehicle.thrustAmount || 0) * 100)}
          </span>
          <span className="text-xs font-bold text-gray-500">%</span>
        </div>
      </div>

      {/* LEFT SIDE: ZOOM & IGNITE */}
      <div className="absolute bottom-[100px] left-6 flex flex-col gap-8 items-center">
        {/* ZOOM ROCKER */}
        <div 
          className="w-16 h-32 bg-white/5 border border-white/10 rounded-full flex items-center justify-center pointer-events-auto relative"
          style={{ touchAction: 'none' }}
          onPointerDown={handleZoomDown}
          onPointerMove={handleZoomMove}
          onPointerUp={handleZoomUp}
          onPointerLeave={handleZoomUp}
        >
          <div className="absolute top-2 text-[7px] font-bold text-gray-500 uppercase tracking-widest">In</div>
          <div className="absolute bottom-2 text-[7px] font-bold text-gray-500 uppercase tracking-widest">Out</div>
          
          <motion.div
            animate={{ y: zoomPos.y }}
            className={`w-12 h-12 rounded-full shadow-2xl backdrop-blur-xl border flex items-center justify-center transition-colors ${isZoomActive ? 'bg-white/20 border-white/40' : 'bg-white/10 border-white/20'}`}
          >
            <div className="text-[8px] font-bold text-white uppercase">Zoom</div>
          </motion.div>
        </div>

        {/* IGNITION BUTTON */}
        <div className="pointer-events-auto" style={{ touchAction: 'none' }}>
          <button
            onPointerDown={handleIgnitionDown}
            onPointerUp={handleIgnitionUp}
            onPointerLeave={handleIgnitionUp}
            style={{ touchAction: 'none' }}
            className={`w-20 h-20 rounded-full border flex flex-col items-center justify-center transition-all shadow-xl backdrop-blur-xl ${
              isFiringLocally 
                ? 'bg-red-500/40 border-red-400/60 animate-pulse scale-110' 
                : 'bg-red-600/10 border-red-500/30 active:bg-red-500/40 active:scale-95'
            }`}
          >
            <span className={`text-[10px] font-bold uppercase tracking-[2px] ${
              isFiringLocally ? 'text-white' : 'text-red-500'
            }`}>
              {isFiringLocally ? 'Firing' : 'Ignite'}
            </span>
          </button>
        </div>
      </div>

      {/* RIGHT SIDE: THRUST JOYSTICK */}
      <div className="absolute bottom-[100px] right-6 pointer-events-auto" style={{ touchAction: 'none' }}>
        <div 
          className="w-40 h-40 flex items-center justify-center relative"
          onPointerDown={handleJoystickDown}
          onPointerMove={handleJoystickMove}
          onPointerUp={handleJoystickUp}
          onPointerLeave={handleJoystickUp}
        >
          {/* Base / Button appearance when not active */}
          <AnimatePresence>
            {!isJoystickActive && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-8 rounded-full bg-blue-600/10 border border-blue-500/30 backdrop-blur-xl flex items-center justify-center shadow-xl"
              >
                <span className="text-[10px] font-bold text-blue-500 uppercase tracking-[2px]">Thrust</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Joystick Base (visible only when active) */}
          {isJoystickActive && (
            <div className="absolute inset-0 rounded-full border border-white/5 bg-white/5 flex items-center justify-center">
              <div className="w-24 h-24 rounded-full border border-white/5 opacity-30" />
            </div>
          )}

          {/* The Knob */}
          {isJoystickActive && (
            <motion.div
              animate={{ x: joystickPos.x, y: joystickPos.y }}
              transition={{ type: 'spring', damping: 25, stiffness: 400 }}
              className="w-20 h-20 rounded-full shadow-2xl backdrop-blur-2xl border bg-blue-500/20 border-blue-400/50 flex items-center justify-center"
            >
              <div className="text-[8px] font-bold text-blue-400 uppercase">Power</div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};
