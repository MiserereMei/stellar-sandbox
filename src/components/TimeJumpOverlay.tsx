import React, { useEffect, useState } from 'react';
import { Simulation } from '../lib/Simulation';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';

export const TimeJumpOverlay = ({ sim }: { sim: Simulation }) => {
  const [isJumping, setIsJumping] = useState(sim.isJumping);
  const [progress, setProgress] = useState(sim.jumpProgress);

  useEffect(() => {
    const interval = setInterval(() => {
      if (sim.isJumping !== isJumping) setIsJumping(sim.isJumping);
      if (sim.isJumping) setProgress(sim.jumpProgress);
    }, 16);
    return () => clearInterval(interval);
  }, [sim, isJumping]);

  return (
    <AnimatePresence>
      {isJumping && (
        <motion.div
          initial={{ backgroundColor: 'rgba(2,5,8,0)', backdropFilter: 'blur(0px)', WebkitBackdropFilter: 'blur(0px)' }}
          animate={{ backgroundColor: 'rgba(2,5,8,0.6)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
          exit={{ backgroundColor: 'rgba(2,5,8,0)', backdropFilter: 'blur(0px)', WebkitBackdropFilter: 'blur(0px)' }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          onAnimationComplete={() => {
            if (isJumping) sim.startJump();
          }}
          className="absolute inset-0 z-40 flex items-center justify-center pointer-events-auto"
        >
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center gap-6"
          >
            <div className="text-white text-3xl font-light tracking-[0.2em] flex items-center gap-3">
              <span className="animate-pulse">CALCULATING</span>
            </div>
            
            <div className="w-80 h-1 bg-white/10 rounded-full overflow-hidden relative">
              <div 
                className="absolute left-0 top-0 bottom-0 bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.6)] transition-all duration-75"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            
            <div className="text-blue-400 font-mono text-sm tracking-widest font-bold">
              {Math.floor(progress * 100)}%
            </div>

            <button 
              onClick={() => sim.cancelJump = true}
              className="mt-8 px-6 py-2 rounded-full border border-white/20 text-gray-300 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-2 text-sm uppercase tracking-widest"
            >
              <X size={16} /> Abort
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
